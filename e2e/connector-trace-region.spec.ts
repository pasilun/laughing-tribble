import { test, expect } from '@playwright/test'
import { readFileSync } from 'fs'
import type { Plan, Wall } from '@/lib/plan/domain/types'
import { connector, legacy } from './connector-helpers'

// source (action "trace") with args.region: only that part of the sheet is traced. The 1999 survey crop shows three
// flats; tracing 154 (south-west) and then 152 (north-west) adds each flat's walls without touching the other's.

const F = 'e2e/fixtures/flat'
const touches = (w: Wall, q: number[]) => Math.max(w.a.x, w.b.x) >= q[0] && Math.min(w.a.x, w.b.x) <= q[0] + q[2] && Math.max(w.a.y, w.b.y) >= q[1] && Math.min(w.a.y, w.b.y) <= q[1] + q[3]

async function calibratedCrop(request: Parameters<typeof connector>[0]) {
  const c = JSON.parse(readFileSync(`${F}/case.json`, 'utf8')) as { mm_per_px: number; x: number; y: number }
  const made = await connector(request, 'manage', { action: 'create', args: { name: `Område ${Date.now()}` } })
  const id = made.structuredContent!.id!
  const added = await legacy(request, 'plan_source_add', { plan_id: id, base_revision: made.structuredContent!.revision, id: 'a00', role: 'archive', filename: 'a00-crop.png', data_base64: readFileSync(`${F}/a00-crop.png`).toString('base64'), mm_per_px: c.mm_per_px, x: c.x, y: c.y })
  expect(added.isError, added.content[0].text).toBeFalsy()
  const rev = (await (await request.get(`/api/plans/${id}`)).json()).revision.n as number
  const cal = await request.post(`/api/plans/${id}/ops`, { data: { ops: [{ op: 'update', kind: 'source', id: 'a00', patch: { calibration: 'case.json' } }], baseRevision: rev, message: 'kalibrerad' } })
  expect(cal.status()).toBe(200)
  return { id, revision: rev + 1 }
}

const plan = async (request: Parameters<typeof connector>[0], id: string) => (await (await request.get(`/api/plans/${id}`)).json()).plan as Plan

test('trace in a region adds only that part, and a second region adds to it', async ({ request }) => {
  test.setTimeout(120_000)
  const { id, revision } = await calibratedCrop(request)
  const flat154 = [20400, 15500, 6100, 5500]
  const one = await connector(request, 'source', { id, base_revision: revision, action: 'trace', args: { region: flat154 } })
  expect(one.isError, one.content[0].text).toBeFalsy()
  const after1 = await plan(request, id)
  expect(after1.walls.length).toBeGreaterThan(4)
  expect(after1.walls.every((w) => touches(w, flat154))).toBe(true)
  // The facade is not marked from a region: only the whole house shows which walls are outside.
  expect(after1.walls.some((w) => w.exterior)).toBe(false)

  const flat152 = [19300, 7800, 5400, 5400]
  const two = await connector(request, 'source', { id, base_revision: one.structuredContent!.revision, action: 'trace', args: { region: flat152 } })
  expect(two.isError, two.content[0].text).toBeFalsy()
  const after2 = await plan(request, id)
  const ids = after2.walls.map((w) => w.id)
  expect(new Set(ids).size).toBe(ids.length)
  // The first flat's walls are kept as they were.
  for (const w of after1.walls) expect(after2.walls.find((x) => x.id === w.id)).toEqual(w)
  expect(after2.walls.length).toBeGreaterThan(after1.walls.length)
  expect(after2.walls.filter((w) => !after1.walls.some((x) => x.id === w.id)).every((w) => touches(w, flat152))).toBe(true)

  // A region that already has walls is left alone.
  const again = await connector(request, 'source', { id, base_revision: two.structuredContent!.revision, action: 'trace', args: { region: flat154 } })
  expect(again.content[0].text).toContain('Området hade redan')
  expect((await plan(request, id)).walls.length).toBe(after2.walls.length)
})

test('a region that is not [x, y, w, h] is a bad-argument finding', async ({ request }) => {
  const { id, revision } = await calibratedCrop(request)
  const r = await connector(request, 'source', { id, base_revision: revision, action: 'trace', args: { region: [0, 0, 100] } })
  expect(r.structuredContent!.ok).toBe(false)
  expect(r.structuredContent!.findings![0].code).toBe('bad-argument')
  expect(r.structuredContent!.findings![0].refs).toEqual(['args.region'])
})
