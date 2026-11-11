import { test, expect } from '@playwright/test'
import { connector, makePlan } from './connector-helpers'
import { MANAGE_ACTIONS, VIEWS, EXPORTS, CHECKS, SHEETS } from '@/lib/plan/connector/registries'

// The codes of the findings a call answered with.
const codesOf = (result: Awaited<ReturnType<typeof connector>>) => (result.structuredContent!.findings ?? []).map((f) => f.code)

test('every manage action is implemented', async ({ request }) => {
  for (const name of MANAGE_ACTIONS.names()) {
    const result = await connector(request, 'manage', { action: name, id: 'no-such-plan', args: {} })
    expect(codesOf(result), `manage ${name}`).not.toContain('not-implemented')
  }
})

test('every view is implemented', async ({ request }) => {
  const { id } = await makePlan(request, 'Coverage test')
  for (const name of VIEWS.names()) {
    const result = await connector(request, 'view', { id, view: name })
    expect(codesOf(result), `view ${name}`).not.toContain('not-implemented')
  }
})

test('every export format is implemented', async ({ request }) => {
  const { id } = await makePlan(request, 'Coverage test')
  for (const name of EXPORTS.names()) {
    const result = await connector(request, 'export', { id, format: name })
    expect(codesOf(result), `export ${name}`).not.toContain('not-implemented')
  }
})

test('every check is implemented', async ({ request }) => {
  const { id } = await makePlan(request, 'Coverage test')
  for (const name of CHECKS.names()) {
    const result = await connector(request, 'check', { id, scope: [name], against: {} })
    expect(codesOf(result), `check ${name}`).not.toContain('not-implemented')
  }
})

test('sheet names are efter, fore and both', () => {
  expect(SHEETS.names()).toEqual(['efter', 'fore', 'both'])
})

test('a view asked for sheet both is refused as a bad argument', async ({ request }) => {
  const { id } = await makePlan(request, 'Coverage test')
  const result = await connector(request, 'view', { id, options: { sheet: 'both' } })
  expect(result.structuredContent!.findings![0].code).toBe('bad-argument')
})
