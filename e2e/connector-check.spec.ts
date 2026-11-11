import { test, expect } from '@playwright/test'
import { connector, legacy, makePlan } from './connector-helpers'

test('check: permit is the default scope; errors are findings', async ({ request }) => {
  const a = await makePlan(request, 'Check test')
  const d = (await connector(request, 'check', { id: a.id })).structuredContent!
  expect(d.ok).toBe(true); expect(d.revision).toBe(1); expect((d.data as { scopes: string[] }).scopes).toEqual(['permit'])
  const bad = (await connector(request, 'check', { id: a.id, scope: ['permt'] })).structuredContent!
  expect(bad.ok).toBe(false); expect(bad.findings![0].data!.nearest).toBe('permit')
  expect((await connector(request, 'check', { id: 'no-such-plan' })).structuredContent!.findings![0].code).toBe('not-found')
  expect((await connector(request, 'check', { id: a.id, scope: 'permit' })).structuredContent!.findings![0].code).toBe('bad-argument')
  expect((await connector(request, 'check', { id: a.id, against: [] })).structuredContent!.findings![0].code).toBe('bad-argument')
  const created = await legacy(request, 'plan_create', { name: `Check tom ${Date.now()}`, template: 'empty' })
  const eid = /Skapad: ([a-z0-9-]+)/.exec(created.content[0].text!)![1]
  const e = (await connector(request, 'check', { id: eid })).structuredContent!
  expect(e.next![0]).toMatchObject({ tool: 'source', arguments: { id: eid, action: 'upload_link' } })
})
