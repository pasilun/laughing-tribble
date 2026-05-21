import { test, expect } from '@playwright/test'

test.describe('Landing Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
  })

  test('Scenario 1: communicates purpose in Swedish', async ({ page }) => {
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Din svenska bygglovsassistent')
    const sub = page.getByRole('paragraph').first()
    await expect(sub).toContainText(/friggebod/i)
    await expect(sub).toContainText(/attefall/i)
    await expect(page.locator('html')).toHaveAttribute('lang', 'sv')
  })

  test('Scenario 2: single primary call-to-action, no greeting', async ({ page }) => {
    await expect(page.getByRole('link', { name: 'Kom igång' })).toHaveCount(1)
    await expect(page.getByText(/Välkommen,\s*\w+/)).toHaveCount(0)
  })

  test('Scenario 3: CTA navigates to /design', async ({ page }) => {
    await page.getByRole('link', { name: 'Kom igång' }).click()
    await expect(page).toHaveURL('/design')
  })

  test('Scenario 4: footer is visible', async ({ page }) => {
    await expect(page.getByRole('contentinfo')).toBeVisible()
  })

  test('Scenario 5: mobile — CTA tappable, no horizontal overflow', async ({ page }) => {
    const box = await page.getByRole('link', { name: 'Kom igång' }).boundingBox()
    expect(box?.height).toBeGreaterThanOrEqual(44)
    const overflow = await page.evaluate(
      () => document.scrollingElement!.scrollWidth - window.innerWidth,
    )
    expect(overflow).toBeLessThanOrEqual(1)
  })
})
