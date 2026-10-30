import { test, expect, type APIRequestContext } from '@playwright/test'
import { readFileSync } from 'fs'
import { findDimensionEnds } from '@/lib/plan/scan/dimension'
import { findWindowBands } from '@/lib/plan/scan/openings'
import type { Gray, Raster } from '@/lib/plan/scan/raster'
import type { Plan, Wall } from '@/lib/plan/types'
import sharp from 'sharp'

// The cellar drawing (a 1936-style 1:100 sheet, hand drawn, stretched ~1.3 % more along one
// axis) as a golden case for the accuracy tools: the printed dimensions are the truth.
// Printed: 6,08 m wide × 10,50 m long, outside faces.

const IMG = 'e2e/fixtures/cellar/kallare.png'
const NOMINAL = (25.4 / 300) * 100 // 1:100 at 300 dpi
// Rough end points of the two printed dimension lines, read off the picture (px).
const LEN_PX = { a: { x: 693, y: 268 }, b: { x: 693, y: 1931 } }
const WID_PX = { a: { x: 774, y: 2122 }, b: { x: 1726, y: 2122 } }
const mm = (p: { x: number; y: number }) => ({ x: p.x * NOMINAL, y: p.y * NOMINAL })

async function call(request: APIRequestContext, name: string, args: Record<string, unknown>) {
  const res = await request.post('/api/mcp', { data: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } } })
  expect(res.status()).toBe(200)
  return (await res.json()).result as { content: Array<{ type: string; text?: string }>; isError?: boolean }
}
const text = (r: { content: Array<{ text?: string }> }) => r.content.map((c) => c.text ?? '').join('\n')

test('the end strokes of the printed dimensions are found, and they show the scan is stretched', async () => {
  const { data, info } = await sharp(IMG).grayscale().raw().toBuffer({ resolveWithObject: true })
  const g: Gray = { data: new Uint8Array(data), w: info.width, h: info.height }
  const r: Raster = { id: 'k', mmPerPx: NOMINAL, x: 0, y: 0, widthPx: g.w, heightPx: g.h, src: '', rotation: 0 }
  const len = findDimensionEnds(g, r, mm(LEN_PX.a), mm(LEN_PX.b))
  const wid = findDimensionEnds(g, r, mm(WID_PX.a), mm(WID_PX.b))
  for (const e of [len.a, len.b, wid.a, wid.b]) expect(e.found).toBe(true)
  const ky = 10500 / (Math.hypot(len.b.point.x - len.a.point.x, len.b.point.y - len.a.point.y) / NOMINAL) // mm per px
  const kx = 6080 / (Math.hypot(wid.b.point.x - wid.a.point.x, wid.b.point.y - wid.a.point.y) / NOMINAL)
  // The two axes disagree by 1–2 %: that is the scan, not the reading (±0.3 % at most).
  expect(ky).toBeGreaterThan(6.28)
  expect(ky).toBeLessThan(6.37)
  expect(kx).toBeGreaterThan(6.37)
  expect(kx).toBeLessThan(6.45)
  expect((kx - ky) / ky).toBeGreaterThan(0.007)
})

test('plan_scan_dimension calibrates from the printed dimensions and straightens the stretched scan', async ({ request }) => {
  const created = await call(request, 'plan_create', { name: 'Källare-golden' })
  const id = /Skapad: ([a-z0-9-]+)/.exec(text(created))![1]
  const added = await call(request, 'plan_source_add', { plan_id: id, base_revision: 1, id: 'kallare', role: 'archive', filename: 'kallare.png', data_base64: readFileSync(IMG).toString('base64'), scale: 100, dpi: 300 })
  expect(added.isError, text(added)).toBeFalsy()
  const dims = [
    { label: 'längd', a: mm(LEN_PX.a), b: mm(LEN_PX.b), mm: 10500 },
    { label: 'bredd', a: mm(WID_PX.a), b: mm(WID_PX.b), mm: 6080 },
  ]
  // A preview changes nothing and reports the difference between the axes.
  const prev = await call(request, 'plan_scan_dimension', { plan_id: id, source_id: 'kallare', dimensions: dims })
  expect(prev.isError, text(prev)).toBeFalsy()
  expect(text(prev)).toContain('Skala per axel')
  const done = await call(request, 'plan_scan_dimension', { plan_id: id, source_id: 'kallare', base_revision: 2, apply: true, dimensions: dims })
  expect(done.isError, text(done)).toBeFalsy()
  expect(text(done)).toContain('omsamplad')
  const src = (await (await request.get(`/api/plans/${id}`)).json()).plan.sources[0]
  // One scale now: reading the same dimensions again gives the same factor on both axes.
  const again = findDimensionEnds(await gray(request, id, src.src), { id: 'k', mmPerPx: src.mmPerPx, x: src.x, y: src.y, widthPx: src.widthPx, heightPx: src.heightPx, src: '', rotation: 0 }, dimsAt(src, LEN_PX), dimsAt(src, LEN_PX, true))
  expect(again.a.found && again.b.found).toBe(true)
  const lenMm = Math.hypot(again.b.point.x - again.a.point.x, again.b.point.y - again.a.point.y)
  expect(Math.abs(lenMm - 10500)).toBeLessThan(40)
  const w = findDimensionEnds(await gray(request, id, src.src), { id: 'k', mmPerPx: src.mmPerPx, x: src.x, y: src.y, widthPx: src.widthPx, heightPx: src.heightPx, src: '', rotation: 0 }, dimsAt(src, WID_PX), dimsAt(src, WID_PX, true))
  expect(Math.abs(Math.hypot(w.b.point.x - w.a.point.x, w.b.point.y - w.a.point.y) - 6080)).toBeLessThan(40)
})

// Where a dimension's end sits in plan mm on the straightened source: the source was resampled by
// (kx/kb, ky/kb) and placed so the first end stayed put; recomputed from the image sizes.
function dimsAt(src: { x: number; y: number; mmPerPx: number; widthPx: number; heightPx: number }, d: { a: { x: number; y: number }; b: { x: number; y: number } }, second = false) {
  const sx = src.widthPx / 1979
  const sy = src.heightPx / 2576
  const p = second ? d.b : d.a
  return { x: src.x + p.x * sx * src.mmPerPx, y: src.y + p.y * sy * src.mmPerPx }
}

async function gray(request: APIRequestContext, id: string, srcUrl: string): Promise<Gray> {
  const buf = Buffer.from(await (await request.get(srcUrl)).body())
  const { data, info } = await sharp(buf).grayscale().raw().toBuffer({ resolveWithObject: true })
  return { data: new Uint8Array(data), w: info.width, h: info.height }
}

test('the window bands on the north wall are found on the real drawing', async ({ request }) => {
  const created = await call(request, 'plan_create', { name: 'Källare-fönster' })
  const id = /Skapad: ([a-z0-9-]+)/.exec(text(created))![1]
  await call(request, 'plan_source_add', { plan_id: id, base_revision: 1, id: 'kallare', role: 'archive', filename: 'kallare.png', data_base64: readFileSync(IMG).toString('base64'), scale: 100, dpi: 300 })
  const dims = [
    { label: 'längd', a: mm(LEN_PX.a), b: mm(LEN_PX.b), mm: 10500 },
    { label: 'bredd', a: mm(WID_PX.a), b: mm(WID_PX.b), mm: 6080 },
  ]
  await call(request, 'plan_scan_dimension', { plan_id: id, source_id: 'kallare', base_revision: 2, apply: true, dimensions: dims })
  const src = (await (await request.get(`/api/plans/${id}`)).json()).plan.sources[0]
  // The outer north-west corner: where the end strokes of the two dimensions meet.
  const nw = dimsAt(src, { a: { x: 772.5, y: 267.4 }, b: { x: 0, y: 0 } })
  const wall: Wall = { id: 'yN', a: { x: nw.x, y: nw.y + 160 }, b: { x: nw.x + 6080, y: nw.y + 160 }, thickness: 320, phase: 'existing', exterior: true }
  const rev = (await (await request.get(`/api/plans/${id}`)).json()).revision.n
  const edit = await call(request, 'plan_edit', { plan_id: id, base_revision: rev, ops: [{ op: 'add', kind: 'wall', item: wall }] })
  expect(edit.isError, text(edit)).toBeFalsy()
  const found = await call(request, 'plan_scan_openings', { plan_id: id, source_id: 'kallare', wall_ids: ['yN'], methods: ['fönsterband'] })
  const t = text(found)
  expect(t).toContain('2 nya öppningar')
  const win = [...t.matchAll(/fönster i yN, offset (\d+), bredd (\d+)/g)].map((m) => [Number(m[1]), Number(m[2])])
  expect(win).toHaveLength(2)
  // The left window (Tvättstuga side) is the long hollow stretch from the corner post to the first pier;
  // the right one (Passage) sits between the second pier and the corner post: the whole hollow stretch.
  expect(win[0][0]).toBeGreaterThan(100)
  expect(win[0][0]).toBeLessThan(400)
  expect(win[0][1]).toBeGreaterThan(2300)
  expect(win[0][1]).toBeLessThan(2800)
  // The right window runs from the first pier's reveal to the corner pier, a post (the rounded blob)
  // in the middle of it: about 1.5 m, not the 0.9 m after the post.
  expect(win[1][0]).toBeGreaterThan(3400)
  expect(win[1][0]).toBeLessThan(3900)
  expect(win[1][1]).toBeGreaterThan(1300)
  expect(win[1][1]).toBeLessThan(1750)
})

// ── the band reader on a drawn-by-code wall ──────────────────────────────

function sheet(w: number, h: number): Gray {
  return { data: new Uint8Array(w * h).fill(255), w, h }
}
const rect = (g: Gray, x0: number, y0: number, x1: number, y1: number) => {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) g.data[y * g.w + x] = 0
}
const wall = (len: number): Wall => ({ id: 'n', a: { x: 0, y: 100 }, b: { x: len, y: 100 }, thickness: 200, phase: 'existing', exterior: true })
const R = (g: Gray): Raster => ({ id: 's', mmPerPx: 10, x: 0, y: 0, widthPx: g.w, heightPx: g.h, src: '', rotation: 0 })

test('window bands: two thin face lines between solid parts are a window; solid, all-hollow and narrow bands are not', () => {
  // A 6 m wall at 10 mm/px, 20 px thick (y 0–20 ... centre y=10px): solid 0–60, hollow 60–260, solid 260–400, hollow 400–540, solid 540–600
  const g = sheet(620, 40)
  const solid = (a: number, b: number) => rect(g, a, 0, b, 20)
  const hollow = (a: number, b: number) => {
    rect(g, a, 0, b, 1) // outer face line
    rect(g, a, 19, b, 20) // inner face line
  }
  solid(0, 60)
  hollow(60, 260)
  solid(260, 400)
  hollow(400, 540)
  solid(540, 600)
  const w: Wall = { ...wall(6000), a: { x: 0, y: 100 }, b: { x: 6000, y: 100 } }
  const found = findWindowBands(g, R(g), w)
  expect(found.map((f) => [Math.round(f.offset / 100), Math.round(f.width / 100)])).toEqual([
    [6, 20],
    [40, 14],
  ])
  // A post across the hollow stretch does not split it.
  rect(g, 150, 0, 154, 20)
  expect(findWindowBands(g, R(g), w)).toHaveLength(2)
  // A wall solid all along: no window.
  const full = sheet(620, 40)
  rect(full, 0, 0, 600, 20)
  expect(findWindowBands(full, R(full), w)).toEqual([])
  // A wall drawn as two lines all along (outline style): the whole wall is not one window.
  const outline = sheet(620, 40)
  rect(outline, 0, 0, 600, 1)
  rect(outline, 0, 19, 600, 20)
  expect(findWindowBands(outline, R(outline), w)).toEqual([])
  // A hollow stretch narrower than 0.5 m is a gap in the drawing, not a window.
  const narrow = sheet(620, 40)
  rect(narrow, 0, 0, 100, 20)
  rect(narrow, 100, 0, 130, 1)
  rect(narrow, 100, 19, 130, 20)
  rect(narrow, 130, 0, 600, 20)
  expect(findWindowBands(narrow, R(narrow), w)).toEqual([])
})

// Keep the types honest for the helper above.
export type _Plan = Plan
