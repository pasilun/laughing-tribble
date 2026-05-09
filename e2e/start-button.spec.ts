import { test, expect } from '@playwright/test'

test.describe('Start Button Feature', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
  })

  test('displays start button on homepage', async ({ page }) => {
    const button = page.getByRole('link', { name: 'Kom igång' })
    await expect(button).toBeVisible()
  })

  test('start button is positioned below the greeting', async ({ page }) => {
    const greeting = page.getByRole('heading', { level: 1 })
    const button = page.getByRole('link', { name: 'Kom igång' })

    await expect(greeting).toBeVisible()
    await expect(button).toBeVisible()

    const greetingBox = await greeting.boundingBox()
    const buttonBox = await button.boundingBox()

    expect(buttonBox?.y).toBeGreaterThan(greetingBox?.y ?? 0)
  })

  test('navigates to design page when start button is clicked', async ({ page }) => {
    const button = page.getByRole('link', { name: 'Kom igång' })

    await button.click()

    await expect(page).toHaveURL('/design')
  })

  test('start button is visible when name is entered', async ({ page }) => {
    const nameInput = page.getByLabel('Ditt namn')
    const button = page.getByRole('link', { name: 'Kom igång' })

    await nameInput.fill('Anna')

    await expect(button).toBeVisible()
  })
})
