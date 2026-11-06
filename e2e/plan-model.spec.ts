import { test, expect } from '@playwright/test'
import { applyOps } from '@/lib/plan/domain/ops'
import { demoPlan } from '@/lib/plan/domain/demo'
import { renderSheet, layoutSheet, wallPieces } from '@/lib/plan/domain/sheet'
import { checkPlan } from '@/lib/plan/domain/checks'
import type { Opening, Plan, Wall } from '@/lib/plan/domain/types'
import { clashes, clipToFree, shiftToFree } from '@/lib/plan/assist/clear'

// Pure model tests — no browser needed.

test.describe('plan ops', () => {
  test('moving a wall drags joined walls and keeps others', () => {
    const plan = demoPlan()
    const { plan: next, errors } = applyOps(plan, [{ op: 'moveWall', id: 'lgh-grans', dx: 200, dy: 0 }])
    expect(errors).toEqual([])
    const w = next.walls.find((x) => x.id === 'lgh-grans')!
    expect(w.a).toEqual({ x: 6200, y: 0 })
    // b-kok started at the boundary wall's line but not at its end, so it stays.
    expect(next.walls.find((x) => x.id === 'b-kok')!.a).toEqual({ x: 6000, y: 4000 })
    expect(next.walls.find((x) => x.id === 'yt-n')).toEqual(plan.walls.find((x) => x.id === 'yt-n'))
  })

  test('setWallLength moves the free end and joined walls', () => {
    const plan = demoPlan()
    const { plan: next, errors } = applyOps(plan, [{ op: 'setWallLength', id: 'a-kok', length: 3000, fixed: 'a' }])
    expect(errors).toEqual([])
    const w = next.walls.find((x) => x.id === 'a-kok')!
    expect(w.b).toEqual({ x: 3500, y: 3000 })
    // a-hall ended at (3500,3500) and follows.
    expect(next.walls.find((x) => x.id === 'a-hall')!.b).toEqual({ x: 3500, y: 3000 })
  })

  test('ops are all-or-nothing', () => {
    const plan = demoPlan()
    const res = applyOps(plan, [
      { op: 'update', kind: 'opening', id: 'ny-oppning', patch: { width: 1000 } },
      { op: 'update', kind: 'wall', id: 'finns-inte', patch: { thickness: 10 } },
    ])
    expect(res.errors.length).toBe(1)
    expect(res.plan).toBe(plan)
  })

  test('an opening outside its wall is rejected', () => {
    const res = applyOps(demoPlan(), [{ op: 'update', kind: 'opening', id: 'ny-oppning', patch: { offset: 6500 } }])
    expect(res.errors[0]).toContain('utanför väggen')
    // A missing offset (e.g. a failed computation) is rejected, not saved.
    const none = applyOps(demoPlan(), [{ op: 'update', kind: 'opening', id: 'ny-oppning', patch: { offset: null } }])
    expect(none.errors[0]).toContain('måste vara tal')
  })

  test('values are rounded to whole millimetres', () => {
    const res = applyOps(demoPlan(), [{ op: 'update', kind: 'opening', id: 'ny-oppning', patch: { width: 912.6 } }])
    expect(res.plan.openings.find((o) => o.id === 'ny-oppning')!.width).toBe(913)
  })

  test('deleting a wall deletes its openings', () => {
    const res = applyOps(demoPlan(), [{ op: 'delete', kind: 'wall', id: 'lgh-grans' }])
    expect(res.errors).toEqual([])
    expect(res.plan.openings.some((o) => o.wallId === 'lgh-grans')).toBe(false)
  })
})

test.describe('sheet renderer', () => {
  // A door frame set into a thick wall: the leaf hangs `inset` mm in from the face it swings to, so it reaches
  // that much less far into the room. The leaf is always as long as the door is wide.
  test('a door with an inset hangs further into the wall and reaches less far into the room', () => {
    const plan = demoPlan()
    const door = plan.openings.find((o) => o.id === 'd-a-hall')!
    const leaf = (p: Plan) => {
      const g = renderSheet(p, 'efter').split(`data-opening="${door.id}"`)[1].split('</g>')[0]
      const m = /<line x1="([\d.-]+)" y1="([\d.-]+)" x2="([\d.-]+)" y2="([\d.-]+)"/.exec(g)!
      const [x1, y1, x2, y2] = m.slice(1).map(Number)
      return { hinge: { x: x1, y: y1 }, len: Math.hypot(x2 - x1, y2 - y1) }
    }
    const k = layoutSheet(plan).toPaper({ x: 1000, y: 0 }).x - layoutSheet(plan).toPaper({ x: 0, y: 0 }).x // paper mm per plan mm × 1000
    const at = (inset?: number) => leaf({ ...plan, openings: plan.openings.map((o) => (o.id === door.id ? { ...o, inset } : o)) })
    const flush = at(undefined)
    const set = at(30)
    const wall = plan.walls.find((w) => w.id === door.wallId)!
    expect(wall.thickness).toBeGreaterThan(30)
    expect(set.len).toBeCloseTo(flush.len, 3)
    expect(flush.len).toBeCloseTo((door.width * k) / 1000, 2)
    expect(Math.hypot(set.hinge.x - flush.hinge.x, set.hinge.y - flush.hinge.y)).toBeCloseTo((30 * k) / 1000, 2)
  })

  test('A3 sheet is in paper millimetres at true scale', () => {
    const plan = demoPlan()
    const svg = renderSheet(plan, 'efter')
    expect(svg).toContain('width="420mm" height="297mm"')
    expect(svg).toContain('viewBox="0 0 420 297"')
    const L = layoutSheet(plan)
    // 12 m at 1:50 = 240 mm on paper.
    const a = L.toPaper({ x: 0, y: 0 })
    const b = L.toPaper({ x: 12000, y: 0 })
    expect(b.x - a.x).toBeCloseTo(240, 6)
    expect(L.fits).toBe(true)
  })

  test('före hides new work, efter marks it and dimensions the new opening', () => {
    const plan = demoPlan()
    const fore = renderSheet(plan, 'fore')
    const efter = renderSheet(plan, 'efter')
    expect(fore).not.toContain('data-opening="ny-oppning"')
    expect(fore).not.toContain('data-phase="demolish"')
    expect(efter).toContain('data-opening="ny-oppning"')
    expect(efter).toContain('data-wall="a-kok" data-phase="demolish"')
    // Auto dimensions: opening width 900 and its position 4600.
    const dims = efter.slice(efter.indexOf('auto-dims'))
    expect(dims).toContain('>900<')
    expect(dims).toContain('>550<') // from the face of partition b-kok (4050) to 4600
    expect(dims).toContain('>3225<') // demolished wall, face to face
    expect(efter).toContain('Planritning efter')
    expect(fore).toContain('Planritning före')
    expect(efter).toContain('1:50 (A3)')
  })

  test('a dimension the person drew replaces the automatic one for the same span: the figure is not there twice', () => {
    const plan = demoPlan()
    const count = (svg: string, t: string) => svg.split(t).length - 1
    expect(count(renderSheet(plan, 'efter'), '>3225<')).toBe(1)
    // The demolished wall a-kok runs 225 → 3450 face to face at x = 3500: drawn by hand, in the other direction too.
    for (const [a, b] of [[225, 3450], [3450, 225]]) {
      const drawn = { ...plan, dimensions: [...plan.dimensions, { id: 'm-egen', a: { x: 3500, y: a }, b: { x: 3500, y: b }, offset: 900 }] }
      const efter = renderSheet(drawn, 'efter')
      expect(count(efter, '>3225<')).toBe(1)
      expect(efter.slice(efter.indexOf('auto-dims'))).not.toContain('>3225<')
      // A drawn dimension of another span does not hide it.
      const other = { ...plan, dimensions: [...plan.dimensions, { id: 'm-annan', a: { x: 3500, y: 0 }, b: { x: 3500, y: 3000 }, offset: 900 }] }
      expect(count(renderSheet(other, 'efter'), '>3225<')).toBe(1)
    }
  })

  test('a wall split in line meets itself end to end: the part to be demolished neither covers what stays nor is covered by it', () => {
    const base = demoPlan()
    const plan = {
      ...base,
      walls: [
        { id: 'a', a: { x: 0, y: 0 }, b: { x: 2000, y: 0 }, thickness: 170, phase: 'existing' as const },
        { id: 'b', a: { x: 2000, y: 0 }, b: { x: 4000, y: 0 }, thickness: 170, phase: 'demolish' as const },
        { id: 'c', a: { x: 4000, y: 0 }, b: { x: 6000, y: 0 }, thickness: 170, phase: 'existing' as const },
        // An L-corner at the far end still closes: this wall's end is at an angle to c.
        { id: 'd', a: { x: 6000, y: 0 }, b: { x: 6000, y: 3000 }, thickness: 170, phase: 'existing' as const },
      ],
      openings: [],
      fixtures: [],
      rooms: [],
      dimensions: [],
      notes: [],
    }
    const xs = (id: string) => {
      const q = wallPieces(plan, 'efter').find((p) => p.wall.id === id)!.quad
      return [Math.min(...q.map((p) => p.x)), Math.max(...q.map((p) => p.x))]
    }
    expect(xs('a')).toEqual([0, 2000])
    expect(xs('b')).toEqual([2000, 4000])
    expect(xs('c')[0]).toBe(4000)
    // c turns into d at its far end: extended by half the thickness there, as before.
    expect(xs('c')[1]).toBe(6085)
    // The length dimension of a demolished wall can be left out.
    const withDim = renderSheet(plan, 'efter')
    expect(withDim.slice(withDim.indexOf('auto-dims'))).toContain('>2000<')
    const without = renderSheet({ ...plan, walls: plan.walls.map((w) => (w.id === 'b' ? { ...w, noAutoDim: true } : w)) }, 'efter')
    expect(without.slice(without.indexOf('auto-dims'))).not.toContain('>2000<')
  })

  test('an opening without a door is only the gap in the wall: no dashed lines across it (dashes mean demolished)', () => {
    const plan = demoPlan()
    const wall = plan.walls.find((w) => w.id === 'yt-n')!
    const open = { ...plan, openings: [...plan.openings, { id: 'passage', wallId: wall.id, kind: 'opening' as const, offset: 2000, width: 1000, phase: 'existing' as const }] }
    const svg = renderSheet(open, 'fore')
    const group = svg.slice(svg.indexOf('data-opening="passage"'))
    const body = group.slice(0, group.indexOf('</g>'))
    expect(body).not.toContain('stroke-dasharray')
    expect(body).not.toContain('<line')
    // The wall is cut there: the gap is real.
    expect(svg).toContain('data-opening="passage"')
  })

  test('a note can be a badge: a short number in a circle', () => {
  const { plan, errors } = applyOps(demoPlan(), [{ op: 'add', kind: 'note', item: { id: 'u1', at: { x: 2000, y: 1000 }, text: 'U1', badge: true } }])
  expect(errors).toEqual([])
  const svg = renderSheet(plan, 'fore')
  expect(svg).toContain('data-badge="u1"')
  expect(svg).toContain('>U1<')
})

test('a zone is a light grey area under the walls with a row in the legend, on the sheets it is meant for', () => {
    const plan = demoPlan()
    const { plan: shaded, errors } = applyOps(plan, [
      { op: 'add', kind: 'zone', item: { id: 'lgh', points: [{ x: 0, y: 0 }, { x: 3000, y: 0 }, { x: 3000, y: 3000 }, { x: 0, y: 3000 }], label: 'Lgh Z (slås samman)', views: ['fore'] } },
    ])
    expect(errors).toEqual([])
    const fore = renderSheet(shaded, 'fore')
    expect(fore).toContain('data-zone="lgh"')
    expect(fore.indexOf('data-zone="lgh"')).toBeLessThan(fore.indexOf('data-testid="plan-walls"') + 1000) // under the walls
    expect(fore).toContain('Lgh Z (slås samman)')
    const efter = renderSheet(shaded, 'efter')
    expect(efter).not.toContain('data-zone="lgh"')
    expect(efter).not.toContain('Lgh Z (slås samman)')
    // A zone needs an outline.
    expect(applyOps(plan, [{ op: 'add', kind: 'zone', item: { id: 'x', points: [{ x: 0, y: 0 }] } }]).errors.length).toBeGreaterThan(0)
  })

  test('a dimension can be limited to one sheet', () => {
    const { plan, errors } = applyOps(demoPlan(), [
      { op: 'add', kind: 'dimension', item: { id: 'only-efter', a: { x: 0, y: 0 }, b: { x: 1234, y: 0 }, offset: 400, views: ['efter'] } },
    ])
    expect(errors).toEqual([])
    expect(renderSheet(plan, 'efter')).toContain('>1234<')
    expect(renderSheet(plan, 'fore')).not.toContain('>1234<')
  })

  test('room areas are computed from polygons', () => {
    const svg = renderSheet(demoPlan(), 'fore')
    // 3225 × 3225 mm = 10,4 m²
    expect(svg).toContain('10,4 m²')
  })
})

test.describe('checks', () => {
  test('demo plan flags fire boundary and missing nothing in the title block', () => {
    const findings = checkPlan(demoPlan())
    expect(findings.filter((f) => f.code === 'title-block')).toEqual([])
    expect(findings.some((f) => f.code === 'fire' && f.ref === 'ny-oppning')).toBe(true)
    expect(findings.some((f) => f.level === 'error')).toBe(false)
  })

  test('brf name used as property designation is flagged', () => {
    const { plan } = applyOps(demoPlan(), [{ op: 'setTitleBlock', patch: { property: 'Brf Gnejsen 2' } }])
    expect(checkPlan(plan).some((f) => f.code === 'property-name')).toBe(true)
  })

  test('a plan too large for the sheet is an error that names a scale that fits', () => {
    const { plan } = applyOps(demoPlan(), [{ op: 'setSheet', patch: { paper: 'A4' } }])
    const fit = checkPlan(plan).find((f) => f.code === 'fit')!
    expect(fit.message).toContain('byt till 1:100')
    const smaller = applyOps(plan, [{ op: 'setSheet', patch: { scale: 100 } }]).plan
    expect(checkPlan(smaller).some((f) => f.code === 'fit')).toBe(false)
    expect(applyOps(plan, [{ op: 'setSheet', patch: { scale: 75 as never } }]).errors[0]).toContain('stöds inte')
  })
})

test.describe('room areas', () => {
  test('computed from walls per view; doors count as closed', async () => {
    const { roomAreas } = await import('@/lib/plan/domain/rooms')
    const plan = demoPlan()
    const fore = roomAreas(plan, 'fore')
    const efter = roomAreas(plan, 'efter')
    // Rum A: 3225 × 3225 mm inside the faces (±10 mm raster).
    expect(fore.get('r-a-rum')! / 1e6).toBeCloseTo(10.4, 1)
    expect(fore.get('r-a-kok')! / 1e6).toBeCloseTo(7.5, 1)
    // Kitchen wall demolished: Rum and Kök become one space, area shown once.
    expect(efter.get('r-a-rum')! / 1e6).toBeCloseTo(18.2, 1)
    expect(efter.has('r-a-kok')).toBe(false)
  })

  test('a passage with no wall in it joins the rooms either side; a doorway does not', async () => {
    const { roomAreas } = await import('@/lib/plan/domain/rooms')
    const wall = (id: string, ax: number, ay: number, bx: number, by: number): Wall => ({ id, a: { x: ax, y: ay }, b: { x: bx, y: by }, thickness: 100, phase: 'existing' })
    const walls = [wall('n', 0, 0, 4000, 0), wall('s', 0, 2000, 4000, 2000), wall('w', 0, 0, 0, 2000), wall('e', 4000, 0, 4000, 2000), wall('m', 2000, 0, 2000, 2000)]
    const rooms = [{ id: 'r1', name: 'Hall', at: { x: 1000, y: 1000 } }, { id: 'r2', name: 'Hall', at: { x: 3000, y: 1000 } }]
    const base: Plan = { ...demoPlan(), walls, rooms, fixtures: [], openings: [] }
    const withOpening = (o: Partial<Opening>): Plan => ({ ...base, openings: [{ id: 'o', kind: 'opening', wallId: 'm', offset: 50, width: 1900, phase: 'existing', ...o }] })
    // Even a doorway across the whole wall leaves two rooms, each with its own area.
    expect(roomAreas(withOpening({}), 'fore').size).toBe(2)
    // Marked through: one space (3900 × 1900 mm), its area shown once, under the first label.
    const joined = roomAreas(withOpening({ through: true }), 'fore')
    expect(joined.has('r2')).toBe(false)
    expect(Math.abs(joined.get('r1')! / 1e6 - 7.41)).toBeLessThan(0.1)
  })
})

test('a door in a demolished wall is not drawn as an infill', () => {
  const { plan } = applyOps(demoPlan(), [
    { op: 'update', kind: 'wall', id: 'a-kok-hall', patch: { phase: 'demolish' } },
    { op: 'update', kind: 'opening', id: 'd-a-kok', patch: { phase: 'demolish' } },
  ])
  const svg = renderSheet(plan, 'efter')
  const group = /<g data-wall="a-kok-hall" data-phase="demolish">(.*?)<\/g>/.exec(svg)![1]
  expect(group).not.toContain('fill="#000"')
})

test('a room marked goneAfter has no label in efter', () => {
  const { plan } = applyOps(demoPlan(), [{ op: 'update', kind: 'room', id: 'r-a-kok', patch: { goneAfter: true } }])
  expect(renderSheet(plan, 'fore')).toContain('data-room="r-a-kok"')
  expect(renderSheet(plan, 'efter')).not.toContain('data-room="r-a-kok"')
})

test('a room marked newAfter has a label in efter only', () => {
  const { plan } = applyOps(demoPlan(), [{ op: 'update', kind: 'room', id: 'r-a-kok', patch: { newAfter: true } }])
  expect(renderSheet(plan, 'fore')).not.toContain('data-room="r-a-kok"')
  expect(renderSheet(plan, 'efter')).toContain('data-room="r-a-kok"')
})

test('ops: moving a wall start keeps its openings where they were drawn', () => {
  const plan: Plan = {
    ...demoPlan(),
    walls: [{ id: 'mur', a: { x: 1000, y: 0 }, b: { x: 5000, y: 0 }, thickness: 200, phase: 'existing' }],
    openings: [{ id: 'd', kind: 'door', wallId: 'mur', offset: 1500, width: 800, phase: 'existing' }],
  }
  // The start moves 300 mm west along the wall: the door keeps its place at x 2500–3300.
  const moved = applyOps(plan, [{ op: 'update', kind: 'wall', id: 'mur', patch: { a: { x: 700, y: 0 } } }]).plan
  const o = moved.openings[0]
  expect(moved.walls[0].a.x + o.offset).toBe(2500)
  expect(o.width).toBe(800)
  // A move across the wall (no change along it) leaves the offset alone.
  const across = applyOps(plan, [{ op: 'update', kind: 'wall', id: 'mur', patch: { a: { x: 1000, y: 100 } } }]).plan
  expect(across.openings[0].offset).toBe(1500)
})

test('a new opening is not blocked by a wall that is demolished where it goes (and a demolished one not by a new wall)', () => {
  const W: Wall = { id: 'W', a: { x: 0, y: 0 }, b: { x: 4000, y: 0 }, thickness: 200, phase: 'existing' }
  const gone: Wall = { id: 'gone', a: { x: 1000, y: 0 }, b: { x: 2000, y: 0 }, thickness: 200, phase: 'demolish' }
  const added: Wall = { id: 'added', a: { x: 3000, y: -1000 }, b: { x: 3000, y: 1000 }, thickness: 200, phase: 'new' }
  const plan: Plan = { ...demoPlan(), walls: [W, gone, added], openings: [] }
  // Where the wall is torn out, the new door is fine; the same door as an existing one runs into the wall that is there before.
  expect(clashes(plan, W, 1050, 900, 'new')).toEqual([])
  expect(clashes(plan, W, 1050, 900, 'existing')).toEqual(['gone'])
  // The mirror: something that exists only before is not blocked by a wall that comes later.
  expect(clashes(plan, W, 2900, 300, 'demolish')).toEqual([])
  expect(clashes(plan, W, 2900, 300, 'new')).toEqual(['added'])
  const ok: Plan = { ...plan, openings: [{ id: 'dorr', kind: 'door', wallId: 'W', offset: 1050, width: 900, phase: 'new' }] }
  expect(checkPlan(ok).some((f) => f.code === 'opening-in-wall')).toBe(false)
})

test('openings clear of the walls they meet: a window through a corner is cut back, a door against a wall moves', () => {
  const W: Wall = { id: 'W', a: { x: 0, y: 0 }, b: { x: 4000, y: 0 }, thickness: 200, phase: 'existing' }
  const P: Wall = { id: 'P', a: { x: 1000, y: -1000 }, b: { x: 1000, y: 1000 }, thickness: 200, phase: 'existing' }
  const plan: Plan = { ...demoPlan(), walls: [W, P], openings: [] }
  // A 1.5 m window from the corner runs into P (x 900–1100): it is cut back to the free 0.8 m.
  expect(clashes(plan, W, 0, 1500)).toEqual(['P'])
  expect(clipToFree(plan, W, 0, 1500)).toEqual({ offset: 0, width: 800 })
  // A centre-marked door of unknown width moves clear of P (1200 is the nearest free start).
  expect(shiftToFree(plan, W, 1000, 500)).toBe(1200)
  // The plan check reports the window that runs into a wall.
  const bad: Plan = { ...plan, openings: [{ id: 'win', kind: 'window', wallId: 'W', offset: 0, width: 1500, phase: 'existing' }] }
  expect(checkPlan(bad).some((f) => f.code === 'opening-in-wall' && f.ref === 'win')).toBe(true)
  expect(checkPlan({ ...plan, openings: [{ id: 'win', kind: 'window', wallId: 'W', offset: 1300, width: 1000, phase: 'existing' }] }).some((f) => f.code === 'opening-in-wall')).toBe(false)
})

test('a mass is a convex solid: drawn hatched like a load-bearing wall, solid in room areas, in the way of openings', async () => {
  const { roomAreas } = await import('@/lib/plan/domain/rooms')
  const wall = (id: string, ax: number, ay: number, bx: number, by: number): Wall => ({ id, a: { x: ax, y: ay }, b: { x: bx, y: by }, thickness: 100, phase: 'existing' })
  const walls = [wall('n', 0, 0, 4000, 0), wall('s', 0, 2000, 4000, 2000), wall('w', 0, 0, 0, 2000), wall('e', 4000, 0, 4000, 2000)]
  const base: Plan = { ...demoPlan(), walls, openings: [], fixtures: [], rooms: [{ id: 'r', name: 'Rum', at: { x: 2000, y: 1000 } }] }
  // A dented outline is refused; a triangle is fine.
  const bad = applyOps(base, [{ op: 'add', kind: 'mass', item: { id: 'm', points: [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 300, y: 300 }, { x: 0, y: 1000 }], phase: 'existing' } }])
  expect(bad.errors[0]).toContain('konvex')
  const { plan, errors } = applyOps(base, [{ op: 'add', kind: 'mass', item: { id: 'm', points: [{ x: 50, y: 50 }, { x: 1050, y: 50 }, { x: 50, y: 1050 }], phase: 'existing', loadBearing: true } }])
  expect(errors).toEqual([])
  const svg = renderSheet(plan, 'fore')
  const group = /<g data-mass="m" data-phase="existing">(.*?)<\/g>/.exec(svg)![1]
  expect(group).toContain('<line') // hatch
  // 3900 × 1900 inside the faces, less the 1000 × 1000 / 2 triangle.
  expect(Math.abs(roomAreas(plan, 'fore').get('r')! / 1e6 - (7.41 - 0.5))).toBeLessThan(0.05)
  // A door in the north wall running into the mass is reported.
  expect(clashes(plan, walls[0], 500, 800)).toContain('m')
})

test('room labels fit the room: a closet at 1:200 keeps its name but drops the area', () => {
  const wall = (id: string, ax: number, ay: number, bx: number, by: number): Wall => ({ id, a: { x: ax, y: ay }, b: { x: bx, y: by }, thickness: 100, phase: 'existing' })
  // A 4 m room and a 0.6 m closet beside it.
  const walls = [wall('n', 0, 0, 4700, 0), wall('s', 0, 2000, 4700, 2000), wall('w', 0, 0, 0, 2000), wall('m', 4000, 0, 4000, 2000), wall('e', 4700, 0, 4700, 2000)]
  const rooms = [{ id: 'rum', name: 'Rum', at: { x: 2000, y: 1000 } }, { id: 'g', name: 'Garderob', at: { x: 4350, y: 1000 } }]
  const at = (scale: 50 | 200) => renderSheet({ ...demoPlan(), walls, openings: [], fixtures: [], dimensions: [], rooms, sheet: { ...demoPlan().sheet, scale } }, 'fore')
  const group = (svg: string, id: string) => new RegExp(`<g data-room="${id}">(.*?)</g>`).exec(svg)![1]
  expect(group(at(50), 'g')).toContain('m²')
  expect(group(at(200), 'g')).toContain('Garderob')
  expect(group(at(200), 'g')).not.toContain('m²')
  expect(group(at(200), 'rum')).toContain('m²')
})

test('a sheet can leave out door swings: the door stays a door, drawn closed', () => {
  const plan = demoPlan()
  const doorId = plan.openings.find((o) => o.kind === 'door')!.id
  const group = (svg: string) => new RegExp(`<g data-opening="${doorId}"[^>]*>(.*?)</g>`).exec(svg)![1]
  expect(group(renderSheet(plan, 'fore'))).toContain('<path') // the swing arc
  const closed = group(renderSheet({ ...plan, sheet: { ...plan.sheet, doorSwings: false } }, 'fore'))
  expect(closed).not.toContain('<path')
  expect(closed).toContain('<line')
})
