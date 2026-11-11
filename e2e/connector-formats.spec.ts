import { expect, test } from '@playwright/test'
import { FAMILIES, FORMATS } from '@/lib/plan/connector/registries'

test('the shared formats registry names text and json', () => {
  expect(FORMATS.names()).toEqual(['text', 'json'])
})

test('the vocabulary reads the formats from the shared registry', () => {
  expect(FAMILIES.formats).toBe(FORMATS)
})
