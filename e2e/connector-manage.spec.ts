import { test, expect } from '@playwright/test'
import { connector } from './connector-helpers'

test('manage', async ({ request }) => {
  const name = `Manage test ${Date.now()}`
  const c = (await connector(request, 'manage', { action: 'create', args: { name, template: 'demo' } })).structuredContent!
  expect(c.ok).toBe(true); expect(c.revision).toBe(1); const id = c.id!
  expect(c.next![0]).toMatchObject({ tool: 'source', arguments: { id, action: 'upload_link' } })
  const rn = (await connector(request, 'manage', { action: 'rename', id, args: { name: `${name} 2` } })).structuredContent!
  expect(rn.ok).toBe(true); expect(rn.revision).toBe(2)
  const tg = (await connector(request, 'manage', { action: 'tags', id, args: { tags: ['Alfa', 'Beta'] } })).structuredContent!
  expect(tg.data!.tags).toEqual(['Alfa', 'Beta'])
  const sh = (await connector(request, 'manage', { action: 'share', id })).structuredContent!
  expect(typeof sh.ok).toBe('boolean') // without personal keys there is no sharing: an answer, not a crash
  const plan = ((await connector(request, 'get', { id, format: 'json' })).structuredContent!.data as { plan: unknown }).plan
  const imp = (await connector(request, 'manage', { action: 'import', args: { name: `${name} kopia`, plan } })).structuredContent!
  expect(imp.ok, JSON.stringify(imp)).toBe(true); expect(imp.id).not.toBe(id)
  const del = (await connector(request, 'manage', { action: 'delete', id })).structuredContent!
  expect(del.data).toEqual({ result: 'trashed' })
  const tr = (await connector(request, 'manage', { action: 'trash' })).structuredContent!
  expect((tr.data!.items as Array<{ id: string }>).some((i) => i.id === id)).toBe(true)
  expect((await connector(request, 'manage', { action: 'restore', id })).structuredContent!.ok).toBe(true)
  expect((await connector(request, 'manage', { action: 'creat' })).structuredContent!.findings![0].data!.nearest).toBe('create')
  expect((await connector(request, 'manage', { action: 'rename', args: { name: 'x' } })).structuredContent!.findings![0].code).toBe('bad-argument')
  expect((await connector(request, 'manage', { action: 'rename', id: 'no-such-plan', args: { name: 'x' } })).structuredContent!.findings![0].code).toBe('not-found')
  expect((await connector(request, 'manage', { action: 'tags', id, args: { tags: 'x' } })).structuredContent!.findings![0].code).toBe('bad-argument')
  expect((await connector(request, 'manage', { action: 'create', id: 5 })).structuredContent!.findings![0].code).toBe('bad-argument')
})
