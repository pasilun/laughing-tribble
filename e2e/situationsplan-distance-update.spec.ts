import { test, expect } from '@playwright/test'

test.describe('Situationsplan Screen - Scenario 7', () => {
  test('distance labels update on rectangle movement', async ({ page }) => {
    await page.goto('/situationsplan')

    const fileInput = page.getByTestId('map-upload')
    const testImagePath = './e2e/fixtures/test-map.png'
    await fileInput.setInputFiles(testImagePath)

    await page.getByTestId('add-building-btn').click()

    const distNorth = page.getByTestId('dist-north')
    const distSouth = page.getByTestId('dist-south')
    const distEast = page.getByTestId('dist-east')
    const distWest = page.getByTestId('dist-west')

    const initialNorthText = await distNorth.textContent()
    const initialSouthText = await distSouth.textContent()
    const initialEastText = await distEast.textContent()
    const initialWestText = await distWest.textContent()

    const buildingRect = page.getByTestId('building-rect')
    const mapCanvas = page.getByTestId('map-canvas')
    const box = await buildingRect.boundingBox()
    
    expect(box).toBeTruthy()
    if (!box) throw new Error('Building rect not found')

    const startX = box.x + box.width / 2
    const startY = box.y + box.height / 2

    await mapCanvas.hover({ position: { x: startX, y: startY } })
    await page.mouse.down()
    await page.mouse.move(startX + 30, startY + 20)
    await page.mouse.up()

    const newNorthText = await distNorth.textContent()
    const newSouthText = await distSouth.textContent()
    const newEastText = await distEast.textContent()
    const newWestText = await distWest.textContent()

    expect(newNorthText).not.toBe(initialNorthText)
    expect(newSouthText).not.toBe(initialSouthText)
    expect(newEastText).not.toBe(initialEastText)
    expect(newWestText).not.toBe(initialWestText)

    const northValue = parseFloat(newNorthText?.replace(' m', '') || '')
    const southValue = parseFloat(newSouthText?.replace(' m', '') || '')
    const eastValue = parseFloat(newEastText?.replace(' m', '') || '')
    const westValue = parseFloat(newWestText?.replace(' m', '') || '')

    await expect(northValue).toBeGreaterThanOrEqual(0)
    await expect(southValue).toBeGreaterThanOrEqual(0)
    await expect(eastValue).toBeGreaterThanOrEqual(0)
    await expect(westValue).toBeGreaterThanOrEqual(0)
  })
})
