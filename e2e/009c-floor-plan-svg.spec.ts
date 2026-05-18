import { test, expect } from '@playwright/test'

test.describe('Floor Plan SVG', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/design')
  })

  test('Scenario 1: Placeholder before footprint is set', async ({ page }) => {
    const floorPlanSvg = page.getByTestId('floor-plan-svg')
    await expect(floorPlanSvg).not.toBeVisible()

    const placeholder = page.getByText(/beskriv dimensioner för att se ritning/i)
    await expect(placeholder).toBeVisible()
  })

  test('Scenario 2: Floor plan appears after footprint is set', async ({ page }) => {
    const chatInput = page.getByTestId('chat-input')
    const sendButton = page.getByTestId('send-button')

    const message = 'Jag vill bygga en komplementbyggnad, 4.5 meter lång och 4.5 meter bred'
    await chatInput.fill(message)
    await sendButton.click()

    await expect(page.getByTestId('floor-plan-svg')).toBeVisible({ timeout: 15000 })

    const floorPlanSvg = page.getByTestId('floor-plan-svg')
    const svgContent = await floorPlanSvg.innerHTML()
    expect(svgContent.length).toBeGreaterThan(10)
    expect(svgContent).not.toContain('fel uppstod')
    expect(svgContent).not.toContain('error')
    expect(svgContent).not.toContain('undefined')

    const rect = floorPlanSvg.locator('rect[data-testid="floor-plan-rect"]')
    await expect(rect).toBeVisible()

    const lengthLabel = page.getByTestId('dim-label-length')
    await expect(lengthLabel).toBeVisible()
    const lengthText = await lengthLabel.textContent()
    expect(lengthText).toContain('4.5')

    const widthLabel = page.getByTestId('dim-label-width')
    await expect(widthLabel).toBeVisible()
    const widthText = await widthLabel.textContent()
    expect(widthText).toContain('4.5')

    const areaText = await page.getByText(/Byggnadsarea:/).textContent()
    expect(areaText).toContain('20.25')
  })

  test('Scenario 3: Floor plan updates live when dimensions change', async ({ page }) => {
    const chatInput = page.getByTestId('chat-input')
    const sendButton = page.getByTestId('send-button')

    const firstMessage = 'Jag vill bygga en komplementbyggnad, 4.5 meter lång och 4.5 meter bred'
    await chatInput.fill(firstMessage)
    await sendButton.click()

    await expect(page.getByTestId('floor-plan-svg')).toBeVisible({ timeout: 15000 })

    const lengthLabel = page.getByTestId('dim-label-length')
    await expect(lengthLabel).toContainText('4.5', { timeout: 15000 })

    const initialUrl = page.url()

    const secondMessage = 'Ändra längden till 5 meter'
    await chatInput.fill(secondMessage)
    await sendButton.click()

    await expect(lengthLabel).toContainText('5', { timeout: 5000 })

    const finalUrl = page.url()
    expect(finalUrl).toBe(initialUrl)

    const widthLabel = page.getByTestId('dim-label-width')
    await expect(widthLabel).toContainText('4.5')

    const areaText = await page.getByText(/Byggnadsarea:/).textContent()
    expect(areaText).toContain('22.5')
  })

  test('Scenario 4: BYA displayed correctly', async ({ page }) => {
    const chatInput = page.getByTestId('chat-input')
    const sendButton = page.getByTestId('send-button')

    const message = 'Jag vill bygga en komplementbyggnad, 3 meter lång och 6 meter bred'
    await chatInput.fill(message)
    await sendButton.click()

    await expect(page.getByTestId('floor-plan-svg')).toBeVisible({ timeout: 15000 })

    const areaLabel = page.getByText(/Byggnadsarea:/)
    await expect(areaLabel).toBeVisible()

    const areaText = await areaLabel.textContent()
    expect(areaText).toContain('18')
  })
})
