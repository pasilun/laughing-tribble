// Runs the trace's wall detection (detect → join → merge → length filter) on a tile of the 1999 crop, on the raw image
// or after a cleaning, and scores the walls against the fixture clipped to the tile. Picture: fixture green, trace red.
//   npx tsx scripts/wallbench/detect.mts [tile] [raw|runs|solid] [out.png]
import sharp from 'sharp'
import { FIXTURE, TILES, CASE, picture } from './common.mjs'
import { clean } from './clean.mjs'
import { solidLayer } from './layers.mjs'
import { detectWalls } from '../../lib/plan/scan/detect.js'
import { joinPieces, mergeStacked } from '../../lib/plan/scan/pieces.js'
import { scorePlan } from '../../lib/plan/bench/score.js'
import type { Plan, Wall } from '../../lib/plan/domain/types.js'

const MIN_WALL = 1000
export async function fullImage() {
  const { data, info } = await sharp(`e2e/fixtures/flat/a00-crop.png`).greyscale().raw().toBuffer({ resolveWithObject: true })
  return { data: new Uint8Array(data), w: info.width, h: info.height }
}
const raster = (w: number, h: number) => ({ id: 'a00', mmPerPx: CASE.mm_per_px, x: CASE.x, y: CASE.y, widthPx: w, heightPx: h, src: '', rotation: 0 })

export async function traceTile(tile: string, method: string, opts: { run?: number; gap?: number; thick?: number; len?: number } = {}) {
  const img = await fullImage()
  const bits = { w: img.w, h: img.h, d: new Uint8Array(img.w * img.h), x0: 0, y0: 0 }
  for (let i = 0; i < bits.d.length; i++) bits.d[i] = img.data[i] < 128 ? 1 : 0
  let ink: Uint8Array = bits.d
  if (method === 'runs') ink = clean(bits, opts.run ?? 400, opts.gap ?? 2)
  if (method === 'solid') ink = solidLayer(bits, opts.thick ?? 40, opts.len ?? 340)
  const g = { w: img.w, h: img.h, data: new Uint8Array(img.w * img.h) }
  for (let i = 0; i < ink.length; i++) g.data[i] = ink[i] ? 0 : 255
  const r = raster(img.w, img.h)
  const [x, y, w, h] = TILES[tile]
  const props = detectWalls(g as never, r as never, { rect: { x, y, w, h }, maxProposals: 1000 })
  const walls = mergeStacked(joinPieces(props.map((p) => ({ a: p.a, b: p.b, thickness: p.thickness })), 60))
    .filter((p) => Math.hypot(p.b.x - p.a.x, p.b.y - p.a.y) >= MIN_WALL)
    .map((p, i): Wall => ({ id: `w${i + 1}`, ...p, phase: 'existing' }))
  return { walls, g }
}

export function scoreTile(tile: string, walls: Wall[]) {
  const [x0, y0, w, h] = TILES[tile]
  const B = { x0, x1: x0 + w, y0, y1: y0 + h }
  const cl = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))
  const clip = (ws: Wall[]) => ws.filter((q) => !(Math.max(q.a.x, q.b.x) < B.x0 || Math.min(q.a.x, q.b.x) > B.x1 || Math.max(q.a.y, q.b.y) < B.y0 || Math.min(q.a.y, q.b.y) > B.y1)).map((q) => ({ ...q, a: { x: cl(q.a.x, B.x0, B.x1), y: cl(q.a.y, B.y0, B.y1) }, b: { x: cl(q.b.x, B.x0, B.x1), y: cl(q.b.y, B.y0, B.y1) } }))
  const ref = { ...FIXTURE, walls: clip(FIXTURE.walls), openings: [] } as Plan
  return scorePlan(ref, { ...FIXTURE, walls: clip(walls), openings: [] } as Plan, { minWallMm: 300 }).walls
}

export async function overlay(tile: string, walls: Wall[], g: { data: Uint8Array; w: number }, out: string) {
    const [x, y, w, h] = TILES[tile]
    const px0 = Math.floor((x - CASE.x) / CASE.mm_per_px), py0 = Math.floor((y - CASE.y) / CASE.mm_per_px)
    const W = Math.ceil(w / CASE.mm_per_px), H = Math.ceil(h / CASE.mm_per_px)
    const red = new Uint8Array(W * H), green = new Uint8Array(W * H)
    const line = (m: Uint8Array, wl: Wall) => {
      const a = { x: (wl.a.x - CASE.x) / CASE.mm_per_px - px0, y: (wl.a.y - CASE.y) / CASE.mm_per_px - py0 }
      const c = { x: (wl.b.x - CASE.x) / CASE.mm_per_px - px0, y: (wl.b.y - CASE.y) / CASE.mm_per_px - py0 }
      const n = Math.ceil(Math.hypot(c.x - a.x, c.y - a.y))
      for (let i = 0; i <= n; i++) {
        const X = Math.round(a.x + ((c.x - a.x) * i) / n), Y = Math.round(a.y + ((c.y - a.y) * i) / n)
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) if (X + dx >= 0 && Y + dy >= 0 && X + dx < W && Y + dy < H) m[(Y + dy) * W + X + dx] = 1
      }
    }
    for (const wl of FIXTURE.walls) line(green, wl)
    for (const wl of walls) line(red, wl)
    await picture(W, H, (i) => {
      const xx = i % W, yy = Math.floor(i / W)
      const ink = g.data[(py0 + yy) * g.w + px0 + xx] < 128
      if (red[i] && green[i]) return [200, 150, 0]
      if (red[i]) return [230, 30, 30]
      if (green[i]) return [20, 170, 60]
      return ink ? [90, 90, 90] : [255, 255, 255]
    }, out)
}

if (process.argv[1]?.endsWith('detect.mts')) {
  const [tile = '154w', method = 'raw', out] = process.argv.slice(2)
  const { walls, g } = await traceTile(tile, method)
  const s = scoreTile(tile, walls)
  console.log(tile, method, `${walls.length} walls`, `recall100 ${s.recall['100']}`, `recall50 ${s.recall['50']}`, `precision100 ${s.precision100}`, `median ${s.medianOffsetMm}`)
  if (out) await overlay(tile, walls, g, out)
}
