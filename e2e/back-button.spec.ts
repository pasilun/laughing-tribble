import { test, expect } from '@playwright/test'

test.describe('Back Button Feature', () => {
  test('displays back button on design page', async ({ page }) => {
    await page.goto('/design')

    const backButton = page.getByRole('link', { name: 'Tillbaka' })
    await expect(backButton).toBeVisible()
  })

  test('navigates to homepage on back button click', async ({ page }) => {
    await page.goto('/design')

    const backButton = page.getByRole('link', { name: 'Tillbaka' })
    await backButton.click()

    await expect(page).toHaveURL('/')
  })

  test('back button works after navigation from homepage', async ({ page }) => {
    await page.goto('/')

    const startButton = page.getByRole('link', { name: 'Kom igång' })
    await startButton.click()

    await expect(page).toHaveURL('/design')

    const backButton = page.getByRole('link', { name: 'Tillbaka' })
    await backButton.click()

    await expect(page).toHaveURL('/')

    const greeting = page.getByRole('heading', { level: 1 })
    await expect(greeting).toBeVisible()
  })

  test('back button is accessible via keyboard', async ({ page }) => {
    await page.goto('/design')

    const backButton = page.getByRole('link', { name: 'Tillbaka' })

    await backButton.focus()
    await expect(backButton).toBeFocused()

    await page.keyboard.press('Enter')

    await expect(page).toHaveURL('/')
  })
})
