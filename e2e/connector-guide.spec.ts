import { test, expect } from '@playwright/test'
import { connector } from './connector-helpers'
import { OPERATIONS } from '@/lib/plan/connector/registries/operations'

test('guide without a topic gives the working order and the topics', async ({ request }) => {
  const r = await connector(request, 'guide', {})
  expect(r.structuredContent!.ok).toBe(true)
  const text = r.content[0].text!
  expect(text).toContain('Planstudio: working order')
  expect(text).toContain('Ämnen: work, ops, vocabulary, scan, source, findings')
})

test('guide ops lists every operation', async ({ request }) => {
  const r = await connector(request, 'guide', { topic: 'ops' })
  const text = r.content[0].text!
  for (const name of OPERATIONS.names()) expect(text).toContain(name)
})

test('guide vocabulary lists the families', async ({ request }) => {
  const r = await connector(request, 'guide', { topic: 'vocabulary' })
  const text = r.content[0].text!
  expect(text).toContain('operations: add, update, delete')
  expect(text).toMatch(/^views: sheet, overlay, source$/m)
})

test('guide findings describes the finding shape and codes', async ({ request }) => {
  const r = await connector(request, 'guide', { topic: 'findings' })
  expect(r.content[0].text!).toContain('unknown-name')
})

test('guide with an unknown topic answers unknown-name with the nearest topic', async ({ request }) => {
  const r = await connector(request, 'guide', { topic: 'ops2' })
  expect(r.structuredContent!.ok).toBe(false)
  expect(r.structuredContent!.findings![0].code).toBe('unknown-name')
  expect(r.structuredContent!.findings![0].data!.nearest).toBe('ops')
  expect(r.isError).toBe(true)
})

test('guide with a non-string topic answers bad-argument', async ({ request }) => {
  const r = await connector(request, 'guide', { topic: 5 })
  expect(r.structuredContent!.ok).toBe(false)
  expect(r.structuredContent!.findings![0].code).toBe('bad-argument')
})
