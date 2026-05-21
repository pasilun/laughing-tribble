import { test, expect, Page } from '@playwright/test'

const KOMPLEMENT = 'Jag vill bygga en komplementbyggnad, 4.5 meter lång och 4.5 meter bred'
const LOVFRI = 'Jag vill bygga en komplementbyggnad, 4 meter lång och 4 meter bred, utanför detaljplan och utan installationer'

async function ask(page: Page, prompt: string, nth: number) {
  await page.getByPlaceholder('Beskriv vad du vill bygga...').fill(prompt)
  await page.getByRole('button', { name: 'Skicka' }).click()
  await expect(page.getByTestId('assistant-message').nth(nth)).toBeVisible({ timeout: 15000 })
}

test.describe('Triage Panel (009d)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/design')
  })

  test('Scenario 1: no bucket before property context', async ({ page }) => {
    await ask(page, KOMPLEMENT, 0)
    await expect(page.getByTestId('triage-bucket')).toHaveCount(0)
    await expect(page.getByTestId('triage-incomplete')).toBeVisible()
  })

  test('Scenario 2: LOVFRI for small komplementbyggnad outside detaljplan', async ({ page }) => {
    await ask(page, LOVFRI, 0)
    await expect(page.getByTestId('triage-bucket')).toContainText('LOVFRI')
    await expect(page.getByTestId('triage-reasons').getByRole('listitem').first()).toBeVisible()
    await expect(page.getByTestId('triage-incomplete')).toHaveCount(0)
  })

  test('Scenario 3: vatten/avlopp upgrades LOVFRI to ANMÄLAN', async ({ page }) => {
    await ask(page, LOVFRI, 0)
    await expect(page.getByTestId('triage-bucket')).toContainText('LOVFRI')
    await ask(page, 'Den ska ha dusch och avlopp', 1)
    await expect(page.getByTestId('triage-bucket')).toContainText('ANMÄLAN')
    await expect(page.getByTestId('triage-reasons')).toContainText(/vatten|avlopp/i)
  })

  test('Scenario 4: eldstad triggers ANMÄLAN', async ({ page }) => {
    await ask(page, LOVFRI, 0)
    await ask(page, 'Den ska ha en eldstad', 1)
    await expect(page.getByTestId('triage-bucket')).toContainText('ANMÄLAN')
    await expect(page.getByTestId('triage-reasons')).toContainText(/eldstad|rökkanal/i)
  })

  test('Scenario 5: bucket updates in place without reload', async ({ page }) => {
    await ask(page, LOVFRI, 0)
    await expect(page.getByTestId('triage-bucket')).toContainText('LOVFRI')
    await ask(page, 'Den ska ha en eldstad', 1)
    await expect(page.getByTestId('triage-bucket')).toContainText('ANMÄLAN')
    await expect(page.getByTestId('assistant-message')).toHaveCount(2)
    await expect(page.getByTestId('triage-bucket')).not.toContainText('null')
    await expect(page.getByTestId('triage-bucket')).not.toContainText('undefined')
  })
})
