import { test, expect } from '@playwright/test'

// Regression test for specs/design-screen.md (active capability spec).
// Covers the streaming chat shell. Does NOT assert the temporary debug bar
// (known deviation, slated for removal — see the spec).

test.describe('Design Screen - identity', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/design')
  })

  test('shows the Design heading', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Design' })).toBeVisible()
  })

  test('shows an empty-state prompt', async ({ page }) => {
    await expect(page.getByText(/beskriv ditt projekt/i)).toBeVisible()
  })
})

test.describe('Design Screen - composer', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/design')
  })

  test('has an input and a Skicka button', async ({ page }) => {
    await expect(
      page.getByPlaceholder('Beskriv vad du vill bygga...'),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: 'Skicka' })).toBeVisible()
  })

  test('send button is disabled while input is empty', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Skicka' })).toBeDisabled()
    await page.getByTestId('chat-input').fill('en friggebod')
    await expect(page.getByRole('button', { name: 'Skicka' })).toBeEnabled()
  })
})

test.describe('Design Screen - conversation', () => {
  test('sending a message echoes it, clears input, and streams a reply', async ({
    page,
  }) => {
    await page.goto('/design')

    // Use the deterministic seam fixture prompt to ensure deterministic
    // behaviour in preview without requiring a real LLM key.
    const fixturePrompt =
      'Jag vill bygga en komplementbyggnad, 4.5 meter lång och 4.5 meter bred'
    await page.getByTestId('chat-input').fill(fixturePrompt)
    await page.getByRole('button', { name: 'Skicka' }).click()

    // User message is echoed and the input clears immediately.
    await expect(page.getByText(fixturePrompt)).toBeVisible()
    await expect(page.getByTestId('chat-input')).toHaveValue('')

    // Assistant reply streams in. This is verified deterministically via the
    // [[deterministic-chat-seam]] fixture. We only assert the chat-streaming
    // UX here, not specific building-model values (those are covered by the
    // seam's own regression test).
    const assistantMessage = page.getByTestId('assistant-message').first()
    await expect(assistantMessage).toBeVisible({ timeout: 30_000 })

    // Verify the streamed content is non-empty and does not contain error text.
    const messageText = await assistantMessage.textContent()
    expect(messageText?.trim().length).toBeGreaterThan(0)
    expect(messageText).not.toContain('error')
    expect(messageText).not.toContain('fel uppstod')
    expect(messageText).not.toContain('undefined')
  })
})

test.describe('Design Screen - reachable from landing', () => {
  test('Kom igång navigates here', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('link', { name: 'Kom igång' }).click()
    await expect(page).toHaveURL('/design')
    await expect(page.getByRole('heading', { name: 'Design' })).toBeVisible()
  })
})
