import { test, expect } from '@playwright/test'
import { connector, legacy, makePlan } from './connector-helpers'

// Refused answers keep the plan's id, and its revision when the handler knows it.

test('a stale edit is refused with the id and the current revision', async ({ request }) => {
  const { id } = await makePlan(request, 'Avvisad')
  const saved = await legacy(request, 'plan_edit', { plan_id: id, base_revision: 1, ops: [{ op: 'update', kind: 'opening', id: 'ny-oppning', patch: { width: 900 } }] })
  expect(saved.isError, JSON.stringify(saved.content)).toBeFalsy()
  const r = await connector(request, 'edit', { id, base_revision: 1, ops: [] })
  expect(r.structuredContent!.ok).toBe(false)
  expect(r.structuredContent!.id).toBe(id)
  expect(r.structuredContent!.revision).toBe(2)
  expect(r.structuredContent!.findings![0].data!.current).toBe(2)
})

test('a get of an unknown plan is refused with the id and no revision', async ({ request }) => {
  const r = await connector(request, 'get', { id: 'no-such-plan' })
  expect(r.structuredContent!.ok).toBe(false)
  expect(r.structuredContent!.id).toBe('no-such-plan')
  expect('revision' in r.structuredContent!).toBe(false)
})
