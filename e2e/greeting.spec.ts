import { test, expect } from '@playwright/test'

test.describe('Greeting Feature', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
  })

  test('displays default greeting', async ({ page }) => {
    const greeting = page.getByRole('heading', { level: 1 })
    await expect(greeting).toHaveText('Välkommen till Bygglovsassistenten')
  })

  test('displays personalized greeting when name is entered', async ({ page }) => {
    const nameInput = page.getByLabel('Ditt namn')
    const greeting = page.getByRole('heading', { level: 1 })

    await nameInput.fill('Anna')
    await expect(greeting).toHaveText('Välkommen, Anna!')
  })

  test('updates greeting when name changes', async ({ page }) => {
    const nameInput = page.getByLabel('Ditt namn')
    const greeting = page.getByRole('heading', { level: 1 })

    await nameInput.fill('Anna')
    await expect(greeting).toHaveText('Välkommen, Anna!')

    await nameInput.fill('Erik')
    await expect(greeting).toHaveText('Välkommen, Erik!')
  })

  test('reverts to default greeting when name is cleared', async ({ page }) => {
    const nameInput = page.getByLabel('Ditt namn')
    const greeting = page.getByRole('heading', { level: 1 })

    await nameInput.fill('Anna')
    await expect(greeting).toHaveText('Välkommen, Anna!')

    await nameInput.fill('')
    await expect(greeting).toHaveText('Välkommen till Bygglovsassistenten')
  })
})
