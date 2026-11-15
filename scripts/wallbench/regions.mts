// Step 1a (engine only): the white paper of a part of the sheet divided into numbered regions: rooms and spaces, cut
// where they narrow (a doorway between two rooms). A watershed of the distance to the nearest ink: pixels are taken from
// the most open first; each open middle starts a region; where two regions meet, the meeting point's openness is their
// "pass". Two regions whose pass is nearly as open as the smaller of their middles are one room (an elongated room);
// a narrow pass is a doorway, and they stay apart. Regions too narrow to stand in (wall bodies) or too small are left out.
//   npx tsx scripts/wallbench/regions.mts <x> <y> <w> <h> <scale> <out.png> <out.json> [mergeRatio] [minPeakMm] [minPieceMm]
import { writeFileSync } from 'fs'
import sharp from 'sharp'
import { CASE, tileBits } from './common.mjs'
import { distanceToInk } from './annotate.mjs'

const [x, y, w, h, scale = '1.6', outPng = 'regions.png', outJson = 'regions.json', ratioArg = '0.7', minPeakArg = '150'] = process.argv.slice(2)
const b = await tileBits([Number(x), Number(y), Number(w), Number(h)])
const k = CASE.mm_per_px
// Barriers are the wall network only: the walls of a floor form a few large connected pieces of ink; lettering,
// underlines, dashes, specks and loose symbols are small separate pieces and are left out (a fixture touching a wall
// stays, and the regions simply go round it).
const minPieceMm = Number(process.argv[11] ?? '2000')
const walls = new Uint8Array(b.d.length)
type Piece = { pix: number[]; x0: number; y0: number; x1: number; y1: number }
const small: Piece[] = []
{
  const seen = new Uint8Array(b.d.length)
  for (let s0 = 0; s0 < b.d.length; s0++) {
    if (!b.d[s0] || seen[s0]) continue
    const comp: number[] = [s0]
    seen[s0] = 1
    let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1
    for (let q = 0; q < comp.length; q++) {
      const j = comp[q], X = j % b.w, Y = (j - X) / b.w
      x0 = Math.min(x0, X); x1 = Math.max(x1, X); y0 = Math.min(y0, Y); y1 = Math.max(y1, Y)
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const XX = X + dx, YY = Y + dy
        if (XX < 0 || YY < 0 || XX >= b.w || YY >= b.h) continue
        const m = YY * b.w + XX
        if (b.d[m] && !seen[m]) { seen[m] = 1; comp.push(m) }
      }
    }
    if (Math.max(x1 - x0, y1 - y0) * k >= minPieceMm) for (const j of comp) walls[j] = 1
    else small.push({ pix: comp, x0, y0, x1, y1 })
  }
}
// A wall drawn dashed: two or more elongated pieces on one line, with short gaps, covering at least 500 mm. A thick
// row (each dash at least 35 mm thick) is a wall and stays a barrier; a thin one (a ceiling or centre line) and lettering
// (pieces not elongated) do not.
{
  for (const vertical of [false, true]) {
    const dash = small.filter((p) => {
      const len = vertical ? p.y1 - p.y0 + 1 : p.x1 - p.x0 + 1, thick = vertical ? p.x1 - p.x0 + 1 : p.y1 - p.y0 + 1
      return len >= 2 * thick && len * k >= 120 && len * k <= 900 && thick * k >= 35
    })
    const centre = (p: Piece) => (vertical ? (p.x0 + p.x1) / 2 : (p.y0 + p.y1) / 2)
    const along = (p: Piece) => (vertical ? p.y0 : p.x0)
    const end = (p: Piece) => (vertical ? p.y1 : p.x1)
    const used = new Set<Piece>()
    for (const p of [...dash].sort((a, c) => along(a) - along(c))) {
      if (used.has(p)) continue
      const row = [p]
      for (const q of [...dash].sort((a, c) => along(a) - along(c))) {
        const last = row[row.length - 1]
        if (q === p || used.has(q) || along(q) <= along(last)) continue
        if (Math.abs(centre(q) - centre(p)) * k <= 40 && (along(q) - end(last)) * k <= 400) row.push(q)
      }
      const extent = (end(row[row.length - 1]) - along(row[0])) * k
      if (row.length >= 2 && extent >= 500) for (const q of row) { used.add(q); for (const j of q.pix) walls[j] = 1 }
    }
  }
}
const D = distanceToInk(walls, b.w, b.h)
const N = b.w * b.h
const order = Array.from({ length: N }, (_, i) => i).filter((i) => !walls[i] && D[i] >= 1.5).sort((p, q) => D[q] - D[p])
const lab = new Int32Array(N)
const peak: number[] = [0], peakAt: number[] = [0]
const parent: number[] = [0]
const find = (a: number): number => (parent[a] === a ? a : (parent[a] = find(parent[a])))
const passes = new Map<string, number>() // "a,b" -> highest openness where a and b meet
for (const i of order) {
  const px = i % b.w, py = (i - px) / b.w
  const near = new Set<number>()
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const X = px + dx, Y = py + dy
    if (X < 0 || Y < 0 || X >= b.w || Y >= b.h) continue
    const l = lab[Y * b.w + X]
    if (l) near.add(find(l))
  }
  if (near.size === 0) { const id = peak.length; peak.push(D[i]); peakAt.push(i); parent.push(id); lab[i] = id; continue }
  const ls = [...near]
  lab[i] = ls[0]
  for (let a = 0; a < ls.length; a++) for (let c = a + 1; c < ls.length; c++) {
    const key = ls[a] < ls[c] ? `${ls[a]},${ls[c]}` : `${ls[c]},${ls[a]}`
    if (!passes.has(key)) passes.set(key, D[i])
  }
}
// Merge regions across open passes, most open first.
const ratio = Number(ratioArg)
for (const [key, pass] of [...passes.entries()].sort((p, q) => q[1] - p[1])) {
  const [a, c] = key.split(',').map(Number)
  const ra = find(a), rc = find(c)
  if (ra === rc) continue
  if (pass >= ratio * Math.min(peak[ra], peak[rc])) {
    const big = peak[ra] >= peak[rc] ? ra : rc, small = big === ra ? rc : ra
    parent[small] = big
  }
}
for (let i = 0; i < N; i++) if (lab[i]) lab[i] = find(lab[i])
// Regions: peak openness, area, bounding box; keep the ones a person could stand in.
const minPeak = Number(minPeakArg) / k
type Region = { id: number; n: number; peakMm: number; at: [number, number]; areaM2: number; box: [number, number, number, number] }
const stats = new Map<number, { area: number; x0: number; y0: number; x1: number; y1: number }>()
for (let i = 0; i < N; i++) {
  const l = lab[i]
  if (!l) continue
  const px = i % b.w, py = (i - px) / b.w
  const s = stats.get(l) ?? { area: 0, x0: px, y0: py, x1: px, y1: py }
  s.area++; s.x0 = Math.min(s.x0, px); s.y0 = Math.min(s.y0, py); s.x1 = Math.max(s.x1, px); s.y1 = Math.max(s.y1, py)
  stats.set(l, s)
}
const mm = (px: number, py: number): [number, number] => [Math.round(CASE.x + (b.x0 + px) * k), Math.round(CASE.y + (b.y0 + py) * k)]
const kept = [...stats.entries()].filter(([l, s]) => peak[l] >= minPeak && s.area * k * k >= 0.15e6)
// Number in reading order: rows of 1 m from the top, then left to right.
kept.sort(([la], [lb]) => {
  const a = peakAt[la], c = peakAt[lb]
  const ay = Math.floor((a - (a % b.w)) / b.w * k / 1000), cy = Math.floor((c - (c % b.w)) / b.w * k / 1000)
  return ay - cy || (a % b.w) - (c % b.w)
})
const regions: Region[] = kept.map(([l, s], n) => {
  const i = peakAt[l], px = i % b.w, py = (i - px) / b.w
  return { id: l, n: n + 1, peakMm: Math.round(peak[l] * k), at: mm(px, py), areaM2: +(s.area * k * k / 1e6).toFixed(1), box: [...mm(s.x0, s.y0), ...mm(s.x1, s.y1)] as [number, number, number, number] }
})
writeFileSync(outJson, JSON.stringify({ tile: [Number(x), Number(y), Number(w), Number(h)], regions }, null, 1))
// Picture: each region tinted, its number at its most open point, ink black.
const S = Number(scale)
const W = Math.round(b.w * S), H = Math.round(b.h * S)
const colourOf = new Map(regions.map((r, j) => [r.id, j]))
const hue = (j: number): [number, number, number] => {
  const t = (j * 0.61803) % 1, f = (n: number) => Math.round(255 * (0.78 + 0.2 * Math.cos(2 * Math.PI * (t + n / 3))))
  return [f(0), f(1), f(2)]
}
const rgb = Buffer.alloc(W * H * 3, 255)
for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) {
  const i = Math.floor(py / S) * b.w + Math.floor(px / S)
  const o = (py * W + px) * 3
  if (walls[i]) rgb.fill(30, o, o + 3)
  else if (b.d[i]) rgb.fill(185, o, o + 3)
  else if (lab[i] && colourOf.has(lab[i])) { const c = hue(colourOf.get(lab[i])!); rgb[o] = c[0]; rgb[o + 1] = c[1]; rgb[o + 2] = c[2] }
}
const pxOf = (m: [number, number]) => [((m[0] - CASE.x) / k - b.x0) * S, ((m[1] - CASE.y) / k - b.y0) * S]
const labels = regions.map((r) => {
  const [px, py] = pxOf(r.at)
  return `<circle cx="${px}" cy="${py}" r="15" fill="#fff" stroke="#c00" stroke-width="2.5"/><text x="${px}" y="${py + 6}" text-anchor="middle" font-size="17" font-weight="bold" font-family="sans-serif" fill="#c00">${r.n}</text>`
})
const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${labels.join('')}</svg>`)
await sharp(rgb, { raw: { width: W, height: H, channels: 3 } }).composite([{ input: svg }]).png().toFile(outPng)
console.log(`${regions.length} regions (of ${stats.size} before the size filter)`)
for (const r of regions) console.log(`${String(r.n).padStart(2)}: ${r.areaM2} m², most open ${r.peakMm} mm from ink, at (${r.at})`)
