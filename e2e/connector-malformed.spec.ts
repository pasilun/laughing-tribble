import { test, expect } from '@playwright/test'
import { connector } from './connector-helpers'

test('check, view and export refuse a malformed id as a finding', async ({ request }) => {
  const c = await connector(request, 'check', { id: 'Bad Id!' })
  expect(c.structuredContent!.ok).toBe(false); expect(c.isError).toBe(true)
  const v = await connector(request, 'view', { id: 'Bad Id!' })
  expect(v.structuredContent!.ok).toBe(false); expect(v.isError).toBe(true)
  const e = await connector(request, 'export', { id: 'Bad Id!', format: 'pdf' })
  expect(e.structuredContent!.ok).toBe(false); expect(e.isError).toBe(true)
})

test('check: a non-string id is named as such', async ({ request }) => {
  const r = await connector(request, 'check', { id: 5 })
  expect(r.structuredContent!.ok).toBe(false)
  expect(r.structuredContent!.findings![0].message).toContain('ska vara en sträng')
})

test('check: a malformed compare reference is a finding, not a protocol error', async ({ request }) => {
  const r = await connector(request, 'check', { id: 'Bad Id!', scope: ['compare'], against: { id: 'Bad Id!' } })
  expect(r.structuredContent!.ok).toBe(false)
})
