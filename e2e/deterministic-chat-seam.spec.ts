import { test, expect } from '@playwright/test'

test.describe('Deterministic Chat Seam', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/design')
  })

  test('empty model state before any messages', async ({ page }) => {
    const modelState = page.getByTestId('model-state')
    await expect(modelState).toBeVisible()

    const modelText = await modelState.textContent()
    expect(modelText).toBe('null')
  })

  test('full model extraction from first fixture prompt', async ({ page }) => {
    const modelState = page.getByTestId('model-state')

    await page.getByTestId('chat-input').fill(
      'Jag vill bygga en komplementbyggnad, 4.5 meter lång och 4.5 meter bred',
    )
    await page.getByRole('button', { name: 'Skicka' }).click()

    await expect(page.getByTestId('assistant-message')).toBeVisible({
      timeout: 15000,
    })

    await expect(async () => {
      const modelText = await modelState.textContent()
      expect(modelText).toContain('komplementbyggnad')
      expect(modelText).toContain('4.5')
    }).toPass({ timeout: 15000 })

    const modelText = await modelState.textContent()
    expect(modelText).toContain('flowType')
    expect(modelText).toContain('komplementbyggnad')
    expect(modelText).toContain('length')
    expect(modelText).toContain('4.5')
    expect(modelText).toContain('width')
    expect(modelText).toContain('4.5')

    const modelObj = JSON.parse(modelText!)
    expect(modelObj.flowType).toBe('komplementbyggnad')
    expect(modelObj.footprint?.length).toBe(4.5)
    expect(modelObj.footprint?.width).toBe(4.5)
  })

  test('partial model update from second fixture prompt', async ({ page }) => {
    const modelState = page.getByTestId('model-state')

    await page.getByTestId('chat-input').fill(
      'Jag vill bygga en komplementbyggnad, 4.5 meter lång och 4.5 meter bred',
    )
    await page.getByRole('button', { name: 'Skicka' }).click()

    await expect(page.getByTestId('assistant-message')).toBeVisible({
      timeout: 15000,
    })

    await expect(async () => {
      const modelText = await modelState.textContent()
      expect(modelText).toContain('komplementbyggnad')
    }).toPass({ timeout: 15000 })

    const initialUrl = page.url()

    await page.getByTestId('chat-input').fill('Ändra längden till 5 meter')
    await page.getByRole('button', { name: 'Skicka' }).click()

    await expect(async () => {
      const modelText = await modelState.textContent()
      const modelObj = JSON.parse(modelText!)
      expect(modelObj.footprint?.length).toBe(5)
      expect(modelObj.footprint?.width).toBe(4.5)
      expect(modelObj.flowType).toBe('komplementbyggnad')
    }).toPass({ timeout: 10000 })

    const finalUrl = page.url()
    expect(finalUrl).toBe(initialUrl)

    const allMessages = await page.getByText(/Jag vill bygga|Ändra längden/).all()
    expect(allMessages.length).toBeGreaterThanOrEqual(2)

    const assistantMessages = await page.getByTestId('assistant-message').all()
    expect(assistantMessages.length).toBe(2)
  })
})