import { test, expect } from '@playwright/test'
import { reportError } from '@/lib/monitor'

test('monitoring is off without SENTRY_DSN and then reports nothing', async () => {
  const saved = process.env.SENTRY_DSN
  delete process.env.SENTRY_DSN
  expect(await reportError(new Error('x'), { tool: 'scan' })).toBeUndefined()
  if (saved) process.env.SENTRY_DSN = saved
})
