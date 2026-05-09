import { test, expect } from '@playwright/test'

test.describe('Design Page Heading Feature', () => {
  test('displays heading on design page', async ({ page }) => {
    await page.goto('/design')

    const heading = page.getByRole('heading', { level: 1 })
    await expect(heading).toBeVisible()
  })

  test('heading provides context with text content', async ({ page }) => {
    await page.goto('/design')

    const heading = page.getByRole('heading', { level: 1 })
    const headingText = await heading.textContent()

    await expect(headingText).toBeTruthy()
    await expect(headingText?.length).toBeGreaterThan(0)
  })

  test('navigation from homepage shows heading', async ({ page }) => {
    await page.goto('/')

    const button = page.getByRole('link', { name: 'Kom igång' })
    await button.click()

    await expect(page).toHaveURL('/design')

    const heading = page.getByRole('heading', { level: 1 })
    await expect(heading).toBeVisible()
  })
})
