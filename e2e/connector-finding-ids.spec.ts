import { test, expect } from '@playwright/test'
import { fromCheck } from '@/lib/plan/connector/findings'

// Pure adapter tests — no browser needed.

test.describe('finding ids per cause', () => {
  test('two check findings with one code and different messages get different ids', () => {
    const a = fromCheck({ level: 'error', code: 'title-block', message: 'Saknar adress' })
    const b = fromCheck({ level: 'error', code: 'title-block', message: 'Saknar ritare' })
    expect(a.id).not.toBe(b.id)
    expect(a.id).toMatch(/^title-block:[0-9a-f]{6}$/)
    expect(b.id).toMatch(/^title-block:[0-9a-f]{6}$/)
  })

  test('the same check finding twice gets the same id', () => {
    const a = fromCheck({ level: 'error', code: 'title-block', message: 'Saknar adress' })
    const b = fromCheck({ level: 'error', code: 'title-block', message: 'Saknar adress' })
    expect(a.id).toBe(b.id)
  })

  test('a check finding with a ref keeps code:ref as its id', () => {
    const f = fromCheck({ level: 'error', code: 'title-block', message: 'm', ref: 'v1' })
    expect(f.id).toBe('title-block:v1')
  })
})
