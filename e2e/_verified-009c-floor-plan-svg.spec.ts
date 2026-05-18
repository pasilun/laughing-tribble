import { test, expect } from '@playwright/test'

test.describe('SVG Floor Plan', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/design')
  })

  test('Scenario 1: Placeholder before footprint is set', async ({ page }) => {
    await expect(page.getByTestId('floor-plan-svg')).not.toBeVisible()
    
    await expect(page.getByText('Beskriv dimensioner för att se ritning')).toBeVisible()
  })

  test('Scenario 2: Floor plan appears after footprint is set', async ({ page }) => {
    await page.getByPlaceholder('Beskriv vad du vill bygga...').fill(
      'Jag vill bygga en komplementbyggnad, 4.5 meter lång och 4.5 meter bred',
    )
    await page.getByRole('button', { name: 'Skicka' }).click()

    await expect(page.getByTestId('floor-plan-svg')).toBeVisible({
      timeout: 15000,
    })

    const floorPlanSvg = page.getByTestId('floor-plan-svg')
    const rect = floorPlanSvg.locator('rect[data-testid="floor-plan-rect"]')
    await expect(rect).toBeVisible()

    const dimLabelLength = page.getByTestId('dim-label-length')
    await expect(dimLabelLength).toBeVisible()
    await expect(dimLabelLength).toHaveText('4.5')

    const dimLabelWidth = page.getByTestId('dim-label-width')
    await expect(dimLabelWidth).toBeVisible()
    await expect(dimLabelWidth).toHaveText('4.5')

    await expect(page.getByText('Byggnadsarea: 20.25')).toBeVisible()

    await expect(page.getByText('fel uppstod')).not.toBeVisible()
    await expect(page.getByText(/error/i)).not.toBeVisible()
    await expect(page.getByText('undefined')).not.toBeVisible()
  })

  test('Scenario 3: Floor plan updates live when dimensions change', async ({ page }) => {
    await page.getByPlaceholder('Beskriv vad du vill bygga...').fill(
      'Jag vill bygga en komplementbyggnad, 4.5 meter lång och 4.5 meter bred',
    )
    await page.getByRole('button', { name: 'Skicka' }).click()

    await expect(page.getByTestId('floor-plan-svg')).toBeVisible({
      timeout: 15000,
    })

    const urlBeforeUpdate = page.url()

    await page.getByPlaceholder('Beskriv vad du vill bygga...').fill('Ändra längden till 5 meter')
    await page.getByRole('button', { name: 'Skicka' }).click()

    await expect(page.getByTestId('dim-label-length')).toHaveText('5', {
      timeout: 5000,
    })

    await expect(page.getByTestId('dim-label-width')).toHaveText('4.5')

    await expect(page.getByText('Byggnadsarea: 22.5')).toBeVisible()

    const floorPlanSvg = page.getByTestId('floor-plan-svg')
    const rect = floorPlanSvg.locator('rect[data-testid="floor-plan-rect"]')
    const rectBox = await rect.boundingBox()
    const dimLabelWidth = page.getByTestId('dim-label-width')
    const dimLabelLength = page.getByTestId('dim-label-length')
    
    expect(rectBox?.width).toBeGreaterThan(280)

    await expect(page).toHaveURL(urlBeforeUpdate)

    await expect(page.getByText('fel uppstod')).not.toBeVisible()
    await expect(page.getByText(/error/i)).not.toBeVisible()
    await expect(page.getByText('undefined')).not.toBeVisible()
  })

  test('Scenario 4: BYA displayed correctly', async ({ page }) => {
    await page.getByPlaceholder('Beskriv vad du vill bygga...').fill(
      'Jag vill bygga en komplementbyggnad, 4.5 meter lång och 4.5 meter bred',
    )
    await page.getByRole('button', { name: 'Skicka' }).click()

    await expect(page.getByTestId('floor-plan-svg')).toBeVisible({
      timeout: 15000,
    })

    const byggnadsareaText = await page.getByText(/Byggnadsarea:/).textContent()
    expect(byggnadsareaText).toMatch(/Byggnadsarea:\s*[\d.]+/)
    
    await expect(page.getByText('Byggnadsarea: 20.25')).toBeVisible()
  })
})
