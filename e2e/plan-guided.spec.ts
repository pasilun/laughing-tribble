import { test, expect, type APIRequestContext } from '@playwright/test'
import { readFileSync } from 'fs'

// The short surface for smaller models: plan_next, plan_trace, plan_audit, plan_fix, plan_view,
// small answers from plan_edit and plan_get, and the ?tools=basic profile.

const IMG = 'e2e/fixtures/cellar/kallare.png'
const NOMINAL = (25.4 / 300) * 100
const mm = (p: { x: number; y: number }) => ({ x: p.x * NOMINAL, y: p.y * NOMINAL })
const DIMS = [
  { label: 'längd', a: mm({ x: 693, y: 268 }), b: mm({ x: 693, y: 1931 }), mm: 10500 },
  { label: 'bredd', a: mm({ x: 774, y: 2122 }), b: mm({ x: 1726, y: 2122 }), mm: 6080 },
]

type Res = { content: Array<{ type: string; text?: string; data?: string }>; isError?: boolean }
async function call(request: APIRequestContext, name: string, args: Record<string, unknown>, query = ''): Promise<Res> {
  const res = await request.post(`/api/mcp${query}`, { data: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } } })
  expect(res.status()).toBe(200)
  return (await res.json()).result as Res
}
const text = (r: Res) => r.content.map((c) => c.text ?? '').join('\n')

async function planWithSource(request: APIRequestContext, name: string) {
  const id = /Skapad: ([a-z0-9-]+)/.exec(text(await call(request, 'plan_create', { name })))![1]
  const added = await call(request, 'plan_source_add', { plan_id: id, base_revision: 1, id: 'kallare', role: 'archive', filename: 'kallare.png', data_base64: readFileSync(IMG).toString('base64'), scale: 100, dpi: 300 })
  expect(added.isError, text(added)).toBeFalsy()
  return id
}

test('?tools=basic lists a short set; the default lists everything; the instructions differ', async ({ request }) => {
  const list = async (q: string) => ((await (await request.post(`/api/mcp${q}`, { data: { jsonrpc: '2.0', id: 1, method: 'tools/list' } })).json()).result.tools as Array<{ name: string }>).map((t) => t.name)
  const all = await list('')
  const basic = await list('?tools=basic')
  expect(basic.length).toBeLessThanOrEqual(12)
  expect(all.length).toBeGreaterThan(basic.length)
  for (const n of ['plan_next', 'plan_trace', 'plan_audit', 'plan_fix', 'plan_view', 'plan_finish', 'plan_upload_link']) expect(basic).toContain(n)
  expect(basic).not.toContain('plan_scan_snap_walls')
  expect(all).toContain('plan_scan_snap_walls')
  const init = async (q: string) => (await (await request.post(`/api/mcp${q}`, { data: { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} } })).json()).result.instructions as string
  expect(await init('?tools=basic')).toContain('plan_next')
  expect(await init('')).not.toBe(await init('?tools=basic'))
})

test('a plan of what exists speaks of one sheet, not före and efter', async ({ request }) => {
  const created = text(await call(request, 'plan_create', { name: 'Befintlig' }))
  const id = /Skapad: ([a-z0-9-]+)/.exec(created)![1]
  expect(created).toContain('befintlig')
  expect(created).not.toContain('före + efter')
  await call(request, 'plan_fix', { plan_id: id, set: [{ add_wall: { a: { x: 0, y: 0 }, b: { x: 4000, y: 0 }, thickness: 200 } }] })
  const got = text(await call(request, 'plan_get', { plan_id: id, only: ['walls'] }))
  expect(got).toContain('PDF (planritning – befintlig)')
  expect(got).not.toContain('före + efter')
  expect(text(await call(request, 'plan_review', { plan_id: id }))).toContain('(befintligt)')
  // With a change in it, the pair comes back.
  await call(request, 'plan_edit', { plan_id: id, base_revision: 2, message: 'Rivs', ops: [{ op: 'update', kind: 'wall', id: 'w1', patch: { phase: 'demolish' } }] })
  expect(text(await call(request, 'plan_get', { plan_id: id, only: ['walls'] }))).toContain('före + efter')
  // The short set has no view argument at all.
  const tools = (await (await request.post('/api/mcp?tools=basic', { data: { jsonrpc: '2.0', id: 1, method: 'tools/list' } })).json()).result.tools as Array<{ name: string; inputSchema: { properties: Record<string, unknown> } }>
  expect(tools.filter((t) => 'view' in t.inputSchema.properties)).toEqual([])
})

test('plan_next asks for the drawing first, then for calibration', async ({ request }) => {
  const id = /Skapad: ([a-z0-9-]+)/.exec(text(await call(request, 'plan_create', { name: 'Nästa-steg' })))![1]
  expect(text(await call(request, 'plan_next', { plan_id: id }))).toContain('plan_upload_link')
  await call(request, 'plan_source_add', { plan_id: id, base_revision: 1, id: 'kallare', role: 'archive', filename: 'kallare.png', data_base64: readFileSync(IMG).toString('base64'), scale: 100, dpi: 300 })
  const second = text(await call(request, 'plan_next', { plan_id: id }))
  expect(second).toContain('Kalibrera')
  expect(second).toContain('plan_trace')
})

test('plan_trace calibrates from the printed dimensions, fits walls, reads openings and says what is left', async ({ request }) => {
  test.setTimeout(120_000)
  const id = await planWithSource(request, 'Trace')
  const out = await call(request, 'plan_trace', { plan_id: id, printed_outer_mm: { width: 6080, length: 10500 }, dimensions: DIMS })
  expect(out.isError, text(out)).toBeFalsy()
  const t = text(out)
  expect(t).toContain('plan_trace klar')
  expect(t).toMatch(/\d+ väggar fästa/)
  expect(t).toMatch(/\d+ öppningar/)
  expect(out.content.at(-1)!.type).toBe('image')
  const plan = (await (await request.get(`/api/plans/${id}`)).json()).plan
  expect(plan.walls.length).toBeGreaterThanOrEqual(8)
  expect(plan.walls.filter((w: { exterior?: boolean }) => w.exterior).length).toBeGreaterThanOrEqual(3)
  expect(plan.sources[0].calibration).toBeTruthy()
  // Without a way to find the house or dimensions it asks instead of guessing.
  const bare = await planWithSource(request, 'Trace utan mått')
  const asked = await call(request, 'plan_trace', { plan_id: bare })
  expect(text(asked)).toContain('inte kalibrerad')
  expect(text(asked)).toContain('printed_outer_mm')
  // Stops before reading walls at a wrong scale, and shows the drawing to read the dimensions from.
  expect(text(asked)).toContain('plan_trace stannade')
  expect(asked.content.at(-1)!.type).toBe('image')
  expect((await (await request.get(`/api/plans/${bare}`)).json()).plan.walls).toHaveLength(0)
})

test('plan_audit finds a wall moved off the drawing; plan_fix mends it by id; small answers stay small', async ({ request }) => {
  test.setTimeout(180_000)
  const id = await planWithSource(request, 'Revision')
  await call(request, 'plan_trace', { plan_id: id, dimensions: DIMS })
  // A first draft is rough: mend what the audit can mend, then disturb one wall on purpose.
  for (let i = 0; i < 3 && /wall:\w+\] /.test(text(await call(request, 'plan_audit', { plan_id: id }))); i++) await call(request, 'plan_fix', { plan_id: id, apply: 'alla' })
  const plan = (await (await request.get(`/api/plans/${id}`)).json()).plan as { walls: Array<{ id: string; a: { x: number; y: number }; b: { x: number; y: number }; thickness: number }>; openings: unknown[] }
  // A long, well drawn wall to disturb.
  const target = [...plan.walls].sort((p, q) => Math.hypot(q.b.x - q.a.x, q.b.y - q.a.y) - Math.hypot(p.b.x - p.a.x, p.b.y - p.a.y))[0]
  const clean = text(await call(request, 'plan_audit', { plan_id: id }))
  expect(clean).not.toContain(`[wall:${target.id}]`)

  const moved = await call(request, 'plan_fix', { plan_id: id, set: [{ wall: target.id, move: { dx: 90, dy: 0 } }] })
  expect(moved.isError, text(moved)).toBeFalsy()
  const bad = text(await call(request, 'plan_audit', { plan_id: id }))
  expect(bad).toContain(`[wall:${target.id}]`)
  expect(bad).toContain('åtgärd')

  const fixed = await call(request, 'plan_fix', { plan_id: id, apply: [`wall:${target.id}`] })
  expect(fixed.isError, text(fixed)).toBeFalsy()
  expect(text(fixed)).toContain(`wall:${target.id}`)
  const after = (await (await request.get(`/api/plans/${id}`)).json()).plan.walls.find((w: { id: string }) => w.id === target.id)
  expect(Math.abs(after.a.x - target.a.x) + Math.abs(after.a.y - target.a.y)).toBeLessThan(40)
  expect(text(await call(request, 'plan_audit', { plan_id: id }))).not.toContain(`[wall:${target.id}]`)

  // Unknown ids and nothing to do are said, not silently accepted.
  expect(text(await call(request, 'plan_fix', { plan_id: id, apply: ['wall:finns-inte'] }))).toContain('finns inte')
  expect((await call(request, 'plan_fix', { plan_id: id, set: [{ wall: 'finns-inte', delete: true }] })).isError).toBe(true)

  // plan_get: only a part, or only what changed – and no picture then.
  const rev = (await (await request.get(`/api/plans/${id}`)).json()).revision.n as number
  const walls = await call(request, 'plan_get', { plan_id: id, only: ['walls'] })
  expect(text(walls)).toContain('Väggar')
  expect(text(walls)).not.toContain('Öppningar (')
  expect(walls.content.some((c) => c.type === 'image')).toBe(false)
  const since = await call(request, 'plan_get', { plan_id: id, since: rev - 1 })
  expect(text(since)).toContain(`~ vägg ${target.id}`)
  expect(since.content.some((c) => c.type === 'image')).toBe(false)
  expect((await call(request, 'plan_get', { plan_id: id })).content.some((c) => c.type === 'image')).toBe(true)

  // plan_view: one picture, zoomed.
  const view = await call(request, 'plan_view', { plan_id: id, rect: { x: target.a.x - 1500, y: target.a.y, w: 3000, h: 3000 } })
  expect(view.content.at(-1)!.type).toBe('image')
})

test('a stretched source drawing is named as such, and the walls are not pulled off the printed size', async ({ request }) => {
  test.setTimeout(180_000)
  const id = await planWithSource(request, 'Sträckt')
  await call(request, 'plan_trace', { plan_id: id, dimensions: DIMS })
  for (let i = 0; i < 3 && /wall:\w+\] /.test(text(await call(request, 'plan_audit', { plan_id: id }))); i++) await call(request, 'plan_fix', { plan_id: id, apply: 'alla' })
  expect(text(await call(request, 'plan_audit', { plan_id: id }))).not.toContain('source-stretched')
  // The plan scaled 1.2 % along y while the drawing stays as it is: what a plan fitted to the printed
  // size looks like against a scan that is stretched the other way.
  const got = (await (await request.get(`/api/plans/${id}`)).json()) as { plan: { walls: Array<{ a: { x: number; y: number } }> }; revision: { n: number } }
  const origin = { x: Math.min(...got.plan.walls.map((w) => w.a.x)), y: Math.min(...got.plan.walls.map((w) => w.a.y)) }
  const scaled = await call(request, 'plan_edit', { plan_id: id, base_revision: got.revision.n, message: 'Sträckt', ops: [{ op: 'scale', origin, fx: 1, fy: 1.012 }] })
  expect(scaled.isError, text(scaled)).toBeFalsy()
  const audit = text(await call(request, 'plan_audit', { plan_id: id }))
  expect(audit).toContain('[plan:source-stretched]')
  expect(audit).toContain('plan_scan_dimension')
  expect(audit).not.toContain('åtgärd: fäst mot ritningen')
})

test('plan_fix verbs: add a wall and a room, edit an opening', async ({ request }) => {
  const id = /Skapad: ([a-z0-9-]+)/.exec(text(await call(request, 'plan_create', { name: 'Verb' })))![1]
  const res = await call(request, 'plan_fix', { plan_id: id, set: [{ add_wall: { a: { x: 0, y: 0 }, b: { x: 4000, y: 0 }, thickness: 200, exterior: true } }, { add_room: { name: 'Kök', at: { x: 2000, y: 1500 } } }] })
  expect(res.isError, text(res)).toBeFalsy()
  const plan = (await (await request.get(`/api/plans/${id}`)).json()).plan
  expect(plan.walls).toHaveLength(1)
  expect(plan.walls[0].id).toBe('w1')
  expect(plan.rooms[0].name).toBe('Kök')
  const bad = await call(request, 'plan_fix', { plan_id: id, set: [{ nonsense: true }] })
  expect(bad.isError).toBe(true)
  expect(text(bad)).toContain('okänd rad')
})
