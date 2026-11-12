import { test, expect } from '@playwright/test'
import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { scorePlan } from '@/lib/plan/bench/score'
import type { Plan } from '@/lib/plan/domain/types'
import { connector, legacy } from './connector-helpers'

// Benchmark: a first draft of the 1999 survey from scratch (an empty plan, the crop at its known scale, then
// source trace), scored against the fixture drawn with the maintainer (e2e/fixtures/flat/drawing-1999.json).
// The limits are the baseline of 2026-11-12: raise them as the tracer improves, never lower them without a reason.
// The scores are written to test-results/bench-trace-1999.json.

const F = 'e2e/fixtures/flat'
const BASELINE = { recall100: 0.61, precision100: 0.83, doorways: 6, windows: 7 }

test('trace the 1999 survey from scratch and score it', { tag: '@slow' }, async ({ request }) => {
  test.setTimeout(180_000)
  const ref = JSON.parse(readFileSync(`${F}/drawing-1999.json`, 'utf8')) as Plan
  const c = JSON.parse(readFileSync(`${F}/case.json`, 'utf8')) as { mm_per_px: number; x: number; y: number }
  const made = await connector(request, 'manage', { action: 'create', args: { name: `Bench 1999 ${Date.now()}` } })
  const id = made.structuredContent!.id!
  const added = await legacy(request, 'plan_source_add', { plan_id: id, base_revision: made.structuredContent!.revision, id: 'a00', role: 'archive', filename: 'a00-crop.png', data_base64: readFileSync(`${F}/a00-crop.png`).toString('base64'), mm_per_px: c.mm_per_px, x: c.x, y: c.y })
  expect(added.isError, added.content[0].text).toBeFalsy()
  // The crop's scale is known exactly: mark it calibrated so trace does not try to calibrate it again.
  const rev = (await (await request.get(`/api/plans/${id}`)).json()).revision.n as number
  const cal = await request.post(`/api/plans/${id}/ops`, { data: { ops: [{ op: 'update', kind: 'source', id: 'a00', patch: { calibration: 'case.json' } }], baseRevision: rev, message: 'kalibrerad' } })
  expect(cal.status()).toBe(200)
  const t0 = Date.now()
  const out = await connector(request, 'source', { id, base_revision: rev + 1, action: 'trace', args: { source_id: 'a00' } })
  const seconds = (Date.now() - t0) / 1000
  const got = (await (await request.get(`/api/plans/${id}`)).json()).plan as Plan
  const score = { seconds, traceOk: !out.isError, findings: (out.structuredContent?.findings ?? []).map((f) => f.code), ...scorePlan(ref, got) }
  mkdirSync('test-results', { recursive: true })
  writeFileSync('test-results/bench-trace-1999.json', JSON.stringify(score, null, 1))
  console.log('BENCH', JSON.stringify(score))
  expect(score.walls.recall['100']).toBeGreaterThanOrEqual(BASELINE.recall100)
  expect(score.walls.precision100).toBeGreaterThanOrEqual(BASELINE.precision100)
  expect(score.openings.doorways.found).toBeGreaterThanOrEqual(BASELINE.doorways)
  expect(score.openings.windows.found).toBeGreaterThanOrEqual(BASELINE.windows)
})
