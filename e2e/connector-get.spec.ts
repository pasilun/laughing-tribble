import { test, expect } from '@playwright/test'
import { connector, makePlan } from './connector-helpers'

test('reads the whole listing as text, with one block and no picture', async ({ request }) => {
  const { id } = await makePlan(request, 'Läsning')
  const r = await connector(request, 'get', { id })
  expect(r.isError).toBeFalsy()
  expect(r.content.length).toBe(1)
  expect(r.content[0].text).toContain('Väggar')
  expect(r.content[0].text).toContain('Öppningar')
  expect(r.content[0].text).toContain('Revision 1')
  const a = r.structuredContent!
  expect(a.ok).toBe(true)
  expect(a.id).toBe(id)
  expect(a.revision).toBe(1)
})

test('parts limits the listing to the parts named', async ({ request }) => {
  const { id } = await makePlan(request, 'Läsning')
  const r = await connector(request, 'get', { id, parts: ['walls'] })
  expect(r.structuredContent!.ok).toBe(true)
  expect(r.content[0].text).toContain('Väggar')
  expect(r.content[0].text).not.toContain('Öppningar')
})

test('an unknown part is an unknown-name finding with the nearest part', async ({ request }) => {
  const { id } = await makePlan(request, 'Läsning')
  const r = await connector(request, 'get', { id, parts: ['wals'] })
  expect(r.structuredContent!.ok).toBe(false)
  expect(r.structuredContent!.findings![0].code).toBe('unknown-name')
  expect(r.structuredContent!.findings![0].data!.nearest).toBe('walls')
  expect(r.isError).toBe(true)
})

test('since lists what changed after that revision', async ({ request }) => {
  const { id } = await makePlan(request, 'Läsning')
  const edit = await connector(request, 'edit', { id, base_revision: 1, message: 'x', ops: [{ op: 'update', kind: 'opening', id: 'ny-oppning', patch: { width: 1000 } }] })
  expect(edit.structuredContent!.ok).toBe(true)
  const r = await connector(request, 'get', { id, since: 1 })
  expect(r.structuredContent!.ok).toBe(true)
  expect(r.structuredContent!.revision).toBe(2)
  expect(r.content[0].text).toContain('Ändrat sedan revision 1')
  expect(r.content[0].text).toContain('ny-oppning')
})

test('format json returns the whole plan as data', async ({ request }) => {
  const { id } = await makePlan(request, 'Läsning')
  const r = await connector(request, 'get', { id, format: 'json' })
  expect(r.structuredContent!.ok).toBe(true)
  const plan = r.structuredContent!.data!.plan as { id: string; walls: unknown[] }
  expect(Array.isArray(plan.walls)).toBe(true)
  expect(plan.walls.length).toBeGreaterThan(5)
  expect(plan.id).toBe(id)
})

test('an unknown format is an unknown-name finding with the nearest format', async ({ request }) => {
  const { id } = await makePlan(request, 'Läsning')
  const r = await connector(request, 'get', { id, format: 'jsno' })
  expect(r.structuredContent!.ok).toBe(false)
  expect(r.structuredContent!.findings![0].code).toBe('unknown-name')
  expect(r.structuredContent!.findings![0].data!.nearest).toBe('json')
})

test('an unknown plan is not-found', async ({ request }) => {
  const r = await connector(request, 'get', { id: 'no-such-plan' })
  expect(r.structuredContent!.ok).toBe(false)
  expect(r.structuredContent!.findings![0].code).toBe('not-found')
  expect(r.isError).toBe(true)
})
