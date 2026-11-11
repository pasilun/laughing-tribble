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

test('check: review and finish scopes', async ({ request }) => {
  const a = await makePlan(request, 'Check review')
  const rv = (await connector(request, 'check', { id: a.id, scope: ['review'] })).structuredContent!
  expect(rv.ok).toBe(true)
  const fin = (await connector(request, 'check', { id: a.id, scope: ['finish'] })).structuredContent!
  expect(fin.ok).toBe(true)
  for (const f of fin.findings ?? []) if (f.fix) for (const op of f.fix) expect(typeof op.op).toBe('string')
  const both = (await connector(request, 'check', { id: a.id, scope: ['permit', 'review'] })).structuredContent!
  expect((both.data as { scopes: string[] }).scopes).toEqual(['permit', 'review'])
})

test('check: audit without a source says so', async ({ request }) => {
  const a = await makePlan(request, 'Check audit')
  const au = (await connector(request, 'check', { id: a.id, scope: ['audit'] })).structuredContent!
  expect(au.ok).toBe(true)
  expect(au.findings!.some((f) => f.id === 'plan:no-source' && f.code === 'audit-plan-no-source')).toBe(true)
})

test('check: a plan without a source is not sent round the audit again', async ({ request }) => {
  const a = await makePlan(request, 'Check noaudit')
  const au = (await connector(request, 'check', { id: a.id, scope: ['audit'] })).structuredContent!
  expect((au.next ?? []).some((n) => n.tool === 'check' && JSON.stringify(n.arguments.scope) === '["audit"]')).toBe(false)
})

test('check: compare with a reference plan', async ({ request }) => {
  const a = await makePlan(request, 'Check cmp')
  const b = await makePlan(request, 'Check ref')
  const cmp = await connector(request, 'check', { id: a.id, scope: ['compare'], against: { id: b.id } })
  expect(cmp.structuredContent!.ok).toBe(true); expect(cmp.content[0].text).toContain(`Jämförelse med ${b.id}`)
  expect((await connector(request, 'check', { id: a.id, scope: ['compare'] })).structuredContent!.findings![0].code).toBe('bad-argument')
  expect((await connector(request, 'check', { id: a.id, scope: ['compare'], against: { id: 'no-such-plan' } })).structuredContent!.findings![0].code).toBe('not-found')
})

test('check: compare names walls by position and id', async ({ request }) => {
  const a = await makePlan(request, 'Check cmp names')
  const b = await makePlan(request, 'Check cmp ref')
  await legacy(request, 'plan_edit', { plan_id: a.id, base_revision: 1, message: 'x', ops: [{ op: 'add', kind: 'wall', item: { id: 'extra1', a: { x: 1000, y: 1000 }, b: { x: 2500, y: 1000 }, thickness: 100, phase: 'existing' } }] })
  const r = (await connector(request, 'check', { id: a.id, scope: ['compare'], against: { id: b.id } })).structuredContent!
  const f = r.findings!.find((x) => x.code === 'compare-wall-extra' && x.refs?.[0] === 'extra1')!
  expect(f.message).toContain('(extra1)'); expect(f.message).not.toMatch(/^Väggen extra1/)
})

test('check: finding ids are unique within an answer', async ({ request }) => {
  const a = await makePlan(request, 'Check ids')
  const au = (await connector(request, 'check', { id: a.id, scope: ['audit'] })).structuredContent!
  const ids = au.findings!.map((f) => f.id)
  expect(new Set(ids).size).toBe(ids.length)
  for (const f of au.findings!) expect(f.code.startsWith('audit-')).toBe(true)
  expect(au.findings!.some((f) => f.code === 'audit-plan')).toBe(false)
})

test('check: messages do not name the old tools', async ({ request }) => {
  const a = await makePlan(request, 'Check words')
  for (const scope of [['permit'], ['review'], ['audit'], ['finish']]) {
    const r = (await connector(request, 'check', { id: a.id, scope })).structuredContent!
    for (const f of r.findings ?? []) expect(f.message, `${scope}: ${f.id}`).not.toMatch(/plan_[a-z]/)
  }
})
