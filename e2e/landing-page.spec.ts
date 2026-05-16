import { test, expect } from '@playwright/test'

test.describe('Landing Page - Clear Messaging', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
  })

  test('page loads with headline containing bygglov', async ({ page }) => {
    const headline = page.getByRole('heading', { level: 1 })
    await expect(headline).toBeVisible()
    const headlineText = await headline.textContent()
    expect(headlineText).toMatch(/bygglov|Bygglovsassistenten/)
  })

  test('page loads with subheading explaining app purpose', async ({ page }) => {
    const subheading = page.getByRole('paragraph')
    await expect(subheading).toBeVisible()
    const subheadingText = await subheading.textContent()
    expect(subheadingText?.length).toBeGreaterThanOrEqual(20)
    expect(subheadingText).toMatch(/friggebod|attefall|små byggnader/)
  })

  test('has exactly one primary CTA button', async ({ page }) => {
    const ctaButtons = page.getByRole('link', { name: 'Kom igång' })
    const count = await ctaButtons.count()
    expect(count).toBe(1)
  })

  test('primary CTA links to /design', async ({ page }) => {
    const cta = page.getByRole('link', { name: 'Kom igång' })
    await expect(cta).toBeVisible()
    const href = await cta.getAttribute('href')
    expect(href).toBe('/design')
  })
})

test.describe('Landing Page - Visual Hierarchy', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
  })

  test('headline is larger than subheading', async ({ page }) => {
    const headline = page.getByRole('heading', { level: 1 })
    const subheading = page.getByRole('paragraph')

    const headlineSize = await headline.evaluate(el => {
      return window.getComputedStyle(el).fontSize
    })
    const subheadingSize = await subheading.evaluate(el => {
      return window.getComputedStyle(el).fontSize
    })

    const headlineNum = parseFloat(headlineSize)
    const subheadingNum = parseFloat(subheadingSize)

    expect(headlineNum).toBeGreaterThanOrEqual(subheadingNum * 1.5)
  })

  test('primary CTA is positioned below the headline and subheading', async ({ page }) => {
    const headline = page.getByRole('heading', { level: 1 })
    const subheading = page.getByRole('paragraph')
    const cta = page.getByRole('link', { name: 'Kom igång' })

    await expect(headline).toBeVisible()
    await expect(subheading).toBeVisible()
    await expect(cta).toBeVisible()

    const headlineBox = await headline.boundingBox()
    const subheadingBox = await subheading.boundingBox()
    const ctaBox = await cta.boundingBox()

    expect(subheadingBox?.y).toBeGreaterThan(headlineBox?.y ?? 0)
    expect(ctaBox?.y).toBeGreaterThan(subheadingBox?.y ?? 0)
  })

  test('has at least 20px vertical space between subheading and CTA', async ({ page }) => {
    const subheading = page.getByRole('paragraph')
    const cta = page.getByRole('link', { name: 'Kom igång' })

    const subheadingBox = await subheading.boundingBox()
    const ctaBox = await cta.boundingBox()

    const verticalGap = (ctaBox?.y ?? 0) - ((subheadingBox?.y ?? 0) + (subheadingBox?.height ?? 0))
    expect(verticalGap).toBeGreaterThanOrEqual(20)
  })

  test('primary CTA has distinct background color', async ({ page }) => {
    const cta = page.getByRole('link', { name: 'Kom igång' })
    const ctaColor = await cta.evaluate(el => {
      return window.getComputedStyle(el).backgroundColor
    })
    const mainColor = await page.evaluate(() => {
      return window.getComputedStyle(document.body).backgroundColor
    })

    expect(ctaColor).not.toBe(mainColor)
  })

  test('page has light background color', async ({ page }) => {
    const bgColor = await page.evaluate(() => {
      return window.getComputedStyle(document.body).backgroundColor
    })

    const rgbMatch = bgColor.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/)
    if (rgbMatch) {
      const [, r, g, b] = rgbMatch.map(Number)
      const brightness = (r * 299 + g * 587 + b * 114) / 1000
      expect(brightness).toBeGreaterThanOrEqual(200)
    }
  })
})

test.describe('Landing Page - Responsive Layout', () => {
  test('mobile viewport (375px) - all elements visible without horizontal scroll', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await page.goto('/')

    const headline = page.getByRole('heading', { level: 1 })
    const subheading = page.getByRole('paragraph')
    const cta = page.getByRole('link', { name: 'Kom igång' })

    await expect(headline).toBeVisible()
    await expect(subheading).toBeVisible()
    await expect(cta).toBeVisible()

    const bodyWidth = await page.evaluate(() => document.body.scrollWidth)
    expect(bodyWidth).toBe(375)
  })

  test('mobile viewport - CTA is fully visible and tappable', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await page.goto('/')

    const cta = page.getByRole('link', { name: 'Kom igång' })
    await expect(cta).toBeVisible()

    const box = await cta.boundingBox()
    expect(box?.width).toBeGreaterThanOrEqual(44)
    expect(box?.height).toBeGreaterThanOrEqual(44)
  })

  test('mobile viewport - no overlapping elements', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await page.goto('/')

    const headline = page.getByRole('heading', { level: 1 })
    const subheading = page.getByRole('paragraph')
    const cta = page.getByRole('link', { name: 'Kom igång' })

    const headlineBox = await headline.boundingBox()
    const subheadingBox = await subheading.boundingBox()
    const ctaBox = await cta.boundingBox()

    const elementsAreSeparate = [
      headlineBox,
      subheadingBox,
      ctaBox
    ].every((box, i, boxes) => {
      if (!box) return false
      return boxes.every((otherBox, j) => {
        if (!otherBox || i === j) return true
        return (
          box.y + box.height <= otherBox.y ||
          otherBox.y + otherBox.height <= box.y
        )
      })
    })

    expect(elementsAreSeparate).toBe(true)
  })

  test('desktop viewport (1920px) - content is centered with equal margins', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 })
    await page.goto('/')

    const main = page.locator('main')
    const mainBox = await main.boundingBox()
    const bodyWidth = await page.evaluate(() => document.body.clientWidth)

    if (mainBox) {
      const leftMargin = mainBox.x
      const rightMargin = bodyWidth - (mainBox.x + mainBox.width)

      expect(leftMargin).toBeGreaterThanOrEqual(100)
      expect(rightMargin).toBeGreaterThanOrEqual(100)
      expect(Math.abs(leftMargin - rightMargin)).toBeLessThan(1)
    }
  })

  test('desktop viewport - maximum content width is within limits', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 })
    await page.goto('/')

    const main = page.locator('main')
    const mainBox = await main.boundingBox()

    expect(mainBox?.width).toBeLessThanOrEqual(1200)
  })
})

test.describe('Landing Page - Typography', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
  })

  test('all visible text uses sans-serif font family', async ({ page }) => {
    const headline = page.getByRole('heading', { level: 1 })
    const subheading = page.getByRole('paragraph')
    const cta = page.getByRole('link', { name: 'Kom igång' })

    const headlineFont = await headline.evaluate(el => window.getComputedStyle(el).fontFamily)
    const subheadingFont = await subheading.evaluate(el => window.getComputedStyle(el).fontFamily)
    const ctaFont = await cta.evaluate(el => window.getComputedStyle(el).fontFamily)

    expect(headlineFont).toMatch(/sans-serif/i)
    expect(subheadingFont).toMatch(/sans-serif/i)
    expect(ctaFont).toMatch(/sans-serif/i)
  })

  test('headline uses bold or semibold font weight', async ({ page }) => {
    const headline = page.getByRole('heading', { level: 1 })
    const fontWeight = await headline.evaluate(el => {
      const weight = window.getComputedStyle(el).fontWeight
      return weight === 'bold' || weight === '600' || weight === '700' || parseInt(weight) >= 600
    })

    expect(fontWeight).toBe(true)
  })

  test('subheading and button use same font weight', async ({ page }) => {
    const subheading = page.getByRole('paragraph')
    const cta = page.getByRole('link', { name: 'Kom igång' })

    const subheadingWeight = await subheading.evaluate(el => {
      return parseInt(window.getComputedStyle(el).fontWeight)
    })
    const ctaWeight = await cta.evaluate(el => {
      return parseInt(window.getComputedStyle(el).fontWeight)
    })

    expect(subheadingWeight).toBe(ctaWeight)
  })
})

test.describe('Landing Page - No Confusing Test Features', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
  })

  test('no visible text input field for name', async ({ page }) => {
    const nameInput = page.getByLabel('Ditt namn')
    await expect(nameInput).not.toBeVisible()
  })

  test('no button labeled Byt färg', async ({ page }) => {
    const colorButton = page.getByRole('button', { name: /byt färg/i })
    await expect(colorButton).not.toBeVisible()
  })

  test('no greeting text that changes based on user input', async ({ page }) => {
    const pageText = await page.textContent('body')
    expect(pageText).not.toMatch(/Välkommen,\s*\w+/)
  })
})

test.describe('Landing Page - Navigation', () => {
  test('clicking CTA navigates to design page', async ({ page }) => {
    await page.goto('/')

    const cta = page.getByRole('link', { name: 'Kom igång' })
    await cta.click()

    await expect(page).toHaveURL('/design')
  })

  test('direct navigation to /design page works', async ({ request }) => {
    const response = await request.get('/design')
    expect(response.status()).toBe(200)
  })
})