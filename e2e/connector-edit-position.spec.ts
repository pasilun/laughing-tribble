import { test, expect } from '@playwright/test'
import { connector, makePlan } from './connector-helpers'

// An unknown operation name says which operation it is, by position, in the message; the index stays in data.
test('an unknown operation name names its position in the message', async ({ request }) => {
  const { id } = await makePlan(request, 'Position')
  const r = await connector(request, 'edit', { id, base_revision: 1, ops: [{ op: 'moveWal', id: 'a-hall', dx: 0, dy: 10 }] })
  expect(r.structuredContent!.ok).toBe(false)
  const finding = r.structuredContent!.findings![0]
  expect(finding.code).toBe('unknown-name')
  expect(finding.message.startsWith('Operation 1: ')).toBe(true)
  expect(finding.data!.index).toBe(0)
})
