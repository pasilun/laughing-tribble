import sharp from 'sharp'
import { sample, type Gray, type Raster } from './raster'
import type { Rect } from './view'

// Before/after comparison of two calibrated sources over the same plan area:
// ink only in "before" is red (removed), only in "after" is blue (added),
// in both is grey. Both sources must already be calibrated to plan mm.

export async function scanDiff(
  before: { g: Gray; r: Raster },
  after: { g: Gray; r: Raster },
  rect: Rect,
  opts: { maxPx?: number; threshold?: number } = {},
): Promise<{ png: Buffer; removedPct: number; addedPct: number }> {
  const maxPx = opts.maxPx ?? 1400
  const th = opts.threshold ?? 128
  const k = maxPx / Math.max(rect.w, rect.h)
  const w = Math.max(1, Math.round(rect.w * k))
  const h = Math.max(1, Math.round(rect.h * k))
  const out = Buffer.alloc(w * h * 3, 255)
  let removed = 0
  let added = 0
  let ink = 0
  const at = (s: { g: Gray; r: Raster }, x: number, y: number) => sample(s.g, (x - s.r.x) / s.r.mmPerPx, (y - s.r.y) / s.r.mmPerPx) < th
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const x = rect.x + (i + 0.5) / k
      const y = rect.y + (j + 0.5) / k
      const b = at(before, x, y)
      const a = at(after, x, y)
      const o = (j * w + i) * 3
      if (a || b) ink++
      if (a && b) out.fill(150, o, o + 3)
      else if (b) {
        removed++
        out[o] = 220; out[o + 1] = 38; out[o + 2] = 38
      } else if (a) {
        added++
        out[o] = 37; out[o + 1] = 99; out[o + 2] = 235
      }
    }
  }
  const png = await sharp(out, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer()
  const pct = (n: number) => (ink ? Math.round((n / ink) * 1000) / 10 : 0)
  return { png, removedPct: pct(removed), addedPct: pct(added) }
}
