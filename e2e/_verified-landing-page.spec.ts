import { test, expect } from '@playwright/test'

test.describe('Landing Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
  })

  test('Scenario 1: The page communicates purpose', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Din svenska bygglovsassistent' })).toBeVisible()
    await expect(page.getByText(/friggebod/i)).toBeVisible()
    await expect(page.getByText(/attefallshus/i)).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('lang', 'sv')
  })

  test('Scenario 2: Single primary call-to-action', async ({ page }) => {
    await expect(page.getByRole('link', { name: 'Kom igång' })).toHaveCount(1)
    await expect(page.getByText(/^Hej/i)).not.toBeVisible()
    await expect(page.getByRole('link', { name: /^Kom igång/i })).toHaveCount(1)
  })

  test('Scenario 3: The call-to-action navigates to the design screen', async ({ page }) => {
    await page.getByRole('link', { name: 'Kom igång' }).click()
    await expect(page).toHaveURL('/design')
  })

  test('Scenario 4: Footer is present', async ({ page }) => {
    await expect(page.getByRole('contentinfo')).toBeVisible()
  })

  test('No horizontal overflow at mobile viewport', async ({ page }) => {
    const scrollWidth = await page.evaluate(() => document.scrollingElement?.scrollWidth || 0)
    const innerWidth = await page.evaluate(() => window.innerWidth)
    expect(scrollWidth).toBeLessThanOrEqual(innerWidth + 1)

    const heading = page.getByRole('heading', { name: 'Din svenska bygglovsassistent' })
    await expect(heading).toBeVisible()
    const headingBox = await heading.boundingBox()
    expect(headingBox?.x).toBeGreaterThanOrEqual(0)
    expect(headingBox && headingBox.x + headingBox.width).toBeLessThanOrEqual(innerWidth)

    const cta = page.getByRole('link', { name: 'Kom igång' })
    await expect(cta).toBeVisible()
    const ctaBox = await cta.boundingBox()
    expect(ctaBox?.x).toBeGreaterThanOrEqual(0)
    expect(ctaBox && ctaBox.x + ctaBox.width).toBeLessThanOrEqual(innerWidth)
  })

  test('No console errors', async ({ page }) => {
    const errors: string[] = []
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text())
    })
    await page.reload()
    expect(errors).toHaveLength(0)
  })
})
