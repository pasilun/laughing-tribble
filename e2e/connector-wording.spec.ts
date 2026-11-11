import { test, expect } from '@playwright/test'
import { modernWords } from '@/lib/plan/connector/wording'

test('wording: old tool names become calls in the new connector', () => {
  expect(modernWords('Använd plan_review och plan_fix.')).toBe('Använd check (scope "review") och edit.')
  expect(modernWords('plan_foo_bar')).toBe('ett av verktygen')
  expect(modernWords('Inga namn här.')).toBe('Inga namn här.')
  expect(modernWords('plan_scan_dimension och plan_scan_view')).toBe('source (action "calibrate_dimensions") och view (view "source")')
})
