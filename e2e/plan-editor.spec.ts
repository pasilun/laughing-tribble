import { test, expect, type Page } from '@playwright/test'
import path from 'path'

// The editor is desktop-only (mouse + keyboard).
test.use({ viewport: { width: 1400, height: 900 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 })

// Screen position of a plan point (mm), from the canvas transform.
async function screen(page: Page, x: number, y: number) {
  return page.evaluate(
    ([x, y]) => {
      const svg = document.querySelector('[data-testid="plan-canvas"]') as SVGSVGElement
      const g = svg.querySelector('g[transform]') as SVGGElement
      const m = /translate\(([-\d.e]+) ([-\d.e]+)\) scale\(([-\d.e]+)\)/.exec(g.getAttribute('transform')!)!
      const r = svg.getBoundingClientRect()
      return { x: r.left + Number(m[1]) + x * Number(m[3]), y: r.top + Number(m[2]) + y * Number(m[3]) }
    },
    [x, y],
  )
}

async function clickAt(page: Page, x: number, y: number) {
  const p = await screen(page, x, y)
  await page.mouse.click(p.x, p.y)
}

test('trace a scanned drawing: TIF underlay, calibrate, draw, undo, save, sheet', async ({ page, request }) => {
  const created = await (await request.post('/api/plans', { data: { name: 'Editor-test' } })).json()
  const id = created.plan.id as string
  await page.goto(`/plans/${id}`)
  await expect(page.getByTestId('plan-name')).toHaveText('Editor-test')
  await expect(page.getByTestId('mobile-notice')).toBeHidden()

  // TIF underlay is converted in the browser and uploaded.
  await page.getByTestId('tab-underlay').click()
  await page.getByTestId('underlay-file').setInputFiles(path.join(__dirname, 'fixtures/test-scan.tif'))
  await expect(page.getByTestId('underlay')).toBeVisible()
  await expect(page.getByTestId('tool-calibrate')).toHaveClass(/bg-blue-600/)

  // Calibrate on the 250 px scale bar = 5 m → 20 mm per pixel.
  const guess = 8.467
  await clickAt(page, 25 * guess, 175 * guess)
  await clickAt(page, 275 * guess, 175 * guess)
  await page.getByTestId('calibrate-mm').fill('5000')
  await page.getByTestId('calibrate-mm').press('Enter')
  await expect(page.getByTestId('underlay-scale')).toContainText('20.000 mm per pixel')

  // Draw a wall from the room's corner with a typed length.
  await page.keyboard.press('w')
  await clickAt(page, 1000, 520)
  const toward = await screen(page, 4000, 522)
  await page.mouse.move(toward.x, toward.y)
  await page.keyboard.type('4000')
  await expect(page.getByTestId('draw-length')).toContainText('4000 mm')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Escape')

  // Door in the middle of the wall, then undo/redo it.
  await page.keyboard.press('o')
  await clickAt(page, 3000, 520)
  await expect(page.locator('[data-hit="opening"]')).toHaveCount(1)
  await page.keyboard.press('Control+z')
  await expect(page.locator('[data-hit="opening"]')).toHaveCount(0)
  await page.keyboard.press('Control+Shift+z')
  await expect(page.locator('[data-hit="opening"]')).toHaveCount(1)

  // Title block field via the sheet panel (nothing selected).
  await page.keyboard.press('v')
  await page.keyboard.press('Escape')
  await page.getByTestId('tab-props').click()
  await page.getByTestId('tb-input-property').fill('Stockholm Testet 1')

  await page.getByTestId('save').click()
  await expect(page.getByTestId('save-state')).toContainText('rev 2 · sparad')

  const saved = await (await request.get(`/api/plans/${id}`)).json()
  expect(saved.plan.walls).toHaveLength(1)
  const w = saved.plan.walls[0]
  expect(Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y)).toBe(4000)
  expect(w.a.y).toBe(w.b.y) // snapped horizontal
  expect(saved.plan.openings).toHaveLength(1)
  expect(saved.plan.underlay.mmPerPx).toBeCloseTo(20, 3)
  expect(saved.plan.sheet.titleBlock.property).toBe('Stockholm Testet 1')

  await page.getByTestId('mode-sheet').click()
  await expect(page.getByTestId('sheet-preview')).toContainText('Planritning efter')
  await expect(page.getByTestId('sheet-preview')).toContainText('Stockholm Testet 1')
})

test('select a wall, change its length and phase', async ({ page, request }) => {
  const created = await (await request.post('/api/plans', { data: { name: 'Editor-demo', template: 'demo' } })).json()
  const id = created.plan.id as string
  await page.goto(`/plans/${id}`)
  await page.getByTestId('wall-a-hall').click()
  await expect(page.getByTestId('inspector-wall')).toBeVisible()
  await page.getByTestId('wall-length').fill('3000')
  await page.getByTestId('wall-phase').selectOption('demolish')
  await page.getByTestId('save').click()
  await expect(page.getByTestId('save-state')).toContainText('sparad')
  const saved = await (await request.get(`/api/plans/${id}`)).json()
  const w = saved.plan.walls.find((x: { id: string }) => x.id === 'a-hall')
  expect(w.b).toEqual({ x: 3000, y: 3500 })
  expect(w.phase).toBe('demolish')
  // The wall joined at the old end followed.
  expect(saved.plan.walls.find((x: { id: string }) => x.id === 'a-kok').b).toEqual({ x: 3000, y: 3500 })
})

test.describe('phone', () => {
  test.use({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true })
  test('read-only sheet and plan list without horizontal overflow', async ({ page, request }) => {
    const created = await (await request.post('/api/plans', { data: { name: 'Mobil', template: 'demo' } })).json()
    await page.goto(`/plans/${created.plan.id}`)
    await expect(page.getByTestId('mobile-notice')).toBeVisible()
    await expect(page.getByTestId('mobile-notice').getByTestId('title-block')).toBeVisible()
    const overflow = () => page.evaluate(() => document.scrollingElement!.scrollWidth <= window.innerWidth + 1)
    expect(await overflow()).toBe(true)
    await page.goto('/plans')
    await expect(page.getByTestId('plan-list')).toContainText('Mobil')
    expect(await overflow()).toBe(true)
  })
})
