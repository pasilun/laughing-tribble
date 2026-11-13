import { test, expect } from '@playwright/test'
import { CONVENTIONS } from '@/lib/plan/connector/registries'
import { connector } from './connector-helpers'

test('guide topic trace gives the method and every convention', async ({ request }) => {
  const g = await connector(request, 'guide', { topic: 'trace' })
  const text = g.content[0].text!
  expect(text).toContain('Claude decides what is there, the drawing decides where')
  for (const name of CONVENTIONS.names()) expect(text).toContain(name)
  expect((g.structuredContent!.data!.conventions as unknown[]).length).toBe(CONVENTIONS.names().length)
})
