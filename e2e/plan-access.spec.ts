import { test, expect } from '@playwright/test'
import { cookieValue, hasAccess } from '@/lib/plan/access'

test.describe('plan access', () => {
  test.afterEach(() => {
    delete process.env.PLAN_PASSWORD
  })

  test('open without PLAN_PASSWORD (local development)', () => {
    delete process.env.PLAN_PASSWORD
    expect(hasAccess(new Request('http://x/api/plans'))).toBe(true)
  })

  test('with PLAN_PASSWORD: cookie, bearer or key, nothing else', () => {
    process.env.PLAN_PASSWORD = 'hemligt'
    expect(hasAccess(new Request('http://x/api/plans'))).toBe(false)
    expect(hasAccess(new Request('http://x/api/plans?key=fel'))).toBe(false)
    expect(hasAccess(new Request('http://x/api/mcp?key=hemligt'))).toBe(true)
    expect(hasAccess(new Request('http://x/api/plans', { headers: { authorization: 'Bearer hemligt' } }))).toBe(true)
    expect(hasAccess(new Request('http://x/api/plans', { headers: { cookie: `a=1; plan_access=${cookieValue()}` } }))).toBe(true)
    expect(hasAccess(new Request('http://x/api/plans', { headers: { cookie: 'plan_access=hemligt' } }))).toBe(false)
  })
})
