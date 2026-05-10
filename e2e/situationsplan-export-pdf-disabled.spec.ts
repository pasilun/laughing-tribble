import { test, expect } from '@playwright/test'

test.describe('Situationsplan Screen - Scenario 11', () => {
  test('export PDF requires uploaded map and building', async ({ page }) => {
    await page.goto('/situationsplan')

    const exportBtn = page.getByTestId('export-pdf-btn')
    await expect(exportBtn).toBeVisible()
    
    const isDisabled = await exportBtn.isDisabled()
    await expect(isDisabled).toBe(true)

    const fileInput = page.getByTestId('map-upload')
    const testImagePath = './e2e/fixtures/test-map.png'
    await fileInput.setInputFiles(testImagePath)

    await page.waitForTimeout(500)

    const isStillDisabledAfterMap = await exportBtn.isDisabled()
    await expect(isStillDisabledAfterMap).toBe(true)

    await page.getByTestId('add-building-btn').click()

    await page.waitForTimeout(500)

    const isDisabledAfterBuilding = await exportBtn.isDisabled()
    await expect(isDisabledAfterBuilding).toBe(false)
  })

  test('export PDF shows no effect when clicked without map', async ({ page }) => {
    await page.goto('/situationsplan')

    const exportBtn = page.getByTestId('export-pdf-btn')
    
    let downloadTriggered = false
    page.on('download', () => {
      downloadTriggered = true
    })

    await exportBtn.click()
    await page.waitForTimeout(1000)

    await expect(downloadTriggered).toBe(false)
  })

  test('export PDF shows no effect when clicked without building', async ({ page }) => {
    await page.goto('/situationsplan')

    const fileInput = page.getByTestId('map-upload')
    const testImagePath = './e2e/fixtures/test-map.png'
    await fileInput.setInputFiles(testImagePath)

    await page.waitForTimeout(500)

    const exportBtn = page.getByTestId('export-pdf-btn')
    
    let downloadTriggered = false
    page.on('download', () => {
      downloadTriggered = true
    })

    await exportBtn.click()
    await page.waitForTimeout(1000)

    await expect(downloadTriggered).toBe(false)
  })
})
