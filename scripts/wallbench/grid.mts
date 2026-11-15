// The picture an annotator sees: a tile of the drawing, scaled 2×, with a grid every 50 tile px and labels every 100.
// Coordinates the annotator gives are tile px (the grid labels).
//   npx tsx scripts/wallbench/grid.mts <tile> <out.png>
import sharp from 'sharp'
import { TILES, tileBits } from './common.mjs'

const [tile = '154w', out = 'grid.png'] = process.argv.slice(2)
const b = await tileBits(TILES[tile])
const S = 2
const W = b.w * S, H = b.h * S
const rgb = Buffer.alloc(W * H * 3, 255)
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (b.d[Math.floor(y / S) * b.w + Math.floor(x / S)]) rgb.fill(40, (y * W + x) * 3, (y * W + x) * 3 + 3)
const lines: string[] = []
for (let v = 0; v <= Math.max(b.w, b.h); v += 50) {
  const strong = v % 100 === 0
  const col = strong ? '#3a7bd5' : '#9cc0ef'
  if (v <= b.w) lines.push(`<line x1="${v * S}" y1="0" x2="${v * S}" y2="${H}" stroke="${col}" stroke-width="1" opacity="0.6"/>`)
  if (v <= b.h) lines.push(`<line x1="0" y1="${v * S}" x2="${W}" y2="${v * S}" stroke="${col}" stroke-width="1" opacity="0.6"/>`)
  if (strong && v <= b.w) lines.push(`<text x="${v * S + 3}" y="14" font-size="14" font-family="sans-serif" fill="#1a4fa0">${v}</text>`)
  if (strong && v <= b.h && v > 0) lines.push(`<text x="3" y="${v * S - 3}" font-size="14" font-family="sans-serif" fill="#1a4fa0">${v}</text>`)
}
const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${lines.join('')}</svg>`)
await sharp(rgb, { raw: { width: W, height: H, channels: 3 } }).composite([{ input: svg }]).png().toFile(out)
console.log(tile, `tile ${b.w}×${b.h} px, picture ${W}×${H}`)
