import { test, expect } from '@playwright/test'
import { applyOps } from '@/lib/plan/domain/ops'
import { demoPlan } from '@/lib/plan/domain/demo'
import { OPS_DOC } from '@/lib/plan/mcp/ops-docs'
import { OPERATIONS } from '@/lib/plan/connector/registries/operations'

const NAMES = [
  'add',
  'update',
  'delete',
  'moveVertex',
  'moveWall',
  'setWallLength',
  'scale',
  'setName',
  'setSheet',
  'setTitleBlock',
  'setUnderlay',
]

test('the operations registry lists the eleven operations in order', () => {
  expect(OPERATIONS.names()).toEqual(NAMES)
})

test('every example operation applies cleanly to the demo plan', () => {
  for (const entry of OPERATIONS.entries) {
    const result = applyOps(demoPlan(), [entry.example])
    expect(result.errors, entry.name).toEqual([])
  }
})

test('the reference text names every operation except setUnderlay', () => {
  for (const name of NAMES) {
    if (name === 'setUnderlay') continue
    expect(OPS_DOC, name).toContain(`"op":"${name}"`)
  }
})

test('a misspelt operation name resolves to the nearest one', () => {
  const resolved = OPERATIONS.resolve('moveWal')
  expect('finding' in resolved).toBe(true)
  if (!('finding' in resolved)) return
  expect(resolved.finding.data!.nearest).toBe('moveWall')
})
