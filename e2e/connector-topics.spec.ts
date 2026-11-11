import { test, expect } from '@playwright/test'
import { FAMILIES, TOPICS } from '@/lib/plan/connector/registries'

test('every topic has non-empty text', () => {
  for (const entry of TOPICS.entries) {
    const text = entry.text(FAMILIES).summary
    expect(typeof text).toBe('string')
    expect(text.length).toBeGreaterThan(0)
  }
})

test('the vocabulary topic lists the families, operations among them', () => {
  const data = TOPICS.get('vocabulary')!.text(FAMILIES).data!
  const families = data.families as Record<string, unknown>
  expect(families).toHaveProperty('operations')
})
