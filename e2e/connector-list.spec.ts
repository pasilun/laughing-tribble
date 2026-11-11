import { test, expect } from '@playwright/test'
import { connector, legacy, makePlan } from '@/e2e/connector-helpers'

// What the list answers: the items, and the cursor of the next page when there is one.
type Item = { id: string; name?: string; revision?: number; n?: number }
const items = (r: { structuredContent?: unknown }) => (r.structuredContent as { data: { items: Item[]; next_cursor?: string } }).data.items

test('lists the plans, newest first, with their revision', async ({ request }) => {
  const a = await makePlan(request, 'Listtest Alfa')
  const b = await makePlan(request, 'Listtest Beta')
  const r = await connector(request, 'list', {})
  expect(r.isError).toBeFalsy()
  expect(r.structuredContent!.ok).toBe(true)
  const shown = items(r)
  const alfa = shown.find((x) => x.id === a.id)
  expect(alfa).toBeDefined()
  expect(alfa!.revision).toBe(1)
  expect(shown.find((x) => x.id === b.id)).toBeDefined()
})

test('query narrows the plans by name, case-insensitively', async ({ request }) => {
  const a = await makePlan(request, 'Listtest Alfa')
  const b = await makePlan(request, 'Listtest Beta')
  const r = await connector(request, 'list', { query: 'listtest alfa' })
  const ids = items(r).map((x) => x.id)
  expect(ids).toContain(a.id)
  expect(ids).not.toContain(b.id)
})

test('limit gives one item and a next cursor', async ({ request }) => {
  await makePlan(request, 'Listtest Alfa')
  await makePlan(request, 'Listtest Beta')
  const r = await connector(request, 'list', { limit: 1 })
  expect(items(r).length).toBe(1)
  const data = (r.structuredContent as { data: { next_cursor?: unknown } }).data
  expect(typeof data.next_cursor).toBe('string')
})

test('lists the revisions of one plan, newest first', async ({ request }) => {
  const { id } = await makePlan(request, 'Listtest Alfa')
  const edit = await legacy(request, 'plan_edit', { plan_id: id, base_revision: 1, ops: [{ op: 'update', kind: 'opening', id: 'ny-oppning', patch: { width: 1000 } }] })
  expect(edit.isError).toBeFalsy()
  const r = await connector(request, 'list', { what: 'revisions', id })
  expect(r.structuredContent!.ok).toBe(true)
  const shown = items(r)
  expect(shown.length).toBe(2)
  expect(shown[0].n).toBe(2)
})

test('a misspelt what is an unknown-name finding with the nearest kind', async ({ request }) => {
  const r = await connector(request, 'list', { what: 'revisons', id: 'no-such-plan' })
  expect(r.structuredContent!.ok).toBe(false)
  expect(r.structuredContent!.findings![0].code).toBe('unknown-name')
  expect(r.structuredContent!.findings![0].data!.nearest).toBe('revisions')
})

test('revisions without an id is a bad-argument finding', async ({ request }) => {
  const r = await connector(request, 'list', { what: 'revisions' })
  expect(r.structuredContent!.ok).toBe(false)
  expect(r.structuredContent!.findings![0].code).toBe('bad-argument')
})

test('revisions of an unknown plan is a not-found finding', async ({ request }) => {
  const r = await connector(request, 'list', { what: 'revisions', id: 'no-such-plan' })
  expect(r.structuredContent!.ok).toBe(false)
  expect(r.structuredContent!.findings![0].code).toBe('not-found')
})
