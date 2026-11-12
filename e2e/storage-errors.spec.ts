import { test, expect } from '@playwright/test'
import { describeError, isNetworkError } from '@/lib/plan/storage/storage'

test('"fetch failed" is reported with its cause and counts as a network error', () => {
  const e = new TypeError('fetch failed', { cause: Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }) })
  expect(describeError(e)).toBe('fetch failed (ECONNRESET: read ECONNRESET)')
  expect(isNetworkError(e)).toBe(true)
  expect(describeError(new Error('källbilden saknas'))).toBe('källbilden saknas')
  expect(isNetworkError(new Error('källbilden saknas'))).toBe(false)
})
