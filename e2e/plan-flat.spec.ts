import { test, expect, type APIRequestContext, type TestInfo } from '@playwright/test'
import { readFileSync } from 'fs'
import type { Opening, Plan, Wall } from '@/lib/plan/types'

// The golden case from a real flat: lgh 152–154 as the user's model has it (rev 40, traced from the
// 1999 survey A00:24 and checked against the 1936 drawing and laser measurements), and the survey
// itself (a crop of the straightened scan). The walls are shifted 60–120 mm off and given back to
// the snapper, the openings are read from the drawing, and both are scored against the model.
//
// The model was traced from this same drawing, so the score says how well the tools reproduce
// a careful tracing, not what the flat is. The north-west corner of 152 (kitchenette, WC, stair)
// is where the laser measurements and the model differ most: its walls are measured and listed
// but kept out of the limits. The limits are today's baseline; raise them as the tools improve.
//
// Files: e2e/fixtures/flat/{reference.json, a00-crop.png, case.json}

const F = 'e2e/fixtures/flat'
const reference = () => JSON.parse(readFileSync(`${F}/reference.json`, 'utf8')) as Plan
const kase = () => JSON.parse(readFileSync(`${F}/case.json`, 'utf8')) as { mm_per_px: number; x: number; y: number }
// Where the laser measurements and the model disagree: not part of the pass/fail limits.
const UNCERTAIN = new Set(['yt-v-152', 'lg-trapphus-152', 'iv-152-wc-n', 'iv-152-wc-s', 'bv-152-block', 'sk-152-pelare'])

async function call(request: APIRequestContext, name: string, args: Record<string, unknown>) {
  const res = await request.post('/api/mcp', { data: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } } })
  expect(res.status()).toBe(200)
  const r = (await res.json()).result as { content: Array<{ type: string; text?: string }>; isError?: boolean }
  return { text: r.content.map((c) => c.text ?? '').join('\n'), isError: r.isError }
}
const get = async (request: APIRequestContext, id: string) => {
  const j = await (await request.get(`/api/plans/${id}`)).json()
  return { plan: j.plan as Plan, rev: j.revision.n as number }
}
async function ops(request: APIRequestContext, id: string, list: unknown[], base: number, message: string) {
  const res = await request.post(`/api/plans/${id}/ops`, { data: { ops: list, baseRevision: base, message } })
  expect(res.status(), await res.text()).toBe(200)
  return (await res.json()).revision.n as number
}

// The model in the store with the drawing as a source, walls moved by a seeded error.
async function setup(request: APIRequestContext, shift: number) {
  const ref = reference()
  const c = kase()
  const imp = await call(request, 'plan_import', { name: 'Golden lgh', plan: ref })
  const id = /Importerad: ([a-z0-9-]+)/.exec(imp.text)![1]
  await call(request, 'plan_source_add', { plan_id: id, base_revision: (await get(request, id)).rev, id: 'a00', role: 'archive', filename: 'a00-crop.png', data_base64: readFileSync(`${F}/a00-crop.png`).toString('base64'), mm_per_px: c.mm_per_px, x: c.x, y: c.y })
  let seed = 12345
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1
  const rough = ref.walls.map((w) => {
    const dx = w.b.x - w.a.x
    const dy = w.b.y - w.a.y
    const l = Math.hypot(dx, dy)
    const s = rnd() * shift
    const e1 = rnd() * 60
    const e2 = rnd() * 60
    return { id: w.id, a: { x: Math.round(w.a.x - (dy / l) * s - (dx / l) * e1), y: Math.round(w.a.y + (dx / l) * s - (dy / l) * e1) }, b: { x: Math.round(w.b.x - (dy / l) * s + (dx / l) * e2), y: Math.round(w.b.y + (dx / l) * s + (dy / l) * e2) } }
  })
  const base = await ops(request, id, rough.map((r) => ({ op: 'update', kind: 'wall', id: r.id, patch: { a: r.a, b: r.b } })), (await get(request, id)).rev, 'grov placering')
  const snap = await call(request, 'plan_scan_snap_walls', { plan_id: id, base_revision: base, source_id: 'a00', wall_ids: ref.walls.map((w) => w.id), apply: true })
  expect(snap.isError, snap.text).toBeFalsy()
  return { id, ref, rough, snap: snap.text }
}

const centre = (w: Wall) => (Math.abs(w.b.x - w.a.x) < Math.abs(w.b.y - w.a.y) ? (w.a.x + w.b.x) / 2 : (w.a.y + w.b.y) / 2)
const angle = (w: Wall) => (Math.atan2(w.b.y - w.a.y, w.b.x - w.a.x) * 180) / Math.PI
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1]

function score(ref: Plan, got: Plan) {
  const rows = ref.walls.map((r) => {
    const w = got.walls.find((x) => x.id === r.id)!
    let da = Math.abs(angle(w) - angle(r)) % 180
    if (da > 90) da = 180 - da
    return { id: r.id, dpos: Math.round(centre(w) - centre(r)), dth: w.thickness - r.thickness, dangle: da, uncertain: UNCERTAIN.has(r.id) }
  })
  return rows
}
const table = (rows: ReturnType<typeof score>) => rows.map((r) => `${r.id.padEnd(22)} ${String(r.dpos).padStart(5)} mm  tjocklek ${String(r.dth).padStart(4)}  vinkel ${r.dangle.toFixed(1)}°${r.uncertain ? '  (osäker del)' : ''}`).join('\n')

async function attach(info: TestInfo, name: string, body: string) {
  await info.attach(name, { body, contentType: 'text/plain' })
}

test('walls: shifted 60 mm off, the snapper puts them back within drawing accuracy', async ({ request }, info) => {
  const { id, ref } = await setup(request, 60)
  const rows = score(ref, (await get(request, id)).plan)
  await attach(info, 'väggar', table(rows))
  const sure = rows.filter((r) => !r.uncertain)
  const abs = sure.map((r) => Math.abs(r.dpos))
  // Baseline: median 25 mm, 75 % within 50 mm, 90th percentile 77 mm.
  expect(median(abs)).toBeLessThanOrEqual(40)
  expect(abs.filter((x) => x <= 50).length / abs.length).toBeGreaterThanOrEqual(0.65)
  expect([...abs].sort((a, b) => a - b)[Math.floor(abs.length * 0.9)]).toBeLessThanOrEqual(100)
  // No wall ends up further from where it belongs than where it started, and none turns.
  expect(Math.max(...rows.map((r) => Math.abs(r.dpos)))).toBeLessThanOrEqual(150)
  const turned = rows.filter((r) => r.dangle > 2)
  expect(turned.map((r) => `${r.id} ${r.dangle.toFixed(1)}°`), 'väggar som har vridits').toEqual([])
})

test('walls: 120 mm off, a fit that rests on noise leaves the wall alone instead of throwing it across the flat', async ({ request }, info) => {
  const { id, ref, snap } = await setup(request, 120)
  const rows = score(ref, (await get(request, id)).plan)
  await attach(info, 'väggar 120 mm', table(rows))
  // The short wall beside the stair used to become a 9.6 m diagonal at 74° and still count as "ok".
  expect(Math.max(...rows.map((r) => Math.abs(r.dpos)))).toBeLessThanOrEqual(200)
  const turned = rows.filter((r) => r.dangle > 5)
  expect(turned.map((r) => `${r.id} ${r.dangle.toFixed(1)}°`), 'väggar som har vridits').toEqual([])
  // The walls it could not place say so.
  expect(snap).toContain('OSÄKER')
})

test('openings and windows: what the readers find in the 1999 survey, against the model (baseline)', async ({ request }, info) => {
  const { id, ref } = await setup(request, 60)
  const cur = await get(request, id)
  const base = await ops(request, id, cur.plan.openings.map((o) => ({ op: 'delete', kind: 'opening', id: o.id })), cur.rev, 'utan öppningar')
  const read = await call(request, 'plan_scan_openings', { plan_id: id, base_revision: base, source_id: 'a00' })
  expect(read.isError, read.text).toBeFalsy()
  const found = [...read.text.matchAll(/^\d+\. (o-\S+): (fönster|dörr|öppning)[^\n]*? i (\S+?),? offset (\d+), bredd (\d+)/gm)].map((m) => ({ id: m[1], kind: m[2], wall: m[3].replace(/,$/, ''), offset: +m[4], width: +m[5] }))
  const ov = (a: { offset: number; width: number }, b: { offset: number; width: number }) => Math.min(a.offset + a.width, b.offset + b.width) - Math.max(a.offset, b.offset)
  const hit = (o: Opening) => found.some((f) => f.wall === o.wallId && ov(f, o) >= 0.4 * Math.min(f.width, o.width))
  const doors = ref.openings.filter((o) => o.kind !== 'window')
  const wins = ref.openings.filter((o) => o.kind === 'window')
  const doorHits = doors.filter(hit)
  const winHits = wins.filter(hit)
  const report = [
    `dörrar och öppningar: ${doorHits.length}/${doors.length} funna, saknas: ${doors.filter((o) => !hit(o)).map((o) => o.id).join(', ')}`,
    `fönster: ${winHits.length}/${wins.length} funna, saknas: ${wins.filter((o) => !hit(o)).map((o) => o.id).join(', ')}`,
    `funna totalt ${found.length}`,
  ].join('\n')
  await attach(info, 'öppningar', report)
  // Baseline today (the readers are tuned for clean and 1936-style drawings; this survey outlines
  // each room and draws windows as thin lines): doors and openings 4 of 18, windows 1 of 7.
  expect(doorHits.length).toBeGreaterThanOrEqual(3)
  expect(winHits.length).toBeGreaterThanOrEqual(1)
  // Not a flood of false finds.
  expect(found.length).toBeLessThanOrEqual(40)
})
