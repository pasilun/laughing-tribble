import { test, expect } from '@playwright/test'
import { FAMILIES, LIST_KINDS, PARTS, TOPICS } from '@/lib/plan/connector/registries'

test('parts are the six parts of a plan', () => {
  expect(PARTS.names()).toEqual(['sheet', 'walls', 'openings', 'fixtures', 'rooms', 'sources'])
})

test('list kinds and topics', () => {
  expect(LIST_KINDS.names()).toEqual(['plans', 'revisions'])
  expect(TOPICS.names()).toEqual(['work', 'ops', 'vocabulary', 'scan', 'source', 'findings'])
})

test('families are listed by their English keys', () => {
  expect(Object.keys(FAMILIES)).toEqual(['operations', 'parts', 'list', 'views', 'checks', 'formats', 'exports', 'sheets', 'scan', 'source', 'manage', 'topics'])
})

test('every family names itself by its key', () => {
  for (const [key, reg] of Object.entries(FAMILIES)) {
    expect(reg.family, key).toBe(key)
  }
})

test('a misspelt part resolves to the nearest one', () => {
  const result = PARTS.resolve('wals')
  expect('finding' in result).toBe(true)
  if (!('finding' in result)) return
  expect(result.finding.data!.nearest).toBe('walls')
})
