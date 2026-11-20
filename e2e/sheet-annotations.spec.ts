import { test, expect } from '@playwright/test'
import { demoPlan } from '@/lib/plan/domain/demo'
import { applyOps, validatePlan } from '@/lib/plan/domain/ops'
import { renderSheet } from '@/lib/plan/domain/sheet'
import type { Plan } from '@/lib/plan/domain/types'

// Every automatic annotation on a sheet can be removed: per element (an opening's or a demolished wall's dimensions,
// a room's area) and for the whole sheet (sheet.hide). The demo plan has a new opening (900 wide, 550 from the face of
// the partition), a demolished wall (3225 face to face) and rooms with areas.

// The automatic dimensions: each is a group of its own, so their group ends where two group closings meet.
const autoDims = (svg: string) => {
  const start = svg.indexOf('auto-dims')
  const end = svg.indexOf('</g></g>', start)
  return svg.slice(start, end < 0 ? undefined : end)
}
const rooms = (svg: string) => svg.slice(svg.indexOf('plan-rooms'), svg.indexOf('data-testid="dims"'))

test('by default the sheet dimensions new openings, prints room areas and draws the legend, north arrow and scale bar', () => {
  const svg = renderSheet(demoPlan(), 'efter')
  expect(autoDims(svg)).toContain('>900<')
  expect(autoDims(svg)).toContain('>550<')
  expect(rooms(svg)).toContain('m²')
  for (const id of ['legend', 'north-arrow', 'scale-bar']) expect(svg).toContain(`data-testid="${id}"`)
})

test("an opening's automatic dimensions can be left out", () => {
  const plan = demoPlan()
  const { plan: next, errors } = applyOps(plan, [{ op: 'update', kind: 'opening', id: 'ny-oppning', patch: { noAutoDim: true } }])
  expect(errors).toEqual([])
  const dims = autoDims(renderSheet(next, 'efter'))
  expect(dims).not.toContain('>900<')
  expect(dims).not.toContain('>550<')
  // The demolished wall's dimension is still there.
  expect(dims).toContain('>3225<')
})

test("a room's area can be left out; its name stays", () => {
  const plan = demoPlan()
  const room = plan.rooms[0]
  const { plan: next, errors } = applyOps(plan, plan.rooms.map((r) => ({ op: 'update' as const, kind: 'room' as const, id: r.id, patch: { noArea: true } })))
  expect(errors).toEqual([])
  const r = rooms(renderSheet(next, 'efter'))
  expect(r).not.toContain('m²')
  expect(r).toContain(`>${room.renamed ?? room.name}<`)
})

test('the whole sheet can leave out every automatic part', () => {
  const plan = demoPlan()
  const { plan: next, errors } = applyOps(plan, [{ op: 'setSheet', patch: { hide: ['autoDims', 'roomAreas', 'legend', 'northArrow', 'scaleBar'] } }])
  expect(errors).toEqual([])
  for (const view of ['fore', 'efter'] as const) {
    const svg = renderSheet(next, view)
    expect(autoDims(svg)).not.toMatch(/<text/)
    expect(rooms(svg)).not.toContain('m²')
    for (const id of ['legend', 'north-arrow', 'scale-bar']) expect(svg).not.toContain(`data-testid="${id}"`)
    // What the person drew stays: the drawn dimensions and the title block.
    expect(svg).toContain('data-testid="dims"')
  }
})

test('an unknown part to hide is refused with the list of parts', () => {
  const plan: Plan = { ...demoPlan(), sheet: { ...demoPlan().sheet, hide: ['grid' as never] } }
  expect(validatePlan(plan).join(' ')).toContain('sheet.hide: "grid" finns inte; delar som kan döljas: autoDims, roomAreas, legend, northArrow, scaleBar')
})
