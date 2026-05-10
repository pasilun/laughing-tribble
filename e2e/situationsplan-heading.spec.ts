import { test, expect } from '@playwright/test'

test.describe('Situationsplan Screen - Scenario 1', () => {
  test('displays heading with text Situationsplan', async ({ page }) => {
    await page.goto('/situationsplan')

    const heading = page.getByRole('heading', { level: 1, name: 'Situationsplan' })
    await expect(heading).toBeVisible()
  })

  test('heading contains exact text Situationsplan', async ({ page }) => {
    await page.goto('/situationsplan')

    const heading = page.getByRole('heading', { level: 1 })
    const headingText = await heading.textContent()

    await expect(headingText).toBe('Situationsplan')
  })
})
