import { test, expect } from '@playwright/test'

test.describe('Situationsplan Screen - Scenario 8', () => {
  test('export annotated map as PDF', async ({ page }) => {
    await page.goto('/situationsplan')

    const fileInput = page.getByTestId('map-upload')
    const testImagePath = './e2e/fixtures/test-map.png'
    await fileInput.setInputFiles(testImagePath)

    await page.getByTestId('add-building-btn').click()

    const exportBtn = page.getByTestId('export-pdf-btn')
    await expect(exportBtn).toBeVisible()

    const downloadPromise = page.waitForEvent('download')
    await exportBtn.click()
    
    const download = await downloadPromise
    expect(download.suggestedFilename()).toBe('situationsplan.pdf')
  })
})
