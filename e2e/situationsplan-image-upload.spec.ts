import { test, expect } from '@playwright/test'

test.describe('Situationsplan Screen - Scenario 2', () => {
  test('upload and display fastighetskarta image', async ({ page }) => {
    await page.goto('/situationsplan')

    const fileInput = page.getByTestId('map-upload')
    
    const testImagePath = './e2e/fixtures/test-map.png'
    await fileInput.setInputFiles(testImagePath)

    const mapCanvas = page.getByTestId('map-canvas')
    await expect(mapCanvas).toBeVisible()

    const image = mapCanvas.locator('img').first()
    await expect(image).toBeVisible()
    await expect(image).toHaveAttribute('alt', 'Fastighetskarta')
  })
})
