import { test, expect, type APIRequestContext } from '@playwright/test'
import { checkPlan } from '@/lib/plan/checks'
import { sheetPdf } from '@/lib/plan/export'
import { finishPlan } from '@/lib/plan/finish'
import { applyOps } from '@/lib/plan/ops'
import { fittingScale, hasChanges, renderSheet } from '@/lib/plan/sheet'
import type { Plan, Wall } from '@/lib/plan/types'
import { demoPlan } from '@/lib/plan/demo'

// A plan of what exists is one sheet; plan_finish does the mechanical last steps.

const wall = (id: string, ax: number, ay: number, bx: number, by: number, t = 150, extra: Partial<Wall> = {}): Wall => ({ id, a: { x: ax, y: ay }, b: { x: bx, y: by }, thickness: t, phase: 'existing', ...extra })

// A cellar: 6080 × 10500, exterior walls marked, an outside stair below.
function cellar(): Plan {
  const ext = { exterior: true }
  return {
    ...demoPlan(),
    walls: [wall('n', 0, 170, 6080, 170, 340, ext), wall('s', 0, 10350, 6080, 10350, 380, ext), wall('w', 70, 0, 70, 10500, 140, ext), wall('e', 6010, 0, 6010, 10500, 140, ext), wall('mitt', 70, 5500, 6010, 5500, 290)],
    openings: [],
    fixtures: [{ id: 'utv', kind: 'box', x: 3000, y: 11200, w: 2400, d: 1400, phase: 'existing', label: 'Utv. trappa' }],
    dimensions: [],
    notes: [],
    masses: [],
    rooms: [{ id: 'r1', name: 'Tvättstuga', at: { x: 1500, y: 2500 } }],
    sheet: { ...demoPlan().sheet, scale: 100, orientation: 'landscape', paper: 'A3', titleBlock: { ...demoPlan().sheet.titleBlock, property: '', address: '', apartments: '', author: '', floor: '' } },
    name: 'Källarvåningen',
  }
}

const pages = (pdf: Buffer) => (pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) ?? []).length

test('a plan with nothing marked is a record of what exists: one sheet, no före/efter wording', async () => {
  const p = cellar()
  expect(hasChanges(p)).toBe(false)
  const svg = renderSheet(p, 'efter')
  expect(svg).toContain('Planritning – befintlig')
  expect(svg).not.toContain('Planritning efter')
  expect(svg).toContain('>A-01<') // no -E suffix
  expect(checkPlan(p).map((f) => f.code)).not.toContain('no-change')
  expect(pages(await sheetPdf(p, ['fore', 'efter']))).toBe(1)
})

test('mark one wall for demolition and it is a före/efter pair again', async () => {
  const p = cellar()
  p.walls.find((w) => w.id === 'mitt')!.phase = 'demolish'
  expect(hasChanges(p)).toBe(true)
  expect(renderSheet(p, 'efter')).toContain('Planritning efter')
  expect(pages(await sheetPdf(p, ['fore', 'efter']))).toBe(2)
  const renamed = cellar()
  renamed.rooms[0].renamed = 'Förråd'
  expect(hasChanges(renamed)).toBe(true)
})

test('plan_finish: the largest scale that fills the sheet, overall dimensions, nothing twice', () => {
  const p = cellar()
  expect(p.sheet.scale).toBe(100)
  const fin = finishPlan(p)
  expect(fin.plan.sheet.scale).toBe(50)
  expect(fittingScale(fin.plan)).toBe(50)
  expect(layoutFits(fin.plan)).toBe(true)
  expect(fin.plan.dimensions).toHaveLength(2)
  const [bredd, langd] = fin.plan.dimensions
  // outer faces of the exterior walls: 6080 wide (0–6080), 10500 long (0–10540 from the south face)
  expect(Math.abs(bredd.b.x - bredd.a.x)).toBe(6080)
  expect(Math.round(Math.abs(langd.b.y - langd.a.y))).toBe(10540)
  // the bottom line is clear of the outside stair that sticks out below the wall
  expect(bredd.offset).toBeLessThan(-1500)
  expect(fin.done.join('\n')).toContain('Yttermått')
  expect(fin.ask).toEqual(expect.arrayContaining([expect.stringContaining('fastighetsbeteckning'), 'adress', 'lägenhetsnummer', 'ritad av']))
  // run again on the result: nothing more to do
  const again = finishPlan(fin.plan)
  expect(again.ops).toEqual([])
  expect(again.plan.dimensions).toHaveLength(2)
})

test('plan_finish keeps dimensions that are already there, marks exterior walls only when asked', () => {
  const p = cellar()
  p.dimensions = [{ id: 'mitt-mått', a: { x: 0, y: 0 }, b: { x: 1000, y: 0 }, offset: 300 }]
  const fin = finishPlan(p)
  expect(fin.plan.dimensions).toHaveLength(1)
  expect(fin.plan.walls.some((w) => w.loadBearing)).toBe(false)
  const lb = finishPlan(p, { markExteriorLoadBearing: true })
  expect(lb.plan.walls.filter((w) => w.loadBearing).map((w) => w.id).sort()).toEqual(['e', 'n', 's', 'w'])
  // the ops replay on the original plan to the same result
  expect(applyOps(p, lb.ops).errors).toEqual([])
})

test('plan_finish lists what is left but not the title block twice, and a plan that fits nowhere says so', () => {
  const fin = finishPlan(cellar())
  expect(fin.findings.map((f) => f.code)).not.toContain('title-block')
  const huge = cellar()
  huge.sheet.paper = 'A4'
  huge.walls.push(wall('lang', 0, 0, 90000, 0, 300, { exterior: true }))
  expect(finishPlan(huge).done.join('\n')).toContain('får inte plats')
})

test('plan_finish compares the traced outside size with the printed one', () => {
  // The cellar's outer faces are 6080 wide and 10540 long.
  const ok = finishPlan(cellar(), { printedOuter: { width: 6080, length: 10540 } })
  expect(ok.findings.map((f) => f.code)).not.toContain('outer-size')
  expect(ok.done.join('\n')).toContain('stämmer med det tryckta')
  const off = finishPlan(cellar(), { printedOuter: { width: 6080, length: 10500 } })
  expect(off.findings[0]).toMatchObject({ level: 'warning', code: 'outer-size' })
  expect(off.findings[0].message).toContain('+40')
  // the printed pair may come in either order
  expect(finishPlan(cellar(), { printedOuter: { width: 10540, length: 6080 } }).findings.map((f) => f.code)).not.toContain('outer-size')
  // within 30 mm is drawing tolerance
  expect(finishPlan(cellar(), { printedOuter: { width: 6060, length: 10520 } }).findings.map((f) => f.code)).not.toContain('outer-size')
  // without a printed size the finish says it was not compared
  expect(finishPlan(cellar()).findings.map((f) => f.code)).toContain('outer-unchecked')
})

test('plan_finish warns when the exterior walls have no window', () => {
  expect(finishPlan(cellar()).findings.map((f) => f.code)).toContain('no-windows')
  const p = cellar()
  p.openings.push({ id: 'f1', kind: 'window', wallId: 'n', offset: 1000, width: 1200, phase: 'existing' })
  expect(finishPlan(p).findings.map((f) => f.code)).not.toContain('no-windows')
})

test('plan_finish sets the floor from the name, and asks about load-bearing exterior walls', () => {
  const fin = finishPlan(cellar())
  expect(fin.plan.sheet.titleBlock.floor).toBe('Källarvåning')
  expect(fin.ask.join('\n')).not.toContain('våningsplan')
  expect(fin.ask.join('\n')).toContain('bärande')
  expect(finishPlan(cellar(), { markExteriorLoadBearing: true }).ask.join('\n')).not.toContain('bärande')
  const named = cellar()
  named.name = 'Gnejsen 1 tr'
  expect(finishPlan(named).plan.sheet.titleBlock.floor).toBe('Plan 1')
  const unknown = cellar()
  unknown.name = 'Skiss'
  const u = finishPlan(unknown)
  expect(u.plan.sheet.titleBlock.floor).toBe('')
  expect(u.ask).toContain('våningsplan')
  // a floor that is already set is kept
  const kept = cellar()
  kept.sheet.titleBlock.floor = 'Suterräng'
  expect(finishPlan(kept).plan.sheet.titleBlock.floor).toBe('Suterräng')
})

function layoutFits(plan: Plan) {
  return fittingScale({ ...plan, sheet: { ...plan.sheet } }) !== null && fittingScale(plan)! <= plan.sheet.scale
}

async function call(request: APIRequestContext, name: string, args: Record<string, unknown>) {
  const res = await request.post('/api/mcp', { data: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } } })
  expect(res.status()).toBe(200)
  return (await res.json()).result as { content: Array<{ type: string; text?: string }>; isError?: boolean }
}

test('the tool: finishes a traced plan in one revision and says what to ask the user', async ({ request }) => {
  const created = await call(request, 'plan_create', { name: 'Färdigställ' })
  const id = /Skapad: ([a-z0-9-]+)/.exec(created.content[0].text!)![1]
  const w = (i: string, a: [number, number], b: [number, number], ext = false) => ({ op: 'add', kind: 'wall', item: { id: i, a: { x: a[0], y: a[1] }, b: { x: b[0], y: b[1] }, thickness: 200, phase: 'existing', exterior: ext } })
  await call(request, 'plan_edit', { plan_id: id, base_revision: 1, ops: [w('n', [0, 0], [6000, 0], true), w('s', [0, 10000], [6000, 10000], true), w('v', [0, 0], [0, 10000], true), w('o', [6000, 0], [6000, 10000], true)] })
  const fin = await call(request, 'plan_finish', { plan_id: id, printed_outer_mm: { width: 6200, length: 10200 } })
  expect(fin.isError, fin.content[0].text).toBeFalsy()
  const t = fin.content[0].text!
  expect(t).toContain('Färdigställd, revision 3')
  expect(t).toContain('skala 1:50')
  expect(t).toContain('Yttermått')
  expect(t).toContain('Fråga användaren')
  expect(t).toContain('stämmer med det tryckta') // 6200 × 10200 outer faces
  expect(t).toContain('ritad av')
  expect(t).not.toContain('Inga ändringar är markerade')
  expect(fin.content.at(-1)!.type).toBe('image')
  // a second call changes nothing
  const again = await call(request, 'plan_finish', { plan_id: id })
  expect(again.content[0].text).toContain('revision 3')
  expect(again.content[0].text).toContain('inget behövde ändras')
})
