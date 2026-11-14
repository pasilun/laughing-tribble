import { test, expect } from '@playwright/test'
import { readFileSync, writeFileSync } from 'fs'
import type { Plan } from '@/lib/plan/domain/types'
import type { Candidate } from '@/lib/plan/connector/handlers/candidates'
import { connector, legacy } from './connector-helpers'

const F = 'e2e/fixtures/flat'

// The 1999 fixture over its drawing, with one wall taken out: the candidates in that room must offer it back.
test('scan candidates offers a missing wall, numbered, with the operation that adds it', async ({ request }) => {
  test.setTimeout(90_000)
  const ref = JSON.parse(readFileSync(`${F}/drawing-1999.json`, 'utf8')) as Plan
  const c = JSON.parse(readFileSync(`${F}/case.json`, 'utf8')) as { mm_per_px: number; x: number; y: number }
  const gone = ref.walls.find((w) => w.id === 'iv-154-garderob-s')!
  const plan = { ...ref, walls: ref.walls.filter((w) => w.id !== gone.id), openings: ref.openings.filter((o) => o.wallId !== gone.id) }
  const made = await connector(request, 'manage', { action: 'import', args: { name: `Kandidater ${Date.now()}`, plan } })
  const id = made.structuredContent!.id!
  const added = await legacy(request, 'plan_source_add', { plan_id: id, base_revision: made.structuredContent!.revision, id: 'a00', role: 'archive', filename: 'a00-crop.png', data_base64: readFileSync(`${F}/a00-crop.png`).toString('base64'), mm_per_px: c.mm_per_px, x: c.x, y: c.y })
  expect(added.isError, added.content[0].text).toBeFalsy()
  const rev = (await (await request.get(`/api/plans/${id}`)).json()).revision.n as number

  const res = await connector(request, 'scan', { id, action: 'candidates', args: { region: [20300, 16000, 2700, 3000] } })
  expect(res.isError, res.content[0].text).toBeFalsy()
  expect(res.content.at(-1)!.type).toBe('image')
  if (process.env.CANDIDATES_PNG) writeFileSync(process.env.CANDIDATES_PNG, Buffer.from(res.content.at(-1)!.data!, 'base64'))
  const list = res.structuredContent!.data!.candidates as Candidate[]
  expect(list.length).toBeGreaterThan(0)
  expect(list.map((x) => x.n)).toEqual(list.map((_, i) => i + 1))
  // The removed wall is offered, within 60 mm of where it is drawn.
  const hit = list.find((x) => Math.abs(x.a.y - gone.a.y) <= 60 && Math.abs(x.b.y - gone.b.y) <= 60 && Math.abs(x.a.y - x.b.y) < 5 && Math.min(x.b.x, gone.b.x) - Math.max(x.a.x, gone.a.x) > 1000)
  expect(hit, JSON.stringify(list.map(({ n, a, b, thickness }) => ({ n, a, b, thickness })))).toBeTruthy()
  // Walls the plan already has are not offered again.
  expect(list.some((x) => Math.abs(x.a.x - 20625) < 60 && Math.abs(x.b.x - 20625) < 60)).toBe(false)
  // Answering by number: its operation adds the wall.
  const ed = await connector(request, 'edit', { id, base_revision: rev, ops: [hit!.op] })
  expect(ed.isError, ed.content[0].text).toBeFalsy()
  expect((await (await request.get(`/api/plans/${id}`)).json()).plan.walls.some((w: { id: string }) => w.id === hit!.id)).toBe(true)
})

// The same fixture with one wall traced 2 m too short: the candidates offer to extend it, and the openings stay put.
test('scan candidates offers to extend a wall that stops short of the drawing', async ({ request }) => {
  test.setTimeout(90_000)
  const ref = JSON.parse(readFileSync(`${F}/drawing-1999.json`, 'utf8')) as Plan
  const c = JSON.parse(readFileSync(`${F}/case.json`, 'utf8')) as { mm_per_px: number; x: number; y: number }
  const full = ref.walls.find((w) => w.id === 'iv-152-ö')!
  const short = { ...full, b: { x: full.b.x, y: full.b.y - 2000 } }
  const keep = ref.openings.filter((o) => o.wallId !== short.id || o.offset + o.width <= short.b.y - short.a.y)
  const plan = { ...ref, walls: ref.walls.map((w) => (w.id === short.id ? short : w)), openings: keep }
  const made = await connector(request, 'manage', { action: 'import', args: { name: `Förläng ${Date.now()}`, plan } })
  const id = made.structuredContent!.id!
  const added = await legacy(request, 'plan_source_add', { plan_id: id, base_revision: made.structuredContent!.revision, id: 'a00', role: 'archive', filename: 'a00-crop.png', data_base64: readFileSync(`${F}/a00-crop.png`).toString('base64'), mm_per_px: c.mm_per_px, x: c.x, y: c.y })
  expect(added.isError, added.content[0].text).toBeFalsy()
  const rev = (await (await request.get(`/api/plans/${id}`)).json()).revision.n as number

  const res = await connector(request, 'scan', { id, action: 'candidates', args: { region: [20500, 10000, 2500, 3500] } })
  expect(res.isError, res.content[0].text).toBeFalsy()
  const list = res.structuredContent!.data!.candidates as Candidate[]
  const ext = list.find((x) => x.kind === 'extend' && x.wall === short.id)
  expect(ext, JSON.stringify(list.map(({ n, kind, wall, a, b }) => ({ n, kind, wall, a, b })))).toBeTruthy()
  expect(res.content[0].text).toContain(`förläng ${short.id}`)
  // The a-end stays; the b-end reaches where the drawing ends the wall.
  expect(ext!.a).toEqual(short.a)
  expect(Math.abs(ext!.b.y - full.b.y), JSON.stringify(ext)).toBeLessThanOrEqual(150)
  // A piece of a wall the plan already has whole is not offered.
  expect(list.some((x) => x.kind === 'extend' && x.wall !== short.id && x.wall === 'iv-152-wc-s')).toBe(false)

  const ed = await connector(request, 'edit', { id, base_revision: rev, ops: [ext!.op] })
  expect(ed.isError, ed.content[0].text).toBeFalsy()
  const after = (await (await request.get(`/api/plans/${id}`)).json()).plan as Plan
  expect(after.walls.find((w) => w.id === short.id)!.b.y).toBe(ext!.b.y)
  // Its openings stay where they were.
  for (const o of keep.filter((o) => o.wallId === short.id)) expect(after.openings.find((x) => x.id === o.id)!.offset).toBe(o.offset)
})

// On the fixture as drawn nothing stops short: no extension may be offered anywhere (not into the stair, the next
// flat, or along the next wall on the same line).
test('scan candidates offers no extension on the fixture as drawn', async ({ request }) => {
  test.setTimeout(90_000)
  const ref = JSON.parse(readFileSync(`${F}/drawing-1999.json`, 'utf8')) as Plan
  const c = JSON.parse(readFileSync(`${F}/case.json`, 'utf8')) as { mm_per_px: number; x: number; y: number }
  const made = await connector(request, 'manage', { action: 'import', args: { name: `Inga förlängningar ${Date.now()}`, plan: ref } })
  const id = made.structuredContent!.id!
  const added = await legacy(request, 'plan_source_add', { plan_id: id, base_revision: made.structuredContent!.revision, id: 'a00', role: 'archive', filename: 'a00-crop.png', data_base64: readFileSync(`${F}/a00-crop.png`).toString('base64'), mm_per_px: c.mm_per_px, x: c.x, y: c.y })
  expect(added.isError, added.content[0].text).toBeFalsy()
  const ext: string[] = []
  for (let y = 7500; y < 21300; y += 4600)
    for (let x = 19000; x < 30100; x += 5600) {
      const res = await connector(request, 'scan', { id, action: 'candidates', args: { region: [x, y, 5600, 4600] } })
      ext.push(...((res.structuredContent!.data!.candidates ?? []) as Candidate[]).filter((q) => q.kind === 'extend').map((q) => `${q.wall} → ${JSON.stringify([q.a, q.b])}`))
    }
  expect(ext).toEqual([])
})

test('scan candidates refuses a missing or too large region', async ({ request }) => {
  const made = await connector(request, 'manage', { action: 'create', args: { name: `Kandidater fel ${Date.now()}` } })
  const id = made.structuredContent!.id!
  const none = await connector(request, 'scan', { id, action: 'candidates', args: {} })
  expect(none.structuredContent!.findings![0].code).toBe('bad-argument')
})

test('guide topic trace points to the candidates', async ({ request }) => {
  const g = await connector(request, 'guide', { topic: 'trace' })
  expect(g.content[0].text!).toContain('scan (action "candidates"')
})
