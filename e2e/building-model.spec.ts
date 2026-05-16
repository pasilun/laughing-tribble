import { test, expect } from '@playwright/test'

test.describe('BuildingModel Tool Extraction', () => {
  test.describe('Scenario 1: Building dimensions extracted from description', () => {
    test('shows model summary panel with length and width', async ({
      page,
    }) => {
      await page.goto('/design')

      await page.getByTestId('chat-input').fill(
        'Jag vill bygga en komplementbyggnad, 4.5 meter lång och 4.5 meter bred',
      )
      await page.getByRole('button', { name: 'Skicka' }).click()

      await expect(page.getByTestId('assistant-message').first()).toBeVisible({
        timeout: 30_000,
      })

      const panel = page.locator('.w-80')
      await expect(panel).toBeVisible({ timeout: 15_000 })

      const content = await panel.textContent()
      expect(content).toContain('4.5')
      const matches = content?.match(/4\.5/g) || []
      expect(matches.length).toBeGreaterThanOrEqual(2)
    })
  })

  test.describe('Scenario 2: Model updates on correction', () => {
    test('updates length while keeping width unchanged', async ({ page }) => {
      await page.goto('/design')

      await page
        .getByTestId('chat-input')
        .fill(
          'Jag vill bygga en komplementbyggnad, 4.5 meter lång och 4.5 meter bred',
        )
      await page.getByRole('button', { name: 'Skicka' }).click()

      await expect(page.getByTestId('assistant-message').first()).toBeVisible({
        timeout: 30_000,
      })

      const panel = page.locator('.w-80')
      await expect(panel).toBeVisible({ timeout: 15_000 })

      await page.getByTestId('chat-input').fill('Ändra längden till 5 meter')
      await page.getByRole('button', { name: 'Skicka' }).click()

      await expect(page.getByTestId('assistant-message').nth(1)).toBeVisible({
        timeout: 15_000,
      })

      const content = await panel.textContent()
      expect(content).toContain('5')
      expect(content).toContain('4.5')
    })
  })

  test.describe('Scenario 3: Roof type extracted', () => {
    test('shows roof type and pitch', async ({ page }) => {
      await page.goto('/design')

      await page
        .getByTestId('chat-input')
        .fill(
          'Jag vill bygga en komplementbyggnad, 4.5 meter lång och 4.5 meter bred',
        )
      await page.getByRole('button', { name: 'Skicka' }).click()

      await expect(page.getByTestId('assistant-message').first()).toBeVisible({
        timeout: 30_000,
      })

      await page
        .getByTestId('chat-input')
        .fill('Sadeltak med 25 graders lutning')
      await page.getByRole('button', { name: 'Skicka' }).click()

      await expect(page.getByTestId('assistant-message').nth(1)).toBeVisible({
        timeout: 15_000,
      })

      const panel = page.locator('.w-80')
      const content = await panel.textContent()
      expect(content).toContain('sadel')
      expect(content).toContain('25')
    })
  })

  test.describe('Scenario 4: Installations extracted', () => {
    test('shows installations list', async ({ page }) => {
      await page.goto('/design')

      await page
        .getByTestId('chat-input')
        .fill('Jag vill bygga en bastu')
      await page.getByRole('button', { name: 'Skicka' }).click()

      await expect(page.getByTestId('assistant-message').first()).toBeVisible({
        timeout: 30_000,
      })

      await page
        .getByTestId('chat-input')
        .fill('Den ska ha dusch och avlopp')
      await page.getByRole('button', { name: 'Skicka' }).click()

      await expect(page.getByTestId('assistant-message').nth(1)).toBeVisible({
        timeout: 15_000,
      })

      const panel = page.locator('.w-80')
      const content = await panel.textContent()
      expect(content).toContain('vatten')
      expect(content).toContain('avlopp')
    })
  })

  test.describe('Scenario 5: Computed values shown', () => {
    test('shows BYA and nockhöjd computed values', async ({ page }) => {
      await page.goto('/design')

      await page
        .getByTestId('chat-input')
        .fill(
          'Jag vill bygga en komplementbyggnad, 4.5 meter lång och 4.5 meter bred',
        )
      await page.getByRole('button', { name: 'Skicka' }).click()

      await expect(page.getByTestId('assistant-message').first()).toBeVisible({
        timeout: 30_000,
      })

      await page
        .getByTestId('chat-input')
        .fill('Sadeltak med 25 graders lutning och vägghöjd 2.4 meter')
      await page.getByRole('button', { name: 'Skicka' }).click()

      await expect(page.getByTestId('assistant-message').nth(1)).toBeVisible({
        timeout: 15_000,
      })

      const panel = page.locator('.w-80')
      const content = await panel.textContent()
      expect(content).toContain('20.25')
      expect(content).toContain('m')
    })
  })
})