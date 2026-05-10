import { test, expect } from '@playwright/test'

test.describe('Situationsplan Screen - Scenario 6', () => {
  test('display distance labels in metres', async ({ page }) => {
    await page.goto('/situationsplan')

    const fileInput = page.getByTestId('map-upload')
    const testImagePath = './e2e/fixtures/test-map.png'
    await fileInput.setInputFiles(testImagePath)

    await page.getByTestId('add-building-btn').click()

    const distNorth = page.getByTestId('dist-north')
    const distSouth = page.getByTestId('dist-south')
    const distEast = page.getByTestId('dist-east')
    const distWest = page.getByTestId('dist-west')

    await expect(distNorth).toBeVisible()
    await expect(distSouth).toBeVisible()
    await expect(distEast).toBeVisible()
    await expect(distWest).toBeVisible()

    const northText = await distNorth.textContent()
    const southText = await distSouth.textContent()
    const eastText = await distEast.textContent()
    const westText = await distWest.textContent()

    const northValue = parseFloat(northText?.replace(' m', '') || '')
    const southValue = parseFloat(southText?.replace(' m', '') || '')
    const eastValue = parseFloat(eastText?.replace(' m', '') || '')
    const westValue = parseFloat(westText?.replace(' m', '') || '')

    await expect(northValue).toBeGreaterThanOrEqual(0)
    await expect(southValue).toBeGreaterThanOrEqual(0)
    await expect(eastValue).toBeGreaterThanOrEqual(0)
    await expect(westValue).toBeGreaterThanOrEqual(0)
  })
})
