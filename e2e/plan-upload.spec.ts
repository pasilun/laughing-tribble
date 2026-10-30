import { test, expect, type APIRequestContext } from '@playwright/test'
import { readFileSync } from 'fs'
import sharp from 'sharp'

// A drawing from the user's own device becomes a source: the upload route, the
// upload page, the link tool, and what a fresh Claude is told when it connects.

async function call(request: APIRequestContext, name: string, args: Record<string, unknown>) {
  const res = await request.post('/api/mcp', { data: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } } })
  expect(res.status()).toBe(200)
  return (await res.json()).result as { content: Array<{ type: string; text?: string }>; isError?: boolean }
}

async function newPlan(request: APIRequestContext) {
  const created = await call(request, 'plan_create', { name: 'Uppladdning' })
  return /Skapad: ([a-z0-9-]+)/.exec(created.content[0].text!)![1]
}

const png = () => sharp({ create: { width: 600, height: 400, channels: 3, background: '#ffffff' } }).png().toBuffer()

test('a connecting Claude is told how to work, and can read the guide', async ({ request }) => {
  const init = await (await request.post('/api/mcp', { data: { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} } })).json()
  expect(init.result.instructions).toContain('plan_guide')
  expect(init.result.instructions).toContain('plan_upload_link')
  const guide = await call(request, 'plan_guide', {})
  expect(guide.content[0].text).toContain('Calibrate')
  expect(guide.content[0].text).toContain('plan_review')
})

test('a plan with no drawing says its measurements are estimates', async ({ request }) => {
  const id = await newPlan(request)
  await call(request, 'plan_edit', { plan_id: id, base_revision: 1, ops: [{ op: 'add', kind: 'wall', item: { id: 'v1', a: { x: 0, y: 0 }, b: { x: 3000, y: 0 }, thickness: 100, phase: 'existing' } }] })
  const got = await call(request, 'plan_get', { plan_id: id })
  expect(got.content[0].text).toContain('ingen källritning')
  expect(got.content[0].text).toContain('plan_upload_link')
})

test('the link tool points at the upload page of that plan', async ({ request }) => {
  const id = await newPlan(request)
  const link = await call(request, 'plan_upload_link', { plan_id: id })
  expect(link.content[0].text).toContain(`/plans/${id}/upload`)
  const missing = await call(request, 'plan_upload_link', { plan_id: 'finns-inte' })
  expect(missing.isError).toBe(true)
})

test('the upload route turns raw bytes into a source, saved as a revision', async ({ request }) => {
  const id = await newPlan(request)
  const res = await request.post(`/api/plans/${id}/sources?id=kallare&filename=kallare.png&name=K%C3%A4llare&role=archive&scale=100&dpi=300`, { data: await png() })
  expect(res.status()).toBe(201)
  const j = await res.json()
  expect(j.revision).toBe(2)
  expect(j.source).toMatchObject({ id: 'kallare', widthPx: 600, heightPx: 400, role: 'archive' })
  expect(j.source.mmPerPx).toBeCloseTo((25.4 / 300) * 100, 3)
  const got = await call(request, 'plan_get', { plan_id: id })
  expect(got.content[0].text).toContain('Källa kallare (archive)')
  // The source is used by the scan tools straight away.
  const view = await call(request, 'plan_scan_view', { plan_id: id, source: 'kallare', rect: { x: 0, y: 0, w: 3000, h: 2000 } })
  expect(view.isError, view.content[0].text).toBeFalsy()
})

test('the upload route refuses what it cannot use', async ({ request }) => {
  const id = await newPlan(request)
  const body = await png()
  expect((await request.post(`/api/plans/${id}/sources?id=Fel Id&filename=a.png`, { data: body })).status()).toBe(400)
  expect((await request.post(`/api/plans/${id}/sources?id=a&filename=a.exe`, { data: body })).status()).toBe(400)
  expect((await request.post(`/api/plans/${id}/sources?id=a&filename=a.png`, { data: Buffer.alloc(0) })).status()).toBe(400)
  expect((await request.post(`/api/plans/${id}/sources?id=a&filename=a.png`, { data: Buffer.alloc(4_500_000) })).status()).toBe(413)
  expect((await request.post(`/api/plans/finns-inte/sources?id=a&filename=a.png`, { data: body })).status()).toBe(404)
  // A TIF works too (converted to PNG on the server).
  const tif = await request.post(`/api/plans/${id}/sources?id=skanning&filename=test-scan.tif&scale=100`, { data: readFileSync('e2e/fixtures/test-scan.tif') })
  expect(tif.status()).toBe(201)
})

test('the page: pick a file, it uploads at once and says what to tell Claude', async ({ page, request }) => {
  const id = await newPlan(request)
  await page.goto(`/plans/${id}/upload`)
  await page.getByTestId('upload-file').setInputFiles({ name: 'källare.png', mimeType: 'image/png', buffer: await png() })
  const result = page.getByTestId('upload-result')
  await expect(result).toContainText('Klart')
  await expect(result).toContainText('Ritningen är uppladdad som källa kallare-')
  const got = await call(request, 'plan_get', { plan_id: id })
  expect(got.content[0].text).toMatch(/Källa kallare-[a-z0-9]{4} \(archive\)/)
})
