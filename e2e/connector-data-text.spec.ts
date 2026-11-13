import { test, expect } from '@playwright/test'
import { connector, makePlan } from './connector-helpers'

test('every answer carries its summary in data.text', async ({ request }) => {
  const { id } = await makePlan(request, 'Text i data')
  const got = await connector(request, 'get', { id, parts: ['walls'] })
  expect(String(got.structuredContent!.data!.text)).toContain('lgh-grans')
  const g = await connector(request, 'guide', {})
  expect(String(g.structuredContent!.data!.text)).toContain('Planstudio: working order')
})
