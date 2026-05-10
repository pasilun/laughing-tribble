import { test, expect } from '@playwright/test'

test.describe('Situationsplan Screen - Scenario 4', () => {
  test('place building rectangle via button', async ({ page }) => {
    await page.goto('/situationsplan')

    const fileInput = page.getByTestId('map-upload')
    const testImagePath = './e2e/fixtures/test-map.png'
    await fileInput.setInputFiles(testImagePath)

    const mapCanvas = page.getByTestId('map-canvas')
    await expect(mapCanvas).toBeVisible()

    const addBuildingBtn = page.getByTestId('add-building-btn')
    await expect(addBuildingBtn).toBeVisible()
    await addBuildingBtn.click()

    const buildingRect = page.getByTestId('building-rect')
    await expect(buildingRect).toBeVisible()
    await expect(buildingRect).toHaveClass(/border-4/)
    await expect(buildingRect).toHaveClass(/border-red-500/)
  })
})
