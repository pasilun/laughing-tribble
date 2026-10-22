import { test, expect } from '@playwright/test'
import { applyOps } from '@/lib/plan/ops'
import { demoPlan } from '@/lib/plan/demo'
import { renderSheet, layoutSheet } from '@/lib/plan/sheet'
import { checkPlan } from '@/lib/plan/checks'

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
