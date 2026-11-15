// W3 prototype: walls as the space between two thin outlines, plus thick bands. Finds long axis-aligned lines in the ink
// (runs of at least `minMm`, gaps bridged), merges runs of neighbouring rows into line objects, pairs facing lines with an
// empty core between them into a wall (centre in the gap, the gap as thickness), and keeps unpaired thick lines as walls.
//   npx tsx scripts/wallbench/pairs.mts [tile] [out.png]
import { TILES, CASE, tileBits, toMm, type Bits } from './common.mjs'
import { scoreTile, overlay } from './detect.mjs'
import { joinPieces, mergeStacked } from '../../lib/plan/scan/pieces.js'
import type { Wall } from '../../lib/plan/domain/types.js'

export type Line = { p0: number; p1: number; t0: number; t1: number } // across range, along range, in px (horizontal lines)

// Horizontal lines of a bit image: per row, runs ≥ minLen with gaps ≤ gap bridged; runs in neighbouring rows that overlap
// are one line.
export function horizontalLines(d: Uint8Array, w: number, h: number, minLen: number, gap: number): Line[] {
  type Run = { y: number; x0: number; x1: number; id: number }
  const rows: Run[][] = []
  const parent: number[] = []
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  for (let y = 0; y < h; y++) {
    const runs: Run[] = []
    let x = 0
    while (x < w) {
      if (!d[y * w + x]) { x++; continue }
      let end = x
      let k = x
      while (k < w) {
        if (d[y * w + k]) { end = k; k++; continue }
        let g = k
        while (g < w && !d[y * w + g] && g - k < gap) g++
        if (g < w && d[y * w + g]) { k = g; continue }
        break
      }
      if (end - x + 1 >= minLen) { const id = parent.length; parent.push(id); runs.push({ y, x0: x, x1: end, id }) }
      x = end + 1
    }
    rows.push(runs)
    if (y > 0) for (const a of rows[y - 1]) for (const b of runs) {
      const ov = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) + 1
      if (ov >= 0.5 * Math.min(a.x1 - a.x0 + 1, b.x1 - b.x0 + 1)) parent[find(a.id)] = find(b.id)
    }
  }
  const comp = new Map<number, Line>()
  for (const runs of rows) for (const r of runs) {
    const k = find(r.id)
    const c = comp.get(k)
    if (!c) comp.set(k, { p0: r.y, p1: r.y, t0: r.x0, t1: r.x1 })
    else { c.p0 = Math.min(c.p0, r.y); c.p1 = Math.max(c.p1, r.y); c.t0 = Math.min(c.t0, r.x0); c.t1 = Math.max(c.t1, r.x1) }
  }
  return [...comp.values()]
}

const transpose = (d: Uint8Array, w: number, h: number) => {
  const t = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) t[x * h + y] = d[y * w + x]
  return t
}

export type PairOpts = { minMm: number; gapPx: number; minGapMm: number; maxGapMm: number; coreMax: number; thickPx: number; bandMm: number; mutual: boolean }
export const DEFAULTS: PairOpts = { minMm: 340, gapPx: 3, minGapMm: 40, maxGapMm: 520, coreMax: 0.3, thickPx: 9, bandMm: 700, mutual: true }

// Walls of one axis: returns pieces in px as {p (across centre), t0, t1, thick (px)}.
function axisWalls(d: Uint8Array, w: number, h: number, o: PairOpts) {
  const k = CASE.mm_per_px
  const lines = horizontalLines(d, w, h, Math.round(o.minMm / k), o.gapPx)
  const out: Array<{ p: number; t0: number; t1: number; thick: number; kind: 'pair' | 'band' }> = []
  const paired = new Set<Line>()
  const minGap = Math.max(2, Math.round(o.minGapMm / k))
  const maxGap = Math.round(o.maxGapMm / k)
  const minOv = Math.round(o.minMm / k)
  const below = new Map<Line, { b: Line; gap: number }>()
  const above = new Map<Line, { a: Line; gap: number }>()
  const core = (a: Line, b: Line, s: number, e: number) => {
    let ink = 0, n = 0
    for (let y = a.p1 + 1; y < b.p0; y++) for (let x = s; x <= e; x++) { n++; if (d[y * w + x]) ink++ }
    return n ? ink / n : 1
  }
  for (const a of lines) for (const b of lines) {
    if (a === b || b.p0 <= a.p1) continue
    const gap = b.p0 - a.p1 - 1
    if (gap < minGap || gap > maxGap) continue
    const s = Math.max(a.t0, b.t0), e = Math.min(a.t1, b.t1)
    if (e - s + 1 < minOv) continue
    if (core(a, b, s, e) > o.coreMax) continue
    const cb = below.get(a)
    if (!cb || gap < cb.gap) below.set(a, { b, gap })
    const ca = above.get(b)
    if (!ca || gap < ca.gap) above.set(b, { a, gap })
  }
  const emit = (a: Line, b: Line, gap: number) => {
    paired.add(a); paired.add(b)
    const s = Math.max(a.t0, b.t0), e = Math.min(a.t1, b.t1)
    out.push({ p: (a.p1 + 1 + b.p0 - 1) / 2, t0: s, t1: e, thick: gap, kind: 'pair' })
  }
  if (o.mutual) {
    for (const [a, { b, gap }] of below) if (above.get(b)?.a === a) emit(a, b, gap) // mutual nearest only
  } else for (const a of lines) for (const b of lines) {
    if (a === b || b.p0 <= a.p1) continue
    const gap = b.p0 - a.p1 - 1
    if (gap < minGap || gap > maxGap) continue
    const s = Math.max(a.t0, b.t0), e = Math.min(a.t1, b.t1)
    if (e - s + 1 < minOv || core(a, b, s, e) > o.coreMax) continue
    emit(a, b, gap)
  }
  for (const l of lines) {
    if (paired.has(l)) continue
    const thick = l.p1 - l.p0 + 1
    if (thick >= o.thickPx && (l.t1 - l.t0 + 1) * k >= o.bandMm) out.push({ p: (l.p0 + l.p1) / 2, t0: l.t0, t1: l.t1, thick, kind: 'band' })
  }
  return out
}

export function pairWalls(b: Bits, o: PairOpts = DEFAULTS): Wall[] {
  const k = CASE.mm_per_px
  const walls: Array<{ a: { x: number; y: number }; b: { x: number; y: number }; thickness: number }> = []
  for (const q of axisWalls(b.d, b.w, b.h, o)) walls.push({ a: toMm(b, q.t0, q.p + 0.5), b: toMm(b, q.t1 + 1, q.p + 0.5), thickness: Math.round(q.thick * k) })
  const bt = transpose(b.d, b.w, b.h)
  for (const q of axisWalls(bt, b.h, b.w, o)) walls.push({ a: toMm(b, q.p + 0.5, q.t0), b: toMm(b, q.p + 0.5, q.t1 + 1), thickness: Math.round(q.thick * k) })
  return mergeStacked(joinPieces(walls, 60))
    .filter((p) => Math.hypot(p.b.x - p.a.x, p.b.y - p.a.y) >= 1000)
    .map((p, i): Wall => ({ id: `p${i + 1}`, ...p, phase: 'existing' }))
}

if (process.argv[1]?.endsWith('pairs.mts')) {
  const [tile = '154w', out, mutual = '1'] = process.argv.slice(2)
  const b = await tileBits(TILES[tile])
  const walls = pairWalls(b, { ...DEFAULTS, mutual: mutual === '1' })
  const s = scoreTile(tile, walls)
  console.log(tile, 'pairs', `${walls.length} walls`, `recall100 ${s.recall['100']}`, `recall50 ${s.recall['50']}`, `precision100 ${s.precision100}`, `median ${s.medianOffsetMm}`)
  if (out) {
    const g = { w: b.w, h: b.h, data: new Uint8Array(b.d.length) }
    for (let i = 0; i < b.d.length; i++) g.data[i] = b.d[i] ? 0 : 255
    // overlay() reads the image in crop coordinates: give it a crop-sized image with the tile pasted in.
    const full = { w: 1411, h: 1740, data: new Uint8Array(1411 * 1740).fill(255) }
    for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) full.data[(b.y0 + y) * full.w + b.x0 + x] = g.data[y * b.w + x]
    await overlay(tile, walls, full, out)
  }
}
