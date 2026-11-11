import { test, expect } from '@playwright/test'

// The connector at /api/connector: the ten tools, next to the old connector at /api/mcp (JSON-RPC).

const TOOL_ORDER = ['guide', 'list', 'get', 'check', 'view', 'scan', 'edit', 'source', 'manage', 'export']

test('initialize names the connector and tells Claude to start with guide', async ({ request }) => {
  const body = await (await request.post('/api/connector', { data: { jsonrpc: '2.0', id: 1, method: 'initialize' } })).json()
  expect(body.result.serverInfo.name).toBe('planstudio')
  expect(body.result.instructions).toContain('Call guide first')
})

test('the ten tools are listed in the contract order, each with annotations', async ({ request }) => {
  const body = await (await request.post('/api/connector', { data: { jsonrpc: '2.0', id: 1, method: 'tools/list' } })).json() as {
    result: { tools: Array<{ name: string; annotations?: unknown }> }
  }
  expect(body.result.tools.map((t) => t.name)).toEqual(TOOL_ORDER)
  for (const t of body.result.tools) {
    expect(typeof t.annotations).toBe('object')
    expect(t.annotations).toBeTruthy()
  }
})

test('names that are not one of the ten tools are refused', async ({ request }) => {
  for (const name of ['plan_get', 'nope']) {
    const res = await request.post('/api/connector', { data: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: {} } } })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.error.code).toBe(-32602)
  }
})

test('the well-known resource names the connector or the old connector', async ({ request }) => {
  const connector = await (await request.get('/.well-known/oauth-protected-resource/api/connector')).json()
  expect(connector.resource).toMatch(/\/api\/connector$/)

  const oldMcp = await (await request.get('/.well-known/oauth-protected-resource/api/mcp')).json()
  expect(oldMcp.resource).toMatch(/\/api\/mcp$/)

  const root = await (await request.get('/.well-known/oauth-protected-resource')).json()
  expect(root.resource).toMatch(/\/api\/mcp$/)
})

test('the old connector still lists plan_edit', async ({ request }) => {
  const body = await (await request.post('/api/mcp', { data: { jsonrpc: '2.0', id: 1, method: 'tools/list' } })).json()
  const names = body.result.tools.map((t: { name: string }) => t.name)
  expect(names).toContain('plan_edit')
})
