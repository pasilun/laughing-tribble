import { test, expect } from '@playwright/test'
import { connector } from '@/e2e/connector-helpers'

test('get with a malformed id is a result with ok false, not a JSON-RPC error', async ({ request }) => {
  const r = await connector(request, 'get', { id: 'Bad Id!' })
  expect(r.isError).toBe(true)
  expect(r.structuredContent!.ok).toBe(false)
})

test('edit with a malformed id is a result with ok false, not a JSON-RPC error', async ({ request }) => {
  const r = await connector(request, 'edit', { id: 'Bad Id!', base_revision: 1, ops: [] })
  expect(r.isError).toBe(true)
  expect(r.structuredContent!.ok).toBe(false)
})

test('list revisions with a malformed id is a result with ok false, not a JSON-RPC error', async ({ request }) => {
  const r = await connector(request, 'list', { what: 'revisions', id: 'Bad Id!' })
  expect(r.isError).toBe(true)
  expect(r.structuredContent!.ok).toBe(false)
})
