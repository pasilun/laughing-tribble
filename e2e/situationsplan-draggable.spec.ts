import { test, expect } from '@playwright/test'

test.describe('Situationsplan Screen - Scenario 5', () => {
  test('building rectangle is draggable', async ({ page }) => {
    await page.goto('/situationsplan')

    const fileInput = page.getByTestId('map-upload')
    const testImagePath = './e2e/fixtures/test-map.png'
    await fileInput.setInputFiles(testImagePath)

    await page.getByTestId('add-building-btn').click()

    const buildingRect = page.getByTestId('building-rect')
    await expect(buildingRect).toBeVisible()

    const mapCanvas = page.getByTestId('map-canvas')
    const box = await buildingRect.boundingBox()
    
    expect(box).toBeTruthy()
    if (!box) throw new Error('Building rect not found')

    const startX = box.x + box.width / 2
    const startY = box.y + box.height / 2

    await mapCanvas.hover({ position: { x: startX, y: startY } })
    await page.mouse.down()
    await page.mouse.move(startX + 50, startY + 30)
    await page.mouse.up()

    const newBox = await buildingRect.boundingBox()
    expect(newBox).toBeTruthy()
    if (!newBox) throw new Error('Building rect not found after move')

    expect(Math.abs(newBox.x - box.x)).toBeGreaterThan(20)
    expect(Math.abs(newBox.y - box.y)).toBeGreaterThan(10)
  })
})
