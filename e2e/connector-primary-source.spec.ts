import { test, expect } from '@playwright/test'
import { readFileSync } from 'fs'
import { sourceIdOf } from '@/lib/plan/assist/audit'
import { resolveSource } from '@/lib/plan/scan/raster'
import { demoPlan } from '@/lib/plan/domain/demo'
import type { Source } from '@/lib/plan/domain/types'
import { connector, legacy, makePlan } from './connector-helpers'

const src = (id: string, more: Partial<Source> = {}): Source => ({ id, name: id, role: 'archive', src: 'x', widthPx: 10, heightPx: 10, mmPerPx: 1, x: 0, y: 0, rotation: 0, ...more })

test('with several sources the primary one is used when none is named', () => {
  const plan = { ...demoPlan('p'), sources: [src('a00-24', { calibration: '16 mått' }), src('a00', { primary: true }), src('a-1936')] }
  expect(sourceIdOf(plan)).toBe('a00')
  expect(resolveSource(plan).id).toBe('a00')
  // A named source still wins.
  expect(sourceIdOf(plan, 'a-1936')).toBe('a-1936')
  expect(resolveSource(plan, 'a-1936').id).toBe('a-1936')
  // Without a primary one, the rule of before: the first archive drawing.
  const plain = { ...plan, sources: plan.sources.map((s) => ({ ...s, primary: undefined })) }
  expect(sourceIdOf(plain)).toBe('a00-24')
})

test('edit marks a source primary and the views use it', async ({ request }) => {
  const { id } = await makePlan(request, 'Primär källa')
  const png = readFileSync('e2e/fixtures/test-scan.tif').toString('base64')
  for (const [n, sid] of [[1, 'forsta'], [2, 'andra']] as const) {
    const added = await legacy(request, 'plan_source_add', { plan_id: id, base_revision: n, id: sid, filename: 'test-scan.tif', data_base64: png, mm_per_px: 10 })
    expect(added.isError, added.content[0].text).toBeFalsy()
  }
  const before = await connector(request, 'view', { id, view: 'source' })
  expect(before.structuredContent!.data!.source).toBe('forsta')
  const marked = await connector(request, 'edit', { id, base_revision: 3, ops: [{ op: 'update', kind: 'source', id: 'andra', patch: { primary: true } }] })
  expect(marked.isError, marked.content[0].text).toBeFalsy()
  const after = await connector(request, 'view', { id, view: 'source' })
  expect(after.structuredContent!.data!.source).toBe('andra')
})
