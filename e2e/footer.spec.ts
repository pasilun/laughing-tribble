import { test, expect } from '@playwright/test'

// Regression test for specs/footer.md (active capability spec).
// The year is asserted dynamically so the hardcoded 2026 in Footer.tsx
// surfaces as a failure when the year rolls over (known deviation).

const currentYear = String(new Date().getFullYear())

for (const path of ['/', '/design']) {
  test(`footer is present on ${path}`, async ({ page }) => {
    await page.goto(path)
    const footer = page.getByRole('contentinfo')
    await expect(footer).toBeVisible()
    await expect(footer).toContainText('© Bygglovsassistenten')
    await expect(footer).toContainText(currentYear)
  })
}
