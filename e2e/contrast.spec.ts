import { test, expect, type Page, type APIRequestContext } from '@playwright/test'
import { readFileSync } from 'fs'

// Text must be readable on every page, whatever the visitor's colour scheme: contrast of every piece of text
// against the colour behind it (WCAG: 4.5:1, 3:1 for large text). The app is drawn on white panels, so a
// visitor with a dark system theme must not get light text on them.

type Bad = { text: string; tag: string; color: string; bg: string; ratio: number }

async function audit(page: Page): Promise<Bad[]> {
  return page.evaluate(() => {
    // Tailwind writes colours as oklch()/lab(): let the browser turn any CSS colour into rgba through a canvas.
    const cv = document.createElement('canvas')
    cv.width = cv.height = 1
    const g = cv.getContext('2d', { willReadFrequently: true })!
    const parse = (c: string) => {
      if (!c || c === 'transparent') return { r: 0, g: 0, b: 0, a: 0 }
      g.clearRect(0, 0, 1, 1)
      g.fillStyle = '#000'
      g.fillStyle = c
      g.fillRect(0, 0, 1, 1)
      const d = g.getImageData(0, 0, 1, 1).data
      return { r: d[0], g: d[1], b: d[2], a: d[3] / 255 }
    }
    const lum = (c: { r: number; g: number; b: number }) => {
      const f = (v: number) => {
        const s = v / 255
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
      }
      return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b)
    }
    // The colour behind an element: the first ancestor with a (nearly) opaque background, blended over what is under it.
    const behind = (el: Element): { r: number; g: number; b: number } => {
      const stack: Array<{ r: number; g: number; b: number; a: number }> = []
      for (let e: Element | null = el; e; e = e.parentElement) {
        const bg = parse(getComputedStyle(e).backgroundColor)
        if (bg && bg.a > 0) stack.push(bg)
        if (bg && bg.a >= 0.99) break
      }
      let base = { r: 255, g: 255, b: 255 }
      for (const l of stack.reverse()) base = { r: l.r * l.a + base.r * (1 - l.a), g: l.g * l.a + base.g * (1 - l.a), b: l.b * l.a + base.b * (1 - l.a) }
      return base
    }
    const out: Array<{ text: string; tag: string; color: string; bg: string; ratio: number }> = []
    const seen = new Set<Element>()
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement
      const t = (n.textContent ?? '').trim()
      if (!el || !t || seen.has(el) || el.closest('svg') || ['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(el.tagName)) continue
      const cs = getComputedStyle(el)
      const r = el.getBoundingClientRect()
      if (cs.visibility === 'hidden' || cs.display === 'none' || r.width < 1 || r.height < 1 || Number(cs.opacity) === 0) continue
      seen.add(el)
      const fg = parse(cs.color)
      if (!fg) continue
      const bg = behind(el)
      const a = fg.a
      const eff = { r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a) }
      const L1 = lum(eff)
      const L2 = lum(bg)
      const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05)
      const size = parseFloat(cs.fontSize)
      const large = size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 700)
      if (ratio < (large ? 3 : 4.5)) out.push({ text: t.slice(0, 40), tag: el.tagName.toLowerCase() + (el.getAttribute('data-testid') ? `[${el.getAttribute('data-testid')}]` : ''), color: cs.color, bg: `rgb(${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)})`, ratio: Math.round(ratio * 100) / 100 })
    }
    // Form fields: the text typed and the placeholder, against the field's own background.
    for (const el of Array.from(document.querySelectorAll('input, textarea, select'))) {
      const cs = getComputedStyle(el)
      const fg = parse(cs.color)
      const bg = behind(el)
      if (!fg) continue
      const ratio = (Math.max(lum(fg), lum(bg)) + 0.05) / (Math.min(lum(fg), lum(bg)) + 0.05)
      if (ratio < 4.5) out.push({ text: `(fält ${el.getAttribute('data-testid') ?? el.getAttribute('name') ?? el.tagName})`, tag: el.tagName.toLowerCase(), color: cs.color, bg: `rgb(${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)})`, ratio: Math.round(ratio * 100) / 100 })
    }
    return out
  })
}

async function fixtures(request: APIRequestContext) {
  const plan = (await (await request.post('/api/plans', { data: { name: 'Kontrast', template: 'demo' } })).json()).plan.id as string
  const site = JSON.parse(readFileSync('e2e/fixtures/site/lovinge-doc.json', 'utf8'))
  const made = await (await request.post('/api/sites', { data: { import: { ...site, designation: `Kontrasttomt ${Date.now()}` } } })).json()
  return { plan, slug: made.doc.slug as string }
}

for (const scheme of ['light', 'dark'] as const) {
  test(`text is readable on every page with a ${scheme} system theme`, async ({ browser, request }) => {
    test.setTimeout(120_000)
    const { plan, slug } = await fixtures(request)
    const ctx = await browser.newContext({ colorScheme: scheme, viewport: { width: 1280, height: 900 } })
    const page = await ctx.newPage()
    const pages: Array<[string, string]> = [
      ['plan list', '/plans'],
      ['plan editor', `/plans/${plan}`],
      ['upload', `/plans/${plan}/upload`],
      ['site list', '/plans/site'],
      ['site page', `/plans/site/${slug}`],
      ['login', '/plans/login'],
    ]
    const report: string[] = []
    for (const [name, url] of pages) {
      await page.goto(url)
      await page.waitForLoadState('networkidle')
      await page.waitForTimeout(400)
      const bad = await audit(page)
      for (const b of bad) report.push(`${name}: "${b.text}" <${b.tag}> ${b.color} on ${b.bg} = ${b.ratio}:1`)
    }
    // The editor's other modes and panels.
    await page.goto(`/plans/${plan}`)
    await page.getByTestId('mode-sheet').click().catch(() => undefined)
    await page.waitForTimeout(300)
    for (const b of await audit(page)) report.push(`plan editor (blad): "${b.text}" <${b.tag}> ${b.color} on ${b.bg} = ${b.ratio}:1`)
    // Other states: every tool's options, the side tabs, the export menu, a selected item on the site page.
    const states: Array<[string, () => Promise<void>]> = []
    for (const t of ['wall', 'opening', 'fixture', 'room', 'note', 'dimension', 'calibrate']) states.push([`tool ${t}`, async () => void (await page.getByTestId(`tool-${t}`).click({ timeout: 2000 }).catch(() => undefined))])
    for (const t of ['props', 'checks', 'revisions', 'underlay']) states.push([`tab ${t}`, async () => void (await page.getByTestId(`tab-${t}`).click({ timeout: 2000 }).catch(() => undefined))])
    states.push(['export menu', async () => void (await page.getByTestId('export-menu').click({ timeout: 2000 }).catch(() => undefined))])
    await page.goto(`/plans/${plan}`)
    await page.waitForLoadState('networkidle')
    for (const [name, go] of states) {
      await go()
      await page.waitForTimeout(150)
      for (const b of await audit(page)) report.push(`plan editor (${name}): "${b.text}" <${b.tag}> ${b.color} on ${b.bg} = ${b.ratio}:1`)
    }
    await page.goto(`/plans/site/${slug}`)
    await page.waitForLoadState('networkidle')
    await page.getByTestId('item-list').locator('button').first().click()
    for (const b of await audit(page)) report.push(`site page (valt objekt): "${b.text}" <${b.tag}> ${b.color} on ${b.bg} = ${b.ratio}:1`)
    await page.getByTestId('underlay-karta').click()
    await page.waitForTimeout(1500)
    for (const b of await audit(page)) report.push(`site page (karta): "${b.text}" <${b.tag}> ${b.color} on ${b.bg} = ${b.ratio}:1`)
    await ctx.close()
    await request.delete(`/api/plans/${plan}`)
    await request.delete(`/api/sites/${slug}`)
    expect(report, report.join('\n')).toEqual([])
  })
}
