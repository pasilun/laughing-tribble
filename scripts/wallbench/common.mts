// Shared helpers for the wall-reader experiments (docs/wall-reader-plan.md): the 1999 crop as a bit image, tiles in
// plan mm, the fixture's walls as a mask, and pictures. Experiments only; nothing in lib/ depends on this.
import { readFileSync } from 'fs'
import sharp from 'sharp'
import type { Plan, Wall } from '../../lib/plan/domain/types.js'

export const F = 'e2e/fixtures/flat'
export const CASE = JSON.parse(readFileSync(`${F}/case.json`, 'utf8')) as { mm_per_px: number; x: number; y: number }
export const FIXTURE = JSON.parse(readFileSync(`${F}/drawing-1999.json`, 'utf8')) as Plan
export const TILES: Record<string, [number, number, number, number]> = {
  '154w': [20400, 15500, 6100, 5500],
  '152wet': [19300, 7800, 5400, 5400],
  '153east': [24400, 7800, 5600, 5400],
  'mid': [22500, 12800, 7400, 4000],
}

// A tile of the crop as a bit image: 1 = ink.
export type Bits = { w: number; h: number; d: Uint8Array; x0: number; y0: number }
export async function tileBits(tile: [number, number, number, number]): Promise<Bits> {
  const { data, info } = await sharp(`${F}/a00-crop.png`).greyscale().raw().toBuffer({ resolveWithObject: true })
  const k = CASE.mm_per_px
  const px0 = Math.max(0, Math.floor((tile[0] - CASE.x) / k))
  const py0 = Math.max(0, Math.floor((tile[1] - CASE.y) / k))
  const px1 = Math.min(info.width, Math.ceil((tile[0] + tile[2] - CASE.x) / k))
  const py1 = Math.min(info.height, Math.ceil((tile[1] + tile[3] - CASE.y) / k))
  const w = px1 - px0
  const h = py1 - py0
  const d = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d[y * w + x] = data[(py0 + y) * info.width + px0 + x] < 128 ? 1 : 0
  return { w, h, d, x0: px0, y0: py0 }
}

// Pixel ↔ plan mm for a tile.
export const toMm = (b: Bits, px: number, py: number) => ({ x: CASE.x + (b.x0 + px) * CASE.mm_per_px, y: CASE.y + (b.y0 + py) * CASE.mm_per_px })
export const toPx = (b: Bits, x: number, y: number) => ({ x: (x - CASE.x) / CASE.mm_per_px - b.x0, y: (y - CASE.y) / CASE.mm_per_px - b.y0 })

// The fixture's walls (axis-aligned bodies) drawn into the tile, grown by `grow` px: where wall ink belongs.
export function wallMask(b: Bits, walls: Wall[], grow = 1): Uint8Array {
  const m = new Uint8Array(b.w * b.h)
  for (const w of walls) {
    const a = toPx(b, w.a.x, w.a.y)
    const c = toPx(b, w.b.x, w.b.y)
    const t = w.thickness / 2 / CASE.mm_per_px
    const vertical = Math.abs(a.x - c.x) < Math.abs(a.y - c.y)
    const x0 = Math.floor(Math.min(a.x, c.x) - (vertical ? t : 0) - grow)
    const x1 = Math.ceil(Math.max(a.x, c.x) + (vertical ? t : 0) + grow)
    const y0 = Math.floor(Math.min(a.y, c.y) - (vertical ? 0 : t) - grow)
    const y1 = Math.ceil(Math.max(a.y, c.y) + (vertical ? 0 : t) + grow)
    for (let y = Math.max(0, y0); y < Math.min(b.h, y1); y++) for (let x = Math.max(0, x0); x < Math.min(b.w, x1); x++) m[y * b.w + x] = 1
  }
  return m
}

// A picture from per-pixel colours (r, g, b), scaled up for viewing.
export async function picture(w: number, h: number, colour: (i: number) => [number, number, number], file: string, scale = 2) {
  const rgb = Buffer.alloc(w * h * 3)
  for (let i = 0; i < w * h; i++) {
    const [r, g, bb] = colour(i)
    rgb[i * 3] = r
    rgb[i * 3 + 1] = g
    rgb[i * 3 + 2] = bb
  }
  await sharp(rgb, { raw: { width: w, height: h, channels: 3 } }).resize(Math.round(w * scale), Math.round(h * scale), { kernel: 'nearest' }).png().toFile(file)
}
