import { test, expect } from '@playwright/test'

test.describe('Situationsplan Screen - Scenario 3', () => {
  test('displays file upload before image is loaded', async ({ page }) => {
    await page.goto('/situationsplan')

    const fileInput = page.getByTestId('map-upload')
    await expect(fileInput).toBeVisible()
    
    await expect(fileInput).toHaveAttribute('type', 'file')
    await expect(fileInput).toHaveAttribute('accept', 'image/*')
  })

  test('file upload is initially visible and accessible', async ({ page }) => {
    await page.goto('/situationsplan')

    const fileInput = page.getByTestId('map-upload')
    const mapCanvas = page.getByTestId('map-canvas')
    
    await expect(fileInput).toBeVisible()
    await expect(mapCanvas).not.toBeVisible()
  })
})
