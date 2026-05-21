import { test, expect } from '@playwright/test'

test.describe('Landing Page', () => {
  test('Scenario 1: The page communicates purpose', async ({ page }) => {
    await page.goto('/')

    await expect(page.getByRole('heading', { name: 'Din svenska bygglovsassistent' })).toBeVisible()
    await expect(page.getByText(/friggebod/)).toBeVisible()
    await expect(page.getByText(/attefallshus/)).toBeVisible()

    await expect(page.locator('html')).toHaveAttribute('lang', 'sv')

    const mainContent = page.getByRole('main')
    await expect(mainContent).not.toContainText('fel uppstod')
    await expect(mainContent).not.toContainText('error')
    await expect(mainContent).not.toContainText('undefined')
  })

  test('Scenario 2: Single primary call-to-action', async ({ page }) => {
    await page.goto('/')

    const cta = page.getByRole('link', { name: 'Kom igång' })
    await expect(cta).toHaveCount(1)
    await expect(cta).toBeVisible()

    const allButtons = page.locator('button')
    await expect(allButtons).toHaveCount(0)

    const allLinks = page.locator('a')
    await expect(allLinks).toHaveCount(1)

    const bodyText = await page.textContent('body')
    expect(bodyText?.toLowerCase()).not.toMatch(/hej|välkommen|hello|welcome|greetings/)
  })

  test('Scenario 3: The call-to-action navigates to the design screen', async ({ page }) => {
    await page.goto('/')

    await page.getByRole('link', { name: 'Kom igång' }).click()

    await expect(page).toHaveURL('/design')
    await expect(page.getByRole('heading', { name: 'Design' })).toBeVisible()
  })

  test('Scenario 4: Footer is present', async ({ page }) => {
    await page.goto('/')

    const footer = page.getByRole('contentinfo')
    await expect(footer).toBeVisible()
    await expect(footer).toContainText('© Bygglovsassistenten 2026')

    const footerBottom = await footer.evaluate(el => el.getBoundingClientRect().bottom)
    const documentHeight = await page.evaluate(() => document.documentElement.scrollHeight)

    expect(footerBottom).toBeGreaterThanOrEqual(documentHeight - 10)
  })

  test('Mobile: no horizontal overflow', async ({ page }) => {
    await page.goto('/')

    const hasOverflow = await page.evaluate(() => {
      const scrollWidth = document.scrollingElement?.scrollWidth ?? 0
      const innerWidth = window.innerWidth
      return scrollWidth > innerWidth + 1
    })

    expect(hasOverflow).toBe(false)

    const heading = page.getByRole('heading', { name: 'Din svenska bygglovsassistent' })
    await expect(heading).toBeVisible()
    const headingBox = await heading.boundingBox()
    expect(headingBox).toBeTruthy()
    expect(headingBox!.x).toBeGreaterThanOrEqual(0)
    expect(headingBox!.x + headingBox!.width).toBeLessThanOrEqual(page.viewportSize()!.width)

    const cta = page.getByRole('link', { name: 'Kom igång' })
    await expect(cta).toBeVisible()
    const ctaBox = await cta.boundingBox()
    expect(ctaBox).toBeTruthy()
    expect(ctaBox!.x).toBeGreaterThanOrEqual(0)
    expect(ctaBox!.x + ctaBox!.width).toBeLessThanOrEqual(page.viewportSize()!.width)
  })
})
