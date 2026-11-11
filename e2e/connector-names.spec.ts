import { expect, test } from '@playwright/test'
import { Registry, nearest } from '@/lib/plan/connector/names'
import type { Finding } from '@/lib/plan/connector/types'

function registry() {
  return new Registry('operations', 'operation', [
    { name: 'moveWall', aliases: ['flytta'], summary: 'x' },
    { name: 'moveVertex', summary: 'y' },
    { name: 'scale', summary: 'z' },
  ])
}

function findingOf(r: { entry: unknown } | { finding: Finding }): Finding {
  if ('finding' in r) return r.finding
  throw new Error('expected a finding, got an entry')
}

test('names() lists canonical names in declaration order', () => {
  expect(registry().names()).toEqual(['moveWall', 'moveVertex', 'scale'])
})

test('get() finds by canonical name or alias, exact match only', () => {
  const reg = registry()
  expect(reg.get('flytta')?.name).toBe('moveWall')
  expect(reg.get('nope')).toBeUndefined()
})

test('resolve() returns the entry for a valid name', () => {
  const r = registry().resolve('moveWall')
  expect(r).toHaveProperty('entry')
})

test('resolve() of a near miss gives unknown-name with the nearest name and the valid names', () => {
  const reg = registry()
  const f = findingOf(reg.resolve('moveWal'))
  expect(f.code).toBe('unknown-name')
  expect(f.id).toBe('unknown-name:operations:moveWal')
  expect(f.level).toBe('error')
  expect(f.data?.nearest).toBe('moveWall')
  expect(f.data?.valid).toEqual(['moveWall', 'moveVertex', 'scale'])
  expect(f.message).toContain('Menade du "moveWall"?')
})

test('resolve() of a name with no near match gives unknown-name without a nearest key', () => {
  const f = findingOf(registry().resolve('zzzzzz'))
  expect(f.code).toBe('unknown-name')
  expect(Object.keys(f.data ?? {})).not.toContain('nearest')
  expect(f.message).not.toContain('Menade du')
})

test('nearest() uses the prefix rule first', () => {
  expect(nearest('scal', ['moveWall', 'moveVertex', 'scale'])).toBe('scale')
})

test('nearest() uses the edit distance rule when no prefix matches', () => {
  expect(nearest('moveVertx', ['moveWall', 'moveVertex', 'scale'])).toBe('moveVertex')
})

test('nearest() of a one-letter name with no close candidate is undefined', () => {
  expect(nearest('x', ['moveWall', 'moveVertex', 'scale'])).toBeUndefined()
})

test('a duplicate name or alias in the constructor throws', () => {
  expect(
    () =>
      new Registry('operations', 'operation', [
        { name: 'a', aliases: ['b'], summary: 'x' },
        { name: 'b', summary: 'y' },
      ]),
  ).toThrow()
  expect(
    () =>
      new Registry('operations', 'operation', [
        { name: 'a', summary: 'x' },
        { name: 'a', summary: 'y' },
      ]),
  ).toThrow()
})
