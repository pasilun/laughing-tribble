import { test, expect, type APIRequestContext } from '@playwright/test'
import { readFileSync } from 'fs'

// Claude's floor plan tools over MCP (JSON-RPC).

async function call(request: APIRequestContext, name: string, args: Record<string, unknown>) {
  const res = await request.post('/api/mcp', { data: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } } })
  expect(res.status()).toBe(200)
  const body = await res.json()
  expect(body.error).toBeUndefined()
  return body.result as { content: Array<{ type: string; text?: string; data?: string }>; isError?: boolean }
}

test('plan tools are listed', async ({ request }) => {
  const body = await (await request.post('/api/mcp', { data: { jsonrpc: '2.0', id: 1, method: 'tools/list' } })).json()
  const names = body.result.tools.map((t: { name: string }) => t.name)
  for (const n of ['plan_create', 'plan_get', 'plan_edit', 'plan_check', 'plan_revisions', 'plan_list', 'plan_import', 'plan_source_add', 'plan_scan_view', 'plan_scan_snap_walls'])
    expect(names).toContain(n)
})

test('Claude reads, edits against a revision and gets a preview', async ({ request }) => {
  const created = await call(request, 'plan_create', { name: 'MCP-test', template: 'demo' })
  const id = /Skapad: ([a-z0-9-]+)/.exec(created.content[0].text!)![1]

  const got = await call(request, 'plan_get', { plan_id: id })
  expect(got.content[0].text).toContain('Revision 1')
  expect(got.content[0].text).toContain('lgh-grans')
  expect(got.content.at(-1)!.type).toBe('image')

  const edited = await call(request, 'plan_edit', {
    plan_id: id,
    base_revision: 1,
    message: 'Breddade öppningen',
    ops: [{ op: 'update', kind: 'opening', id: 'ny-oppning', patch: { width: 1000 } }],
  })
  expect(edited.isError).toBeFalsy()
  expect(edited.content[0].text).toContain('Sparad som revision 2')
  expect(edited.content[0].text).toContain('bredd 1000')
  // Small answers: no picture unless asked for, and only the findings the edit changed.
  expect(edited.content).toHaveLength(1)
  expect(edited.content[0].text).toContain('Nya anmärkningar')
  const pic = await call(request, 'plan_edit', { plan_id: id, base_revision: 2, message: 'Tillbaka', image: true, ops: [{ op: 'update', kind: 'opening', id: 'ny-oppning', patch: { width: 900 } }] })
  expect(pic.content[1].type).toBe('image')
  expect(Buffer.from(pic.content[1].data!, 'base64').subarray(1, 4).toString()).toBe('PNG')

  // Stale revision: nothing saved, told to re-read.
  const stale = await call(request, 'plan_edit', { plan_id: id, base_revision: 1, message: 'x', ops: [] })
  expect(stale.isError).toBe(true)
  expect(stale.content[0].text).toContain('plan_get')

  // Invalid op: rejected as a whole.
  const bad = await call(request, 'plan_edit', { plan_id: id, base_revision: 3, message: 'x', ops: [{ op: 'delete', kind: 'wall', id: 'finns-inte' }] })
  expect(bad.isError).toBe(true)

  const revs = await call(request, 'plan_revisions', { plan_id: id })
  expect(revs.content[0].text).toContain('claude: Breddade öppningen')

  const checks = await call(request, 'plan_check', { plan_id: id })
  expect(checks.content[0].text).toContain('brandskyddsbeskrivning')
})

test('Claude adds a scanned TIF, measures it and calibrates it', async ({ request }) => {
  const created = await call(request, 'plan_create', { name: 'MCP-skanning' })
  const id = /Skapad: ([a-z0-9-]+)/.exec(created.content[0].text!)![1]
  // Fixture: 300×200 px, scale bar from x=25 to x=275 px at y=173–177.
  const added = await call(request, 'plan_source_add', {
    plan_id: id,
    base_revision: 1,
    id: 'arkiv',
    filename: 'test-scan.tif',
    data_base64: readFileSync('e2e/fixtures/test-scan.tif').toString('base64'),
    mm_per_px: 10,
  })
  expect(added.isError, added.content[0].text).toBeFalsy()
  expect(added.content[0].text).toContain('300×200 px')

  const prof = await call(request, 'plan_scan_profile', { plan_id: id, from: { x: 0, y: 1750 }, to: { x: 3000, y: 1750 } })
  const run = /1\. (\d+)–(\d+) mm/.exec(prof.content[0].text!)!
  expect(Math.abs(Number(run[1]) - 250)).toBeLessThanOrEqual(10)
  expect(Math.abs(Number(run[2]) - 2760)).toBeLessThanOrEqual(10)

  // The bar really is 2600 mm: 4 % larger than drawn.
  const cal = await call(request, 'plan_scan_calibrate', {
    plan_id: id,
    base_revision: 2,
    measurements: [{ a: { x: 250, y: 1750 }, b: { x: 2750, y: 1750 }, mm: 2600, label: 'skalstock' }],
    anchor: { x: 0, y: 0 },
    apply: true,
  })
  expect(cal.content[0].text).toContain('Faktor 1.04000')
  expect(cal.content[0].text).toContain('Sparad som revision 3')
  const got = await call(request, 'plan_get', { plan_id: id })
  expect(got.content[0].text).toContain('10.4000 mm/px')

  const view = await call(request, 'plan_scan_view', { plan_id: id, rect: { x: 0, y: 0, w: 3120, h: 2080 } })
  expect(view.content[1].type).toBe('image')
})
