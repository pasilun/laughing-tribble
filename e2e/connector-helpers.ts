import { expect, type APIRequestContext } from '@playwright/test'
import type { Answer } from '@/lib/plan/connector/types'

export type Result = { content: Array<{ type: string; text?: string; data?: string }>; isError?: boolean; structuredContent?: Answer }

async function call(request: APIRequestContext, path: string, name: string, args: Record<string, unknown>): Promise<Result> {
  const res = await request.post(path, { data: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } } })
  expect(res.status()).toBe(200)
  const body = await res.json()
  expect(body.error).toBeUndefined()
  return body.result as Result
}
// A tool of the new connector.
export const connector = (request: APIRequestContext, tool: string, args: Record<string, unknown>) => call(request, '/api/connector', tool, args)
// A tool of the old connector, for setting up plans and checking what the new one did.
export const legacy = (request: APIRequestContext, tool: string, args: Record<string, unknown>) => call(request, '/api/mcp', tool, args)

// A new demo plan with a name that is unique to this call. Returns its id; its revision is 1.
export async function makePlan(request: APIRequestContext, name: string): Promise<{ id: string; revision: number }> {
  const created = await legacy(request, 'plan_create', { name: `${name} ${Date.now()}-${Math.floor(Math.random() * 1e6)}`, template: 'demo' })
  const id = /Skapad: ([a-z0-9-]+)/.exec(created.content[0].text!)![1]
  return { id, revision: 1 }
}
