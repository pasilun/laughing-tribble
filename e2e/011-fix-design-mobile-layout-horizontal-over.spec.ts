import { test, expect } from '@playwright/test'

test.describe('Design Mobile Layout - Horizontal Overflow + Safe Area', () => {
  test.describe('Scenario 1: No horizontal overflow before sending message', () => {
    test('at iPhone viewport width - all elements fit without horizontal scroll', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 })
      await page.goto('/design')

      const scrollWidth = await page.evaluate(() => document.scrollingElement?.scrollWidth || 0)
      const innerWidth = await page.evaluate(() => window.innerWidth)
      expect(scrollWidth).toBeLessThanOrEqual(innerWidth + 1)

      const header = page.getByRole('heading', { name: 'Design' })
      await expect(header).toBeVisible()
      const headerBox = await header.boundingBox()
      expect(headerBox?.x).toBeGreaterThanOrEqual(0)
      expect(headerBox && headerBox.x + headerBox.width).toBeLessThanOrEqual(innerWidth)

      const modelState = page.getByTestId('model-state')
      await expect(modelState).toBeVisible()
      const modelStateBox = await modelState.boundingBox()
      expect(modelStateBox?.x).toBeGreaterThanOrEqual(0)
      expect(modelStateBox && modelStateBox.x + modelStateBox.width).toBeLessThanOrEqual(innerWidth)

      const floorPlanCard = page.getByText(/Floor Plan/i)
      await expect(floorPlanCard).toBeVisible()
      const floorPlanBox = await floorPlanCard.boundingBox()
      expect(floorPlanBox?.x).toBeGreaterThanOrEqual(0)
      expect(floorPlanBox && floorPlanBox.x + floorPlanBox.width).toBeLessThanOrEqual(innerWidth)
    })
  })

  test.describe('Scenario 2: No horizontal overflow after sending seam fixture', () => {
    test('at iPhone viewport width - SVG fits without horizontal scroll', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 })
      await page.goto('/design')

      const chatInput = page.getByTestId('chat-input')
      const sendButton = page.getByTestId('send-button')

      const fixturePrompt = 'Jag vill bygga en komplementbyggnad, 4.5 meter lång och 4.5 meter bred'
      await chatInput.fill(fixturePrompt)
      await sendButton.click()

      await page.waitForTimeout(15000)

      const scrollWidth = await page.evaluate(() => document.scrollingElement?.scrollWidth || 0)
      const innerWidth = await page.evaluate(() => window.innerWidth)
      expect(scrollWidth).toBeLessThanOrEqual(innerWidth + 1)

      const header = page.getByRole('heading', { name: 'Design' })
      const headerBox = await header.boundingBox()
      expect(headerBox?.x).toBeGreaterThanOrEqual(0)
      expect(headerBox && headerBox.x + headerBox.width).toBeLessThanOrEqual(innerWidth)

      const modelState = page.getByTestId('model-state')
      const modelStateBox = await modelState.boundingBox()
      expect(modelStateBox?.x).toBeGreaterThanOrEqual(0)
      expect(modelStateBox && modelStateBox.x + modelStateBox.width).toBeLessThanOrEqual(innerWidth)

      const floorPlanSvg = page.getByTestId('floor-plan-svg')
      await expect(floorPlanSvg).toBeVisible()
      const svgBox = await floorPlanSvg.boundingBox()
      expect(svgBox?.x).toBeGreaterThanOrEqual(0)
      expect(svgBox && svgBox.x + svgBox.width).toBeLessThanOrEqual(innerWidth)

      const floorPlanCard = page.getByText(/Floor Plan/i)
      const floorPlanBox = await floorPlanCard.boundingBox()
      expect(floorPlanBox?.x).toBeGreaterThanOrEqual(0)
      expect(floorPlanBox && floorPlanBox.x + floorPlanBox.width).toBeLessThanOrEqual(innerWidth)
    })
  })

  test.describe('Scenario 3: Header respects mobile safe-area', () => {
    test('viewport meta tag includes viewport-fit=cover', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 })
      await page.goto('/design')

      const viewportMeta = page.locator('meta[name="viewport"]')
      const viewportContent = await viewportMeta.getAttribute('content')
      expect(viewportContent).toContain('viewport-fit=cover')
    })

    test('header has CSS safe-area-inset-top padding', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 })
      await page.goto('/design')

      const headerBox = await page.evaluate(() => {
        const header = document.querySelector('header')
        if (!header) return null
        const computedStyle = window.getComputedStyle(header)
        return {
          paddingTop: computedStyle.paddingTop
        }
      })

      expect(headerBox).not.toBeNull()
      expect(headerBox?.paddingTop).toContain('env(safe-area-inset-top)')
    })

    test('header text is visible and positioned correctly', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 })
      await page.goto('/design')

      const header = page.getByRole('heading', { name: 'Design' })
      await expect(header).toBeVisible()

      const headerBox = await header.boundingBox()
      expect(headerBox?.x).toBeGreaterThanOrEqual(0)
      expect(headerBox && headerBox.x + headerBox.width).toBeLessThanOrEqual(375)
    })
  })

  test.describe('Scenario 4: No regression in existing active specs', () => {
    test('design-screen spec still passes', async ({ page }) => {
      await page.goto('/design')
      await expect(page.getByRole('heading', { name: 'Design' })).toBeVisible()
      await expect(page.getByText(/beskriv ditt projekt/i)).toBeVisible()
      await expect(page.getByPlaceholder('Beskriv vad du vill bygga...')).toBeVisible()
      await expect(page.getByRole('button', { name: 'Skicka' })).toBeVisible()
    })

    test('floor-plan SVG spec still passes', async ({ page }) => {
      await page.goto('/design')
      const chatInput = page.getByTestId('chat-input')
      const sendButton = page.getByTestId('send-button')

      const message = 'Jag vill bygga en komplementbyggnad, 4.5 meter lång och 4.5 meter bred'
      await chatInput.fill(message)
      await sendButton.click()

      await expect(page.getByTestId('floor-plan-svg')).toBeVisible({ timeout: 15000 })

      const floorPlanSvg = page.getByTestId('floor-plan-svg')
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

    test('footer spec still passes', async ({ page }) => {
      await page.goto('/design')
      const footer = page.locator('footer')
      await expect(footer).toBeVisible()
    })

    test('deterministic-chat-seam spec still passes', async ({ page }) => {
      await page.goto('/design')
      const chatInput = page.getByTestId('chat-input')
      const sendButton = page.getByTestId('send-button')

      const fixturePrompt = 'Jag vill bygga en komplementbyggnad, 4.5 meter lång och 4.5 meter bred'
      await chatInput.fill(fixturePrompt)
      await sendButton.click()

      await expect(page.getByText(fixturePrompt)).toBeVisible()
      await expect(page.getByTestId('chat-input')).toHaveValue('')

      const assistantMessage = page.getByTestId('assistant-message').first()
      await expect(assistantMessage).toBeVisible({ timeout: 30_000 })

      const messageText = await assistantMessage.textContent()
      expect(messageText?.trim().length).toBeGreaterThan(0)
      expect(messageText).not.toContain('error')
      expect(messageText).not.toContain('fel uppstod')
      expect(messageText).not.toContain('undefined')
    })
  })
})
