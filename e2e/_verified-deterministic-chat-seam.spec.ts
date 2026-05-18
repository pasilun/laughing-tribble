import { test, expect } from '@playwright/test'

test.describe('Deterministic Chat Seam', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/design')
  })

  test('Scenario 1: Empty model state before any messages', async ({ page }) => {
    const modelState = page.getByTestId('model-state')
    await expect(modelState).toBeVisible()
    
    const modelStateText = await modelState.textContent()
    expect(modelStateText).toMatch(/^(null|\{\}|)$/)
    
    await expect(modelState).not.toContainText('fel uppstod')
    await expect(modelState).not.toContainText('error')
    await expect(modelState).not.toContainText('undefined')
  })

  test('Scenario 2: Full model extraction from first fixture prompt', async ({ page }) => {
    await page.getByPlaceholder('Beskriv vad du vill bygga...').fill(
      'Jag vill bygga en komplementbyggnad, 4.5 meter lång och 4.5 meter bred',
    )
    await page.getByRole('button', { name: 'Skicka' }).click()

    await expect(page.getByTestId('assistant-message').first()).toBeVisible({
      timeout: 15000,
    })

    const modelState = page.getByTestId('model-state')
    await expect(modelState).toContainText('komplementbyggnad')
    await expect(modelState).toContainText('"length": 4.5')
    await expect(modelState).toContainText('"width": 4.5')

    await expect(modelState).not.toContainText('null')
    await expect(modelState).not.toContainText('fel uppstod')
    await expect(modelState).not.toContainText('error')

    const assistantText = await page
      .getByTestId('assistant-message')
      .first()
      .textContent()
    expect(assistantText?.length).toBeGreaterThan(10)
    await expect(assistantText || '').not.toContain('fel uppstod')
    await expect(assistantText || '').not.toContain('error')
  })

  test('Scenario 3: Partial model update from second fixture prompt', async ({ page }) => {
    await page.getByPlaceholder('Beskriv vad du vill bygga...').fill(
      'Jag vill bygga en komplementbyggnad, 4.5 meter lång och 4.5 meter bred',
    )
    await page.getByRole('button', { name: 'Skicka' }).click()

    await expect(page.getByTestId('assistant-message').first()).toBeVisible({
      timeout: 15000,
    })

    const urlBeforeUpdate = page.url()

    await page.getByPlaceholder('Beskriv vad du vill bygga...').fill('Ändra längden till 5 meter')
    await page.getByRole('button', { name: 'Skicka' }).click()

    await expect(page.getByTestId('assistant-message').nth(1)).toBeVisible({
      timeout: 10000,
    })

    const modelState = page.getByTestId('model-state')
    await expect(modelState).toContainText('"length": 5')
    await expect(modelState).toContainText('"width": 4.5')
    await expect(modelState).toContainText('komplementbyggnad')

    await expect(page).toHaveURL(urlBeforeUpdate)

    await expect(page.getByText('Jag vill bygga en komplementbyggnad, 4.5 meter lång och 4.5 meter bred')).toBeVisible()
    await expect(page.getByText('Ändra längden till 5 meter')).toBeVisible()
    await expect(page.getByTestId('assistant-message')).toHaveCount(2)

    await expect(modelState).not.toContainText('fel uppstod')
    await expect(modelState).not.toContainText('error')
  })
})
