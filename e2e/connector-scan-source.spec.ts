import { test, expect } from '@playwright/test'
import { readFileSync } from 'fs'
import { SCAN_ACTIONS, SOURCE_ACTIONS } from '@/lib/plan/connector/registries'
import { connector, legacy, makePlan } from './connector-helpers'

const TIF = readFileSync('e2e/fixtures/test-scan.tif').toString('base64')
const text = (r: { content: Array<{ text?: string }> }) => r.content.map((c) => c.text ?? '').join('\n')

async function planWithTif(request: Parameters<typeof makePlan>[0]) {
  const { id } = await makePlan(request, 'Skanning')
  const added = await connector(request, 'source', { id, base_revision: 1, action: 'add', args: { id: 'arkiv', filename: 'test-scan.tif', data_base64: TIF, mm_per_px: 10 } })
  expect(added.isError, text(added)).toBeFalsy()
  expect(added.structuredContent!.revision).toBe(2)
  return id
}

test('source: upload_link, add, a dry run and calibrate', async ({ request }) => {
  const id = await planWithTif(request)
  const link = await connector(request, 'source', { id, action: 'upload_link' })
  expect(link.structuredContent!.data!.link).toContain(`/plans/${id}/upload`)

  const args = { measurements: [{ a: { x: 250, y: 1750 }, b: { x: 2750, y: 1750 }, mm: 2600, label: 'skalstock' }], anchor: { x: 0, y: 0 } }
  const dry = await connector(request, 'source', { id, base_revision: 2, action: 'calibrate', dry_run: true, args })
  expect(dry.isError, text(dry)).toBeFalsy()
  expect(dry.structuredContent!.revision).toBe(2)
  expect(text(dry)).toContain('Faktor 1.04000')
  const real = await connector(request, 'source', { id, base_revision: 2, action: 'calibrate', args })
  expect(real.structuredContent!.revision).toBe(3)
  expect(text(real)).toContain('Faktor 1.04000')
  expect((await legacy(request, 'plan_get', { plan_id: id })).content[0].text).toContain('10.4000 mm/px')

  const stale = await connector(request, 'source', { id, base_revision: 2, action: 'calibrate', args })
  expect(stale.isError).toBe(true)
  expect(stale.structuredContent!.findings![0].code).toBe('stale-revision')
  const refused = await connector(request, 'source', { id, base_revision: 3, action: 'add', dry_run: true, args: {} })
  expect(refused.structuredContent!.findings![0].code).toBe('bad-argument')
})

test('scan reads and proposes but never saves', async ({ request }) => {
  const id = await planWithTif(request)
  const prof = await connector(request, 'scan', { id, action: 'profile', args: { from: { x: 0, y: 1750 }, to: { x: 3000, y: 1750 } } })
  expect(prof.isError, text(prof)).toBeFalsy()
  const run = /1\. (\d+)–(\d+) mm/.exec(text(prof))!
  expect(Math.abs(Number(run[1]) - 250)).toBeLessThanOrEqual(10)
  expect(Math.abs(Number(run[2]) - 2760)).toBeLessThanOrEqual(10)

  const snap = await connector(request, 'scan', { id, action: 'snap_walls', args: { walls: [{ id: 'n1', a: { x: 250, y: 1750 }, b: { x: 2750, y: 1750 }, thickness: 100 }] } })
  const after = await legacy(request, 'plan_get', { plan_id: id, only: ['sheet'] })
  expect(text(after)).toContain('Revision 2')
  expect(snap.isError, text(snap)).toBeFalsy()
  expect(text(snap)).not.toContain('Sparad som revision')
  const n = snap.structuredContent!.next![0]
  expect(n.tool).toBe('edit')
  expect(n.arguments.base_revision).toBe(2)
  expect(snap.structuredContent!.revision).toBe(2)
  const applied = await connector(request, 'edit', n.arguments)
  expect(applied.isError, text(applied)).toBeFalsy()
  expect(applied.structuredContent!.revision).toBe(3)
})

test('unknown actions and bad arguments are findings', async ({ request }) => {
  const { id } = await makePlan(request, 'Skanning fel')
  const a = await connector(request, 'scan', { id, action: 'profil' })
  expect(a.structuredContent!.findings![0]).toMatchObject({ code: 'unknown-name', data: { nearest: 'profile' } })
  const b = await connector(request, 'source', { id, base_revision: 1, action: 'trac' })
  expect(b.structuredContent!.findings![0]).toMatchObject({ code: 'unknown-name', data: { nearest: 'trace' } })
  const c = await connector(request, 'scan', { id, action: 'profile', args: 5 })
  expect(c.structuredContent!.findings![0].code).toBe('bad-argument')
  const d = await connector(request, 'scan', { id: 'finns-inte-alls', action: 'profile' })
  expect(d.structuredContent!.findings![0].code).toBe('not-found')
})

test('every action is handled and described by the guide', async ({ request }) => {
  const { id } = await makePlan(request, 'Skanning alla')
  for (const name of SCAN_ACTIONS.names()) {
    const r = await connector(request, 'scan', { id, action: name, args: {} })
    expect(r.structuredContent!.findings?.[0]?.code, name).not.toBe('unknown-name')
  }
  for (const name of SOURCE_ACTIONS.names()) {
    const r = await connector(request, 'source', { id, base_revision: 1, action: name, args: {} })
    expect(r.structuredContent!.findings?.[0]?.code, name).not.toBe('unknown-name')
    expect(r.structuredContent!.findings?.[0]?.code, name).not.toBe('not-implemented')
  }
  for (const topic of ['scan', 'source']) {
    const g = text(await connector(request, 'guide', { topic }))
    for (const name of (topic === 'scan' ? SCAN_ACTIONS : SOURCE_ACTIONS).names()) expect(g, name).toContain(name)
  }
})

const NOMINAL = (25.4 / 300) * 100
const mm = (p: { x: number; y: number }) => ({ x: p.x * NOMINAL, y: p.y * NOMINAL })
const DIMS = [
  { label: 'längd', a: mm({ x: 693, y: 268 }), b: mm({ x: 693, y: 1931 }), mm: 10500 },
  { label: 'bredd', a: mm({ x: 774, y: 2122 }), b: mm({ x: 1726, y: 2122 }), mm: 6080 },
]

test('source trace makes a first draft of the cellar', { tag: '@slow' }, async ({ request }) => {
  test.setTimeout(120_000)
  const id = /Skapad: ([a-z0-9-]+)/.exec(text(await legacy(request, 'plan_create', { name: `Trace ${Date.now()}` })))![1]
  const added = await connector(request, 'source', { id, base_revision: 1, action: 'add', args: { id: 'kallare', role: 'archive', filename: 'kallare.png', data_base64: readFileSync('e2e/fixtures/cellar/kallare.png').toString('base64'), scale: 100, dpi: 300 } })
  expect(added.isError, text(added)).toBeFalsy()
  const bare = await connector(request, 'source', { id, base_revision: 2, action: 'trace' })
  expect(text(bare)).toContain('printed_outer_mm')
  const out = await connector(request, 'source', { id, base_revision: 2, action: 'trace', args: { printed_outer_mm: { width: 6080, length: 10500 }, dimensions: DIMS } })
  expect(out.isError, text(out)).toBeFalsy()
  expect(out.content.at(-1)!.type).toBe('image')
  expect(out.structuredContent!.revision).toBeGreaterThan(2)
  expect(out.structuredContent!.changed!.length).toBeGreaterThan(8)
  const plan = (await (await request.get(`/api/plans/${id}`)).json()).plan
  expect(plan.walls.length).toBeGreaterThanOrEqual(8)
  expect(plan.sources[0].calibration).toBeTruthy()
})
