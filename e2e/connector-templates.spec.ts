import { test, expect } from '@playwright/test'
import { connector } from '@/e2e/connector-helpers'

test.describe('manage create templates', () => {
  test('a known template creates a plan', async ({ request }) => {
    const res = await connector(request, 'manage', { action: 'create', args: { name: 'Mall test ' + Date.now(), template: 'demo' } })
    expect(res.structuredContent!.ok).toBe(true)
  })

  test('an unknown template is an unknown-name finding with the nearest match', async ({ request }) => {
    const res = await connector(request, 'manage', { action: 'create', args: { name: 'Mall test ' + Date.now(), template: 'dmo' } })
    const findings = res.structuredContent!.findings!
    expect(findings[0].code).toBe('unknown-name')
    expect(findings[0].data!.nearest).toBe('demo')
  })

  test('without a template the plan is created empty', async ({ request }) => {
    const res = await connector(request, 'manage', { action: 'create', args: { name: 'Mall test ' + Date.now() } })
    expect(res.structuredContent!.ok).toBe(true)
  })
})
