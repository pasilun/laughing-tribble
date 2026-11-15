// W1 (second try): split the ink into a SOLID layer (long, thick bands: ordinary walls) and a THIN layer (long, thin
// lines: outlined walls, fixtures, text underlines). A rectangle opening, per axis: a pixel is kept when it lies in a
// rectangle of ink that is `lenMm` long and `thickMm` thick. Scores per fixture wall how much of its length is covered.
//   npx tsx scripts/wallbench/layers.mts [tile] [thickMm] [lenMm] [out.png]
import { FIXTURE, TILES, CASE, tileBits, wallMask, toPx, picture, type Bits } from './common.mjs'

// Integral image of a 0/1 array.
function integral(d: Uint8Array, w: number, h: number): Int32Array {
  const I = new Int32Array((w + 1) * (h + 1))
  for (let y = 0; y < h; y++) {
    let row = 0
    for (let x = 0; x < w; x++) {
      row += d[y * w + x]
      I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + row
    }
  }
  return I
}
const box = (I: Int32Array, w: number, x0: number, y0: number, x1: number, y1: number) => I[y1 * (w + 1) + x1] - I[y0 * (w + 1) + x1] - I[y1 * (w + 1) + x0] + I[y0 * (w + 1) + x0]

// Opening of `d` by a rectangle rw × rh (erode: all ink; dilate: any eroded pixel in the rectangle).
export function openRect(d: Uint8Array, w: number, h: number, rw: number, rh: number): Uint8Array {
  const I = integral(d, w, h)
  const er = new Uint8Array(w * h)
  for (let y = 0; y + rh <= h; y++) for (let x = 0; x + rw <= w; x++) if (box(I, w, x, y, x + rw, y + rh) === rw * rh) er[y * w + x] = 1
  const E = integral(er, w, h)
  const out = new Uint8Array(w * h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!d[y * w + x]) continue
      // The pixel is in some rectangle whose top-left is an eroded pixel at (x - rw + 1 .. x, y - rh + 1 .. y).
      if (box(E, w, Math.max(0, x - rw + 1), Math.max(0, y - rh + 1), x + 1, y + 1) > 0) out[y * w + x] = 1
    }
  return out
}

export function solidLayer(b: Bits, thickMm: number, lenMm: number): Uint8Array {
  const t = Math.max(1, Math.round(thickMm / CASE.mm_per_px))
  const L = Math.round(lenMm / CASE.mm_per_px)
  const h = openRect(b.d, b.w, b.h, L, t)
  const v = openRect(b.d, b.w, b.h, t, L)
  const out = new Uint8Array(b.d.length)
  for (let i = 0; i < out.length; i++) out[i] = h[i] | v[i]
  return out
}

// Share of each fixture wall's length (along its centre line) covered by ink of `layer` within the wall's body.
export function wallCoverage(b: Bits, layer: Uint8Array) {
  const out: Array<{ id: string; lenMm: number; raw: number; kept: number }> = []
  for (const w of FIXTURE.walls) {
    const a = toPx(b, w.a.x, w.a.y)
    const c = toPx(b, w.b.x, w.b.y)
    const vertical = Math.abs(a.x - c.x) < Math.abs(a.y - c.y)
    const n = Math.round(Math.hypot(c.x - a.x, c.y - a.y))
    const half = Math.max(1, Math.round(w.thickness / 2 / CASE.mm_per_px))
    let inside = 0, raw = 0, kept = 0
    for (let i = 0; i < n; i++) {
      const px = a.x + ((c.x - a.x) * i) / n
      const py = a.y + ((c.y - a.y) * i) / n
      if (px < 0 || py < 0 || px >= b.w || py >= b.h) continue
      inside++
      let r = false, k = false
      for (let o = -half; o <= half; o++) {
        const x = Math.round(vertical ? px + o : px)
        const y = Math.round(vertical ? py : py + o)
        if (x < 0 || y < 0 || x >= b.w || y >= b.h) continue
        if (b.d[y * b.w + x]) r = true
        if (layer[y * b.w + x]) k = true
      }
      if (r) raw++
      if (k) kept++
    }
    if (inside >= 20) out.push({ id: w.id, lenMm: Math.round((inside * CASE.mm_per_px)), raw: +(raw / inside).toFixed(2), kept: +(kept / inside).toFixed(2) })
  }
  return out
}

if (process.argv[1]?.endsWith('layers.mts')) {
  const [tile = '154w', thick = '60', len = '340', out] = process.argv.slice(2)
  const b = await tileBits(TILES[tile])
  const solid = solidLayer(b, Number(thick), Number(len))
  const mask = wallMask(b, FIXTURE.walls)
  let ink = 0, other = 0, otherKept = 0
  for (let i = 0; i < b.d.length; i++) if (b.d[i] && !mask[i]) { other++; if (solid[i]) otherKept++ }
  for (let i = 0; i < b.d.length; i++) if (b.d[i]) ink++
  const cov = wallCoverage(b, solid)
  const tot = cov.reduce((s, c) => s + c.lenMm, 0)
  const got = cov.reduce((s, c) => s + c.lenMm * c.kept, 0)
  console.log(tile, `solid layer: thick ${thick} mm, length ${len} mm`)
  console.log(`  wall length covered by solid ink: ${(100 * got / tot).toFixed(0)} %; ink outside walls still kept: ${(100 * otherKept / other).toFixed(0)} %`)
  console.log('  walls below 70 % (outlined, or lost):', cov.filter((c) => c.kept < 0.7).map((c) => `${c.id} ${Math.round(c.lenMm)} mm raw ${c.raw} kept ${c.kept}`).join('; ') || 'none')
  if (out)
    await picture(b.w, b.h, (i) => {
      if (!b.d[i]) return mask[i] ? [225, 245, 225] : [255, 255, 255]
      if (solid[i]) return mask[i] ? [0, 0, 0] : [30, 90, 230]
      return mask[i] ? [230, 30, 30] : [190, 190, 190]
    }, out)
}
