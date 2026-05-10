import { test, expect } from '@playwright/test'

test.describe('Situationsplan Screen - Scenario 10', () => {
  test('add building button requires uploaded map', async ({ page }) => {
    await page.goto('/situationsplan')

    const addBuildingBtn = page.getByTestId('add-building-btn')
    await expect(addBuildingBtn).toBeVisible()
    
    const isDisabled = await addBuildingBtn.isDisabled()
    await expect(isDisabled).toBe(true)

    const fileInput = page.getByTestId('map-upload')
    const testImagePath = './e2e/fixtures/test-map.png'
    await fileInput.setInputFiles(testImagePath)

    await page.waitForTimeout(500)

    const isStillDisabled = await addBuildingBtn.isDisabled()
    await expect(isStillDisabled).toBe(false)
  })

  test('add building button shows no effect when clicked without map', async ({ page }) => {
    await page.goto('/situationsplan')

    const addBuildingBtn = page.getByTestId('add-building-btn')
    await addBuildingBtn.click()

    const buildingRect = page.getByTestId('building-rect')
    await expect(buildingRect).not.toBeVisible()
  })
})
