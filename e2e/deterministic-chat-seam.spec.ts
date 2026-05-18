import { test, expect } from '@playwright/test'

test.describe('Deterministic Chat Seam', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/design')
  })

  test('Scenario 1: Empty model state before any messages', async ({ page }) => {
    const modelState = page.getByTestId('model-state')

    await expect(modelState).toBeVisible()
    const modelStateText = await modelState.textContent()

    expect(modelStateText).toBe('null')
    expect(modelStateText).not.toContain('undefined')
    expect(modelStateText).not.toContain('fel uppstod')
    expect(modelStateText).not.toContain('error')
  })

  test('Scenario 2: Full model extraction from first fixture prompt', async ({ page }) => {
    const chatInput = page.getByTestId('chat-input')
    const sendButton = page.getByTestId('send-button')
    const modelState = page.getByTestId('model-state')

    const message = 'Jag vill bygga en komplementbyggnad, 4.5 meter lång och 4.5 meter bred'

    await chatInput.fill(message)
    await sendButton.click()

    await expect(page.getByTestId('assistant-message')).toBeVisible({ timeout: 15000 })

    await expect(modelState).toContainText('komplementbyggnad', { timeout: 15000 })
    await expect(modelState).toContainText('4.5', { timeout: 15000 })

    const modelStateText = await modelState.textContent()
    expect(modelStateText).toContain('flowType')
    expect(modelStateText).toContain('komplementbyggnad')
    expect(modelStateText).toContain('length')
    expect(modelStateText).toContain('4.5')
    expect(modelStateText).toContain('width')
    expect(modelStateText).toContain('4.5')
    expect(modelStateText).not.toContain('null')
    expect(modelStateText).not.toContain('undefined')
    expect(modelStateText).not.toContain('fel uppstod')
    expect(modelStateText).not.toContain('error')
  })

  test('Scenario 3: Partial model update from second fixture prompt', async ({ page }) => {
    const chatInput = page.getByTestId('chat-input')
    const sendButton = page.getByTestId('send-button')
    const modelState = page.getByTestId('model-state')

    const firstMessage = 'Jag vill bygga en komplementbyggnad, 4.5 meter lång och 4.5 meter bred'
    await chatInput.fill(firstMessage)
    await sendButton.click()

    await expect(page.getByTestId('assistant-message')).toBeVisible({ timeout: 15000 })
    await expect(modelState).toContainText('komplementbyggnad', { timeout: 15000 })
    await expect(modelState).toContainText('4.5', { timeout: 15000 })

    await chatInput.fill('Ändra längden till 5 meter')
    await sendButton.click()

    const initialUrl = page.url()

    await expect(modelState).toContainText('5', { timeout: 10000 })

    const finalUrl = page.url()
    expect(finalUrl).toBe(initialUrl)

    const modelStateText = await modelState.textContent()
    expect(modelStateText).toContain('length')
    expect(modelStateText).toContain('5')
    expect(modelStateText).toContain('width')
    expect(modelStateText).toContain('4.5')
    expect(modelStateText).toContain('flowType')
    expect(modelStateText).toContain('komplementbyggnad')

    const assistantMessages = await page.getByTestId('assistant-message').all()
    expect(assistantMessages.length).toBeGreaterThanOrEqual(2)

    expect(modelStateText).not.toContain('undefined')
    expect(modelStateText).not.toContain('fel uppstod')
    expect(modelStateText).not.toContain('error')
  })
})
