import { test, expect } from '@playwright/test'
import { readFileSync } from 'fs'
import { connector, legacy, makePlan } from './connector-helpers'

test('view', async ({ request }) => {
  const { id } = await makePlan(request, 'View test')
  const sheet = await connector(request, 'view', { id })
  expect(sheet.structuredContent!.ok).toBe(true); expect(sheet.content[1].type).toBe('image')
  expect((await connector(request, 'view', { id, options: { sheet: 'fore' } })).content[1].type).toBe('image')
  expect((await connector(request, 'view', { id, view: 'sheet', region: { rect_mm: [0, 0, 100, 100] } })).structuredContent!.findings![0].code).toBe('bad-argument')
  expect((await connector(request, 'view', { id, view: 'sheat' })).structuredContent!.findings![0].data!.nearest).toBe('sheet')
  expect((await connector(request, 'view', { id, options: { sheet: 'efer' } })).structuredContent!.findings![0].data!.nearest).toBe('efter')
  const none = (await connector(request, 'view', { id, view: 'overlay' })).structuredContent!
  expect(none.ok).toBe(false); expect(none.findings![0].code).toBe('no-source'); expect(none.next![0]).toMatchObject({ tool: 'source', arguments: { id, action: 'upload_link' } })
  expect((await connector(request, 'view', { id: 'no-such-plan' })).structuredContent!.findings![0].code).toBe('not-found')

  const added = await legacy(request, 'plan_source_add', { plan_id: id, base_revision: 1, id: 'arkiv', filename: 'test-scan.tif', data_base64: readFileSync('e2e/fixtures/test-scan.tif').toString('base64'), mm_per_px: 10 })
  expect(added.isError, added.content[0].text).toBeFalsy()
  await legacy(request, 'plan_edit', { plan_id: id, base_revision: 2, message: 'v', ops: [{ op: 'add', kind: 'wall', item: { id: 'w1', a: { x: 500, y: 500 }, b: { x: 2500, y: 500 }, thickness: 100, phase: 'existing' } }] })
  const ov = await connector(request, 'view', { id, view: 'overlay', region: { rect_mm: [0, 0, 3000, 2000] } })
  expect(ov.structuredContent!.ok, JSON.stringify(ov.structuredContent)).toBe(true); expect(ov.content[1].type).toBe('image')
  expect(ov.structuredContent!.data).toMatchObject({ rect_mm: [0, 0, 3000, 2000], source: 'arkiv' })
  const src = await connector(request, 'view', { id, view: 'source' })
  expect(src.structuredContent!.ok).toBe(true); expect(src.content[1].type).toBe('image')
  const el = await connector(request, 'view', { id, view: 'overlay', region: { id: 'w1' } })
  expect(el.structuredContent!.ok, JSON.stringify(el.structuredContent)).toBe(true)
  expect((await connector(request, 'view', { id, view: 'overlay', region: { id: 'nope' } })).structuredContent!.findings![0].code).toBe('unknown-element')
  expect((await connector(request, 'view', { id, view: 'overlay', region: { rect_mm: [0, 0] } })).structuredContent!.findings![0].code).toBe('bad-argument')
  const w = (await connector(request, 'view', { id, view: 'overlay', region: { rect_mm: [0, 0, 3000, 2000] } })).structuredContent!.data!.image as { size_px: number[]; mm_per_px: number; origin_mm: number[] }
  expect(Math.max(...w.size_px)).toBe(1120); expect(w.mm_per_px).toBeCloseTo(3000 / 1120, 3); expect(w.origin_mm).toEqual([0, 0])
  const small = (await connector(request, 'view', { id, view: 'overlay', max_tokens: 400, region: { rect_mm: [0, 0, 3000, 2000] } })).structuredContent!.data!.image as { size_px: number[] }
  expect(Math.max(...small.size_px)).toBe(560)
  const sheetImage = (await connector(request, 'view', { id })).structuredContent!.data!.image as { size_px: number[] }
  expect(sheetImage.size_px.length).toBe(2)
  expect((await connector(request, 'view', { id, max_tokens: 0 })).structuredContent!.findings![0].code).toBe('bad-argument')
})
