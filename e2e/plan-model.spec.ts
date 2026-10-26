import { test, expect } from '@playwright/test'
import { applyOps } from '@/lib/plan/ops'
import { demoPlan } from '@/lib/plan/demo'
import { renderSheet, layoutSheet } from '@/lib/plan/sheet'
import { checkPlan } from '@/lib/plan/checks'
import type { Opening, Plan, Wall } from '@/lib/plan/types'
import { clashes, clipToFree, shiftToFree } from '@/lib/plan/clear'

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

  test('a plan too large for the sheet is an error', () => {
    const { plan } = applyOps(demoPlan(), [{ op: 'setSheet', patch: { paper: 'A4' } }])
    expect(checkPlan(plan).some((f) => f.code === 'fit')).toBe(true)
  })
})

test.describe('room areas', () => {
  test('computed from walls per view; doors count as closed', async () => {
    const { roomAreas } = await import('@/lib/plan/rooms')
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
    const { roomAreas } = await import('@/lib/plan/rooms')
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
