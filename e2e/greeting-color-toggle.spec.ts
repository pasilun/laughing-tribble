import { test, expect } from '@playwright/test'

test.describe('Greeting Color Toggle Feature', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
  })

  test('Scenario 1: Toggle greeting color to red', async ({ page }) => {
    const button = page.getByRole('button', { name: 'Byt färg' })
    const greeting = page.getByRole('heading', { level: 1 })

    await expect(greeting).toHaveCSS('color', 'rgb(0, 0, 0)')

    await button.click()

    await expect(greeting).toHaveCSS('color', 'rgb(220, 38, 38)')

    await button.click()

    await expect(greeting).toHaveCSS('color', 'rgb(0, 0, 0)')
  })

  test('Scenario 2: Initial button state', async ({ page }) => {
    const button = page.getByRole('button', { name: 'Byt färg' })
    const greeting = page.getByRole('heading', { level: 1 })

    await expect(button).toBeVisible()

    await expect(greeting).toHaveCSS('color', 'rgb(0, 0, 0)')
  })

  test('Scenario 3: Multiple toggles - three clicks results in red', async ({ page }) => {
    const button = page.getByRole('button', { name: 'Byt färg' })
    const greeting = page.getByRole('heading', { level: 1 })

    await button.click()
    await button.click()
    await button.click()

    await expect(greeting).toHaveCSS('color', 'rgb(220, 38, 38)')
  })

  test('Scenario 3: Multiple toggles - four more clicks returns to default', async ({ page }) => {
    const button = page.getByRole('button', { name: 'Byt färg' })
    const greeting = page.getByRole('heading', { level: 1 })

    await button.click()
    await expect(greeting).toHaveCSS('color', 'rgb(220, 38, 38)')

    await button.click()
    await button.click()
    await button.click()
    await button.click()

    await expect(greeting).toHaveCSS('color', 'rgb(0, 0, 0)')
  })
})
