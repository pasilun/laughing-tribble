import { test, expect, type APIRequestContext } from '@playwright/test'
import { readFileSync } from 'fs'

// The site page and its API: what a person draws on the property is saved in local metres, in revisions, and
// Claude reads and adds to it with site_get and site_edit. The recorded property (Strängnäs Lövinge 3:2) is
// imported under a fresh name per test, so nothing here needs the network.

const FIXTURE = JSON.parse(readFileSync('e2e/fixtures/site/lovinge-doc.json', 'utf8'))

async function makeSite(request: APIRequestContext) {
  const designation = `Testtomt ${Date.now()}${Math.floor(Math.random() * 1000)}`
  const res = await request.post('/api/sites', { data: { import: { ...FIXTURE, designation } } })
  expect(res.status(), await res.text()).toBe(201)
  const b = await res.json()
  return { slug: b.doc.slug as string, designation }
}

async function mcp(request: APIRequestContext, name: string, args: Record<string, unknown>) {
  const res = await request.post('/api/mcp', { data: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } } })
  expect(res.status()).toBe(200)
  return (await res.json()).result as { content: Array<{ type: string; text?: string; data?: string }>; isError?: boolean }
}
const text = (r: { content: Array<{ text?: string }> }) => r.content.map((c) => c.text ?? '').join('\n')

test('API: a site is saved in revisions, a stale save is refused, bad items are explained, sheets export', async ({ request }) => {
  const { slug } = await makeSite(request)
  const got = await (await request.get(`/api/sites/${slug}`)).json()
  expect(got.revision.n).toBe(1)
  expect(got.doc.items.map((i: { id: string }) => i.id)).toEqual(['ang', 'gras'])

  const items = [...got.doc.items, { id: 'i3', type: 'point', name: 'Brunn', kind: 'annat', status: 'idé', color: '#1b6fd1', points: [{ x: 40, y: 60 }] }]
  const saved = await request.put(`/api/sites/${slug}`, { data: { items, baseRevision: 1 } })
  expect(saved.status()).toBe(200)
  expect((await saved.json()).revision.n).toBe(2)

  const stale = await request.put(`/api/sites/${slug}`, { data: { items, baseRevision: 1 } })
  expect(stale.status()).toBe(409)
  expect((await stale.json()).head).toBe(2)

  const bad = await request.put(`/api/sites/${slug}`, { data: { items: [{ id: 'x', type: 'area', name: 'För få', points: [{ x: 1, y: 1 }] }], baseRevision: 2 } })
  expect(bad.status()).toBe(422)
  expect((await bad.json()).errors[0]).toContain('minst 3 punkter')

  // Earlier revisions stay readable.
  expect((await (await request.get(`/api/sites/${slug}?rev=1`)).json()).doc.items).toHaveLength(2)

  const svg = await (await request.get(`/api/sites/${slug}/sheet?format=svg`)).text()
  for (const s of ['A1 Äng', 'A2 Gräsmatta', 'P1 Brunn', '1:500 (A3)']) expect(svg).toContain(s)
  const png = await request.get(`/api/sites/${slug}/sheet?format=png`)
  expect((await png.body()).subarray(1, 4).toString()).toBe('PNG')
  const pdf = await request.get(`/api/sites/${slug}/sheet?format=pdf`)
  expect((await pdf.body()).subarray(0, 4).toString()).toBe('%PDF')

  expect((await request.delete(`/api/sites/${slug}`)).status()).toBe(200)
  expect((await request.get(`/api/sites/${slug}`)).status()).toBe(404)
})

test('Claude: site_get reads what is drawn in local metres, site_edit adds a rectangle and refuses a stale revision', async ({ request }) => {
  const { slug } = await makeSite(request)
  const listed = await mcp(request, 'site_list', {})
  expect(text(listed)).toContain(slug)

  const got = await mcp(request, 'site_get', { slug })
  const t = text(got)
  expect(t).toContain('Revision 1')
  expect(t).toContain('lokala koordinater'.replace('l', 'L')) // "Lokala koordinater"
  expect(t).toContain('B1 bostadshus')
  expect(t).toMatch(/A1 \[ang\] Äng \(äng, befintlig/)
  expect(t).toMatch(/yta ca 15\d\d m²/)
  expect(got.content.at(-1)!.type).toBe('image')

  const edited = await mcp(request, 'site_edit', {
    slug,
    base_revision: 1,
    message: 'Växthus',
    ops: [{ op: 'add', item: { type: 'area', name: 'Växthus', kind: 'byggnad', status: 'idé', rect: { x: 30, y: 112, w: 6, d: 4 } } }],
  })
  expect(edited.isError, text(edited)).toBeFalsy()
  expect(text(edited)).toContain('Sparad som revision 2')
  expect(text(edited)).toMatch(/Växthus \(byggnad, idé\): yta ca 24 m²/)

  // The same revision again: refused, told to read again.
  const stale = await mcp(request, 'site_edit', { slug, base_revision: 1, ops: [{ op: 'delete', id: 'ang' }] })
  expect(stale.isError).toBe(true)
  expect(text(stale)).toContain('site_get')
  // Bad ops are explained and nothing is saved.
  const bad = await mcp(request, 'site_edit', { slug, base_revision: 2, ops: [{ op: 'update', id: 'finns-inte', patch: { name: 'x' } }] })
  expect(bad.isError).toBe(true)
  expect(text(bad)).toContain('finns inte')
  const rev = await (await request.get(`/api/sites/${slug}`)).json()
  expect(rev.revision.n).toBe(2)
  await request.delete(`/api/sites/${slug}`)
})

test('the page: draw an area by clicking, a point, a line freehand; name it; save; it is there after a reload', async ({ page, request }) => {
  const { slug } = await makeSite(request)
  await page.goto(`/plans/site/${slug}`)
  const svg = page.getByTestId('site-svg')
  await expect(svg).toBeVisible()
  await expect(page.getByTestId('item-list')).toContainText('A1 Äng')
  const box = (await svg.boundingBox())!
  const at = (fx: number, fy: number) => ({ x: box.x + box.width * fx, y: box.y + box.height * fy })

  // An area: four clicks, Enter.
  await page.getByTestId('tool-area').click()
  for (const [fx, fy] of [[0.15, 0.15], [0.3, 0.15], [0.3, 0.25], [0.15, 0.25]]) await page.mouse.click(at(fx, fy).x, at(fx, fy).y)
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('item-name')).toBeVisible()
  await page.getByTestId('item-name').fill('Växthus')
  await page.getByTestId('item-kind').selectOption('byggnad')
  await page.getByTestId('item-status').selectOption('planerad')
  await expect(page.getByTestId('item-size')).toContainText('Yta ca')
  await expect(page.getByTestId('vertex')).toHaveCount(4)

  // A point.
  await page.getByTestId('tool-point').click()
  await page.mouse.click(at(0.7, 0.3).x, at(0.7, 0.3).y)
  await page.getByTestId('item-name').fill('Brunn')

  // A line, freehand.
  await page.getByTestId('tool-free-line').click()
  await page.mouse.move(at(0.4, 0.6).x, at(0.4, 0.6).y)
  await page.mouse.down()
  for (let i = 1; i <= 10; i++) await page.mouse.move(at(0.4 + i * 0.03, 0.6 + Math.sin(i / 2) * 0.03).x, at(0.4 + i * 0.03, 0.6 + Math.sin(i / 2) * 0.03).y)
  await page.mouse.up()
  await page.getByTestId('item-name').fill('Stig')
  await expect(page.getByTestId('item-size')).toContainText('Längd ca')

  // Undo takes the line away again, the save button knows there is something to save.
  await page.getByTestId('undo').click()
  await page.getByTestId('save-site').click()
  await expect(page.getByTestId('site-status')).toContainText('Sparad')

  await page.reload()
  await expect(page.getByTestId('item-list')).toContainText('Växthus')
  await expect(page.getByTestId('item-list')).toContainText('Brunn')
  await expect(page.getByTestId('item-list')).not.toContainText('Stig')

  // What the page saved is what Claude reads, in metres.
  const read = text(await mcp(request, 'site_get', { slug, image: false }))
  expect(read).toMatch(/Växthus \(byggnad, planerad/)
  expect(read).toMatch(/Brunn \(annat, idé/)
  await request.delete(`/api/sites/${slug}`)
})

test('the page: a change made by Claude after the page was opened is a conflict, not an overwrite', async ({ page, request }) => {
  const { slug } = await makeSite(request)
  await page.goto(`/plans/site/${slug}`)
  await expect(page.getByTestId('item-list')).toContainText('A1 Äng')
  await mcp(request, 'site_edit', { slug, base_revision: 1, ops: [{ op: 'add', item: { type: 'point', name: 'Från Claude', points: [{ x: 10, y: 10 }] } }] })
  // The person draws something and saves from the old revision.
  await page.getByTestId('tool-point').click()
  const box = (await page.getByTestId('site-svg').boundingBox())!
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5)
  await page.getByTestId('save-site').click()
  await expect(page.getByTestId('site-conflict')).toBeVisible()
  await page.getByRole('button', { name: 'Läs om' }).click()
  await expect(page.getByTestId('item-list')).toContainText('Från Claude')
  await request.delete(`/api/sites/${slug}`)
})

test('the list page offers the properties the repository knows, so the first site is one click', async ({ page, request }) => {
  const list = await (await request.get('/api/sites')).json()
  expect(list.suggestions).toContain('Strängnäs Lövinge 3:2')
  await page.goto('/plans/site')
  await expect(page.getByTestId('suggested-site').first()).toContainText('Strängnäs Lövinge 3:2')
})
