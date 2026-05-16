import { test, expect } from '@playwright/test'

test.describe('Building Model Extraction', () => {
  test.describe('Scenario 1: Initial building model extraction from Swedish description', () => {
    test('extracts flowType, length, and width from initial message', async ({
      page,
    }) => {
      await page.goto('/design')

      await page.getByTestId('chat-input').fill(
        'Jag vill bygga en komplementbyggnad, 4.5 meter lång och 4.5 meter bred',
      )
      await page.getByRole('button', { name: 'Skicka' }).click()

      const modelState = page.getByTestId('model-state')
      await expect(modelState).toBeVisible({ timeout: 15000 })

      const modelText = await modelState.textContent()
      expect(modelText).toBeDefined()
      const model = JSON.parse(modelText!)

      expect(model).toMatchObject({
        flowType: 'komplementbyggnad',
        footprint: {
          length: 4.5,
          width: 4.5
        }
      })

      expect(modelText).not.toContain('null')
      expect(modelText).not.toMatch(/"length"\s*:\s*null/)
      expect(modelText).not.toMatch(/"width"\s*:\s*null/)
      expect(modelText).not.toMatch(/"flowType"\s*:\s*null/)
    })

    test('does not contain error text after extraction', async ({ page }) => {
      await page.goto('/design')

      await page.getByTestId('chat-input').fill(
        'Jag vill bygga en komplementbyggnad, 4.5 meter lång och 4.5 meter bred',
      )
      await page.getByRole('button', { name: 'Skicka' }).click()

      const modelState = page.getByTestId('model-state')
      await expect(modelState).toBeVisible({ timeout: 15000 })

      const modelText = await modelState.textContent()
      expect(modelText).toBeDefined()

      expect(modelText?.toLowerCase()).not.toContain('fel uppstod')
      expect(modelText?.toLowerCase()).not.toContain('error')
      expect(modelText?.toLowerCase()).not.toContain('undefined')
    })
  })

  test.describe('Scenario 2: Partial update to extracted model', () => {
    test('updates only changed fields while preserving others', async ({
      page,
    }) => {
      await page.goto('/design')

      await page.getByTestId('chat-input').fill(
        'Jag vill bygga en komplementbyggnad, 4.5 meter lång och 4.5 meter bred',
      )
      await page.getByRole('button', { name: 'Skicka' }).click()

      let modelState = page.getByTestId('model-state')
      await expect(modelState).toBeVisible({ timeout: 15000 })

      let modelText = await modelState.textContent()
      expect(modelText).toBeDefined()

      const initialUrl = page.url()

      await page.getByTestId('chat-input').fill('Ändra längden till 5 meter')
      await page.getByRole('button', { name: 'Skicka' }).click()

      modelState = page.getByTestId('model-state')
      await expect(modelState).toBeVisible()

      await page.waitForTimeout(10000)

      modelText = await modelState.textContent()
      expect(modelText).toBeDefined()
      const model = JSON.parse(modelText!)

      expect(model).toMatchObject({
        flowType: 'komplementbyggnad',
        footprint: {
          length: 5,
          width: 4.5
        }
      })

      expect(page.url()).toBe(initialUrl)

      const assistantMessages = await page.getByTestId('assistant-message').all()
      expect(assistantMessages.length).toBeGreaterThan(0)
    })
  })

  test.describe('Scenario 3: Empty model state before any messages', () => {
    test('shows null or empty object before any messages', async ({ page }) => {
      await page.goto('/design')

      const modelState = page.getByTestId('model-state')
      await expect(modelState).toBeVisible()

      const modelText = await modelState.textContent()
      expect(modelText).toBeDefined()

      const trimmedText = modelText!.trim()
      expect(
        trimmedText === 'null' ||
        trimmedText === '{}' ||
        trimmedText === ''
      ).toBe(true)

      expect(trimmedText).not.toContain('4.5')
      expect(trimmedText).not.toContain('komplementbyggnad')
      expect(trimmedText).not.toMatch(/"length"\s*:/)
      expect(trimmedText).not.toMatch(/"width"\s*:/)
      expect(trimmedText).not.toMatch(/"flowType"\s*:/)
    })

    test('does not show fabricated values on initial load', async ({
      page,
    }) => {
      await page.goto('/design')

      const modelState = page.getByTestId('model-state')
      await expect(modelState).toBeVisible()

      const modelText = await modelState.textContent()
      expect(modelText).toBeDefined()

      expect(modelText).not.toContain('meter')
      expect(modelText).not.toContain('byggnad')
      expect(modelText?.toLowerCase()).not.toContain('komplementbyggnad')
      expect(modelText?.toLowerCase()).not.toContain('friggebod')
      expect(modelText?.toLowerCase()).not.toContain('attefallshus')
    })
  })
})