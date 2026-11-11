import { test, expect, type APIRequestContext } from '@playwright/test'
import { connector, legacy, makePlan } from './connector-helpers'

// Widens the demo's opening ny-oppning; the same call each time.
const widen = (width: number) => [{ op: 'update', kind: 'opening', id: 'ny-oppning', patch: { width } }]

// The plan as plan_get reads it (the old connector), first line says the revision.
const planText = async (request: APIRequestContext, id: string) => (await legacy(request, 'plan_get', { plan_id: id })).content[0].text!

// A demo plan at revision 2: one saved edit on top of the first.
async function planAtRevision2(request: APIRequestContext): Promise<string> {
  const { id } = await makePlan(request, 'Redigering')
  const first = await connector(request, 'edit', { id, base_revision: 1, ops: widen(900) })
  expect(first.structuredContent!.ok).toBe(true)
  return id
}

test('saves an edit as a new revision and says what changed', async ({ request }) => {
  const { id } = await makePlan(request, 'Redigering')
  const r = await connector(request, 'edit', { id, base_revision: 1, ops: widen(1000), message: 'Bredare' })
  expect(r.isError).toBeFalsy()
  expect(r.content.length).toBe(1)
  const a = r.structuredContent!
  expect(a.ok).toBe(true)
  expect(a.contract).toBe(1)
  expect(a.revision).toBe(2)
  const opening = a.changed!.find((c) => c.kind === 'opening' && c.id === 'ny-oppning')
  expect(opening?.what).toContain('ändrad')
  expect(await planText(request, id)).toContain('Revision 2')
})

test('an edit on an old revision is refused as stale', async ({ request }) => {
  const { id } = await makePlan(request, 'Redigering')
  const first = await connector(request, 'edit', { id, base_revision: 1, ops: widen(1000) })
  expect(first.structuredContent!.ok).toBe(true)
  const r = await connector(request, 'edit', { id, base_revision: 1, ops: widen(1000) })
  expect(r.structuredContent!.ok).toBe(false)
  expect(r.structuredContent!.findings![0].code).toBe('stale-revision')
  expect(r.structuredContent!.findings![0].data!.current).toBe(2)
  expect(r.structuredContent!.next![0].tool).toBe('get')
  expect(r.isError).toBe(true)
})

test('an unknown operation name is reported with its position and saves nothing', async ({ request }) => {
  const id = await planAtRevision2(request)
  const r = await connector(request, 'edit', { id, base_revision: 2, ops: [{ op: 'moveWal', id: 'a-hall', dx: 0, dy: 10 }] })
  expect(r.structuredContent!.ok).toBe(false)
  expect(r.structuredContent!.findings![0].code).toBe('unknown-name')
  expect(r.structuredContent!.findings![0].data!.nearest).toBe('moveWall')
  expect(r.structuredContent!.findings![0].data!.index).toBe(0)
  expect(await planText(request, id)).toContain('Revision 2')
})

test('a dry run reports the changes and saves nothing', async ({ request }) => {
  const id = await planAtRevision2(request)
  const r = await connector(request, 'edit', { id, base_revision: 2, dry_run: true, ops: [{ op: 'moveWall', id: 'a-hall', dx: 0, dy: 10 }] })
  expect(r.structuredContent!.ok).toBe(true)
  expect(r.structuredContent!.revision).toBe(2)
  expect(r.structuredContent!.data!.dry_run).toBe(true)
  expect(r.structuredContent!.changed!.length).toBeGreaterThan(0)
  expect(await planText(request, id)).toContain('Revision 2')
})

test('an operation the plan refuses is an invalid-operation finding', async ({ request }) => {
  const { id } = await makePlan(request, 'Redigering')
  const r = await connector(request, 'edit', { id, base_revision: 1, ops: [{ op: 'setWallLength', id: 'no-such-wall', length: 1000 }] })
  expect(r.structuredContent!.ok).toBe(false)
  expect(r.structuredContent!.findings![0].code).toBe('invalid-operation')
  expect(r.isError).toBe(true)
})

test('an unknown plan is not-found', async ({ request }) => {
  const r = await connector(request, 'edit', { id: 'no-such-plan', base_revision: 1, ops: widen(1000) })
  expect(r.structuredContent!.ok).toBe(false)
  expect(r.structuredContent!.findings![0].code).toBe('not-found')
})

test('a base_revision that is not a number is a bad-argument', async ({ request }) => {
  const { id } = await makePlan(request, 'Redigering')
  const r = await connector(request, 'edit', { id, base_revision: 'x', ops: widen(1000) })
  expect(r.structuredContent!.ok).toBe(false)
  expect(r.structuredContent!.findings![0].code).toBe('bad-argument')
  expect(r.isError).toBe(true)
})

test('image true adds a picture of the saved sheet', async ({ request }) => {
  const { id } = await makePlan(request, 'Redigering')
  const r = await connector(request, 'edit', { id, base_revision: 1, ops: widen(1000), image: true })
  expect(r.structuredContent!.ok).toBe(true)
  expect(r.content.length).toBe(2)
  expect(r.content[1].type).toBe('image')
})
