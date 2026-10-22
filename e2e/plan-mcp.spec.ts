import { test, expect, type APIRequestContext } from '@playwright/test'

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
  for (const n of ['plan_create', 'plan_get', 'plan_edit', 'plan_check', 'plan_revisions', 'plan_list']) expect(names).toContain(n)
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
  expect(edited.content[1].type).toBe('image')
  expect(Buffer.from(edited.content[1].data!, 'base64').subarray(1, 4).toString()).toBe('PNG')

  // Stale revision: nothing saved, told to re-read.
  const stale = await call(request, 'plan_edit', { plan_id: id, base_revision: 1, message: 'x', ops: [] })
  expect(stale.isError).toBe(true)
  expect(stale.content[0].text).toContain('plan_get')

  // Invalid op: rejected as a whole.
  const bad = await call(request, 'plan_edit', { plan_id: id, base_revision: 2, message: 'x', ops: [{ op: 'delete', kind: 'wall', id: 'finns-inte' }] })
  expect(bad.isError).toBe(true)

  const revs = await call(request, 'plan_revisions', { plan_id: id })
  expect(revs.content[0].text).toContain('claude: Breddade öppningen')

  const checks = await call(request, 'plan_check', { plan_id: id })
  expect(checks.content[0].text).toContain('brandskyddsbeskrivning')
})
