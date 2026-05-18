import { test, expect } from '@playwright/test'

test.describe('Design Screen', () => {
  test('Scenario 1: The screen is identifiable', async ({ page }) => {
    await page.goto('/design')

    await expect(page.getByRole('heading', { name: 'Design' })).toBeVisible()
    await expect(page.getByText(/beskriv ditt projekt/i)).toBeVisible()
  })

  test('Scenario 2: Message composer', async ({ page }) => {
    await page.goto('/design')

    const input = page.getByPlaceholder('Beskriv vad du vill bygga...')
    await expect(input).toBeVisible()

    const sendButton = page.getByRole('button', { name: 'Skicka' })
    await expect(sendButton).toBeVisible()
    await expect(sendButton).toBeDisabled()

    await input.fill('test')
    await expect(sendButton).toBeEnabled()
  })

  test('Scenario 3: Sending a message triggers streaming response', async ({
    page,
  }) => {
    await page.goto('/design')

    const input = page.getByTestId('chat-input')
    await input.fill(
      'Jag vill bygga en komplementbyggnad, 4.5 meter lång och 4.5 meter bred',
    )

    const sendButton = page.getByTestId('send-button')
    await sendButton.click()

    await expect(page.getByText('Jag vill bygga en komplementbyggnad, 4.5 meter lång och 4.5 meter bred')).toBeVisible({
      timeout: 1000,
    })
    await expect(input).toHaveValue('')

    const assistantMessage = page.getByTestId('assistant-message')
    await expect(assistantMessage).toBeVisible({ timeout: 30000 })

    const assistantText = await assistantMessage.textContent()
    expect(assistantText?.length).toBeGreaterThan(0)
    await expect(assistantMessage).not.toContainText('error')
    await expect(assistantMessage).not.toContainText('fel uppstod')
    await expect(assistantMessage).not.toContainText('undefined')

    const firstLength = assistantText?.length || 0

    await page.waitForTimeout(800)

    const secondLength = (await assistantMessage.textContent())?.length || 0
    expect(secondLength).toBeGreaterThanOrEqual(firstLength)
  })

  test('Scenario 4: Reachable from the landing page', async ({ page }) => {
    await page.goto('/')

    await expect(
      page.getByRole('link', { name: 'Kom igång' }),
    ).toBeVisible()

    await page.getByRole('link', { name: 'Kom igång' }).click()

    await expect(page).toHaveURL('/design')
    await expect(page.getByRole('heading', { name: 'Design' })).toBeVisible()
  })
})
