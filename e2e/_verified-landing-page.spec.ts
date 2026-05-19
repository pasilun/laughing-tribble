import { test, expect } from '@playwright/test'

test.describe('Landing Page - Scenario 1: The page communicates purpose', () => {
  test('Heading and supporting line are visible with correct content', async ({ page }) => {
    await page.goto('/')

    await expect(page.getByRole('heading', { name: 'Din svenska bygglovsassistent', level: 1 })).toBeVisible()

    await expect(page.getByText(/friggebod|attefallshus/)).toBeVisible()

    const lang = await page.evaluate(() => document.documentElement.lang)
    expect(lang).toBe('sv')

    await expect(page.getByText(/fel uppstod|error|undefined|null|500/i)).not.toBeVisible()
  })
})

test.describe('Landing Page - Scenario 2: Single primary call-to-action', () => {
  test('Exactly one primary CTA is visible with no greeting or secondary CTA', async ({ page }) => {
    await page.goto('/')

    const cta = page.getByRole('link', { name: 'Kom igång' })
    await expect(cta).toBeVisible()

    const ctaCount = await page.getByRole('link', { name: 'Kom igång' }).count()
    expect(ctaCount).toBe(1)

    const allLinks = await page.locator('a').all()
    const visibleLinks = allLinks.filter(async (link) => {
      return await link.isVisible()
    })
    expect(visibleLinks.length).toBe(1)

    await expect(page.getByText(/hej|välkommen|hello|welcome/i)).not.toBeVisible()

    await expect(page.getByText(/fel uppstod|error|undefined|null|500/i)).not.toBeVisible()
  })
})

test.describe('Landing Page - Scenario 3: The call-to-action navigates to the design screen', () => {
  test('Clicking Kom igång navigates to /design', async ({ page }) => {
    await page.goto('/')

    const cta = page.getByRole('link', { name: 'Kom igång' })
    await cta.click()

    await expect(page).toHaveURL('/design')

    await expect(page.getByText(/fel uppstod|error|undefined|null|500/i)).not.toBeVisible()
  })
})

test.describe('Landing Page - Scenario 4: Footer is present', () => {
  test('Footer is visible at the bottom of the page', async ({ page }) => {
    await page.goto('/')

    await expect(page.getByRole('contentinfo')).toBeVisible()

    await expect(page.getByText(/fel uppstod|error|undefined|null|500/i)).not.toBeVisible()
  })
})

test.describe('Landing Page - Mobile Responsive Checks', () => {
  test('No horizontal overflow on mobile viewport', async ({ page }) => {
    await page.goto('/')

    const hasHorizontalOverflow = await page.evaluate(() => {
      return document.scrollingElement.scrollWidth > window.innerWidth + 1
    })

    expect(hasHorizontalOverflow).toBe(false)
  })

  test('Primary chrome is not clipped on mobile viewport', async ({ page }) => {
    await page.goto('/')

    const heading = page.getByRole('heading', { level: 1 })
    const cta = page.getByRole('link', { name: 'Kom igång' })
    const footer = page.getByRole('contentinfo')

    const isInViewport = async (locator) => {
      const rect = await locator.boundingBox()
      const viewportWidth = await page.evaluate(() => window.innerWidth)
      return rect !== null && rect.left >= 0 && rect.right <= viewportWidth + 1
    }

    await expect(isInViewport(heading)).resolves.toBe(true)
    await expect(isInViewport(cta)).resolves.toBe(true)
    await expect(isInViewport(footer)).resolves.toBe(true)
  })
})
