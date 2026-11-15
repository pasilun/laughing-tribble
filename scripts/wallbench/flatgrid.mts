// A whole flat as an annotator sees it: the crop region, scaled, with a grid in plan millimetres (lines every 500 mm,
// labels every 1000 mm), so answers come back in plan mm.
//   npx tsx scripts/wallbench/flatgrid.mts <x> <y> <w> <h> <scale> <out.png>
import sharp from 'sharp'
import { CASE, tileBits } from './common.mjs'

const [x, y, w, h, scale = '1.6', out = 'flat.png'] = process.argv.slice(2)
const b = await tileBits([Number(x), Number(y), Number(w), Number(h)])
const S = Number(scale)
const W = Math.round(b.w * S), H = Math.round(b.h * S)
const rgb = Buffer.alloc(W * H * 3, 255)
for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) if (b.d[Math.floor(py / S) * b.w + Math.floor(px / S)]) rgb.fill(40, (py * W + px) * 3, (py * W + px) * 3 + 3)
const mmX = (px: number) => CASE.x + (b.x0 + px / S) * CASE.mm_per_px
const mmY = (py: number) => CASE.y + (b.y0 + py / S) * CASE.mm_per_px
const pxX = (mm: number) => ((mm - CASE.x) / CASE.mm_per_px - b.x0) * S
const pxY = (mm: number) => ((mm - CASE.y) / CASE.mm_per_px - b.y0) * S
const parts: string[] = []
for (let v = Math.ceil(mmX(0) / 500) * 500; v <= mmX(W); v += 500) {
  const p = pxX(v), strong = v % 1000 === 0
  parts.push(`<line x1="${p}" y1="0" x2="${p}" y2="${H}" stroke="${strong ? '#3a7bd5' : '#9cc0ef'}" stroke-width="1" opacity="0.6"/>`)
  if (strong) parts.push(`<text x="${p + 3}" y="14" font-size="13" font-family="sans-serif" fill="#1a4fa0">${v}</text>`)
}
for (let v = Math.ceil(mmY(0) / 500) * 500; v <= mmY(H); v += 500) {
  const p = pxY(v), strong = v % 1000 === 0
  parts.push(`<line x1="0" y1="${p}" x2="${W}" y2="${p}" stroke="${strong ? '#3a7bd5' : '#9cc0ef'}" stroke-width="1" opacity="0.6"/>`)
  if (strong) parts.push(`<text x="3" y="${p - 3}" font-size="13" font-family="sans-serif" fill="#1a4fa0">${v}</text>`)
}
const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${parts.join('')}</svg>`)
await sharp(rgb, { raw: { width: W, height: H, channels: 3 } }).composite([{ input: svg }]).png().toFile(out)
console.log(`picture ${W}×${H}, x ${Math.round(mmX(0))}–${Math.round(mmX(W))}, y ${Math.round(mmY(0))}–${Math.round(mmY(H))} mm`)
