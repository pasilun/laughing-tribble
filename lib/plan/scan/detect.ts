import type { Pt } from '../types'
import { toMm, toPx, type Gray, type Raster } from './raster'
import type { Rect } from './view'

// Finds horizontal and vertical walls in a source drawing: either a filled
// band of ink, or two parallel outlines a wall-thickness apart. Returns
// proposals for Claude to review — never applied directly.

export type Proposal = { a: Pt; b: Pt; thickness: number; style: 'filled' | 'outline'; confidence: number }

export type DetectOptions = {
  rect?: Rect
  minLengthMm?: number
  minThicknessMm?: number
  maxThicknessMm?: number
  threshold?: number
}

type Band = { y0: number; y1: number; x0: number; x1: number; rows: number }

// Bands of ink along rows: consecutive rows with overlapping long runs.
function bands(g: Gray, x0: number, x1: number, y0: number, y1: number, minRun: number, threshold: number): Band[] {
  const done: Band[] = []
  let active: Band[] = []
  for (let y = y0; y < y1; y++) {
    const runs: Array<[number, number]> = []
    let s = -1
    for (let x = x0; x <= x1; x++) {
      const dark = x < x1 && g.data[y * g.w + x] < threshold
      if (dark && s < 0) s = x
      if (!dark && s >= 0) {
        if (x - s >= minRun) runs.push([s, x])
        s = -1
      }
    }
    const next: Band[] = []
    for (const [a, b] of runs) {
      const m = active.find((k) => Math.min(k.x1, b) - Math.max(k.x0, a) >= 0.7 * Math.min(k.x1 - k.x0, b - a))
      if (m) {
        active = active.filter((k) => k !== m)
        next.push({ y0: m.y0, y1: y + 1, x0: Math.min(m.x0, a), x1: Math.max(m.x1, b), rows: m.rows + 1 })
      } else next.push({ y0: y, y1: y + 1, x0: a, x1: b, rows: 1 })
    }
    done.push(...active)
    active = next
  }
  return [...done, ...active]
}

function transpose(g: Gray): Gray {
  const out = new Uint8Array(g.w * g.h)
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) out[x * g.h + y] = g.data[y * g.w + x]
  return { data: out, w: g.h, h: g.w }
}

// Walls along rows of `g`, in that image's px: [x0, x1, yCentre, thicknessPx, style, confidence].
function rowWalls(g: Gray, box: { x0: number; x1: number; y0: number; y1: number }, mmPerPx: number, o: Required<Omit<DetectOptions, 'rect'>>) {
  const minRun = Math.max(5, Math.round(o.minLengthMm / mmPerPx))
  const all = bands(g, box.x0, box.x1, box.y0, box.y1, minRun, o.threshold)
  const lineMax = Math.max(3.5, 35 / mmPerPx)
  const out: Array<{ x0: number; x1: number; y: number; t: number; style: 'filled' | 'outline'; confidence: number }> = []
  const tMin = o.minThicknessMm / mmPerPx
  const tMax = o.maxThicknessMm / mmPerPx
  for (const b of all) {
    const t = b.y1 - b.y0
    if (t > lineMax && t >= tMin && t <= tMax) out.push({ x0: b.x0, x1: b.x1, y: (b.y0 + b.y1) / 2, t, style: 'filled', confidence: Math.min(1, b.rows / t) })
  }
  // Pair thin lines: nearest partner below within the thickness range.
  const lines = all.filter((b) => b.y1 - b.y0 <= lineMax).sort((p, q) => p.y0 - q.y0)
  const used = new Set<Band>()
  for (const l of lines) {
    if (used.has(l)) continue
    let best: { m: Band; ov: number } | null = null
    for (const m of lines) {
      if (m === l || used.has(m) || m.y0 <= l.y0) continue
      const span = m.y1 - l.y0
      if (span < tMin) continue
      if (span > tMax) break
      const ov = Math.min(l.x1, m.x1) - Math.max(l.x0, m.x0)
      const ratio = ov / Math.max(l.x1 - l.x0, m.x1 - m.x0)
      if (ov >= minRun && ratio >= 0.5 && (!best || ratio > best.ov)) best = { m, ov: ratio }
    }
    if (!best) continue
    used.add(l).add(best.m)
    out.push({
      x0: Math.max(l.x0, best.m.x0),
      x1: Math.min(l.x1, best.m.x1),
      y: (l.y0 + best.m.y1) / 2,
      t: best.m.y1 - l.y0,
      style: 'outline',
      confidence: Math.round(best.ov * 100) / 100,
    })
  }
  return out
}

export function detectWalls(g: Gray, r: Raster, opts: DetectOptions = {}): Proposal[] {
  const o = {
    minLengthMm: opts.minLengthMm ?? 500,
    minThicknessMm: opts.minThicknessMm ?? 60,
    maxThicknessMm: opts.maxThicknessMm ?? 500,
    threshold: opts.threshold ?? 128,
  }
  const rect = opts.rect
  const p0 = rect ? toPx(r, { x: rect.x, y: rect.y }) : { x: 0, y: 0 }
  const p1 = rect ? toPx(r, { x: rect.x + rect.w, y: rect.y + rect.h }) : { x: g.w, y: g.h }
  const box = {
    x0: Math.max(0, Math.floor(p0.x)),
    y0: Math.max(0, Math.floor(p0.y)),
    x1: Math.min(g.w, Math.ceil(p1.x)),
    y1: Math.min(g.h, Math.ceil(p1.y)),
  }
  const out: Proposal[] = []
  const mm = (p: Pt) => {
    const q = toMm(r, p)
    return { x: Math.round(q.x), y: Math.round(q.y) }
  }
  for (const w of rowWalls(g, box, r.mmPerPx, o))
    out.push({ a: mm({ x: w.x0, y: w.y }), b: mm({ x: w.x1, y: w.y }), thickness: Math.round(w.t * r.mmPerPx), style: w.style, confidence: w.confidence })
  const tg = transpose(g)
  for (const w of rowWalls(tg, { x0: box.y0, x1: box.y1, y0: box.x0, y1: box.x1 }, r.mmPerPx, o))
    out.push({ a: mm({ x: w.y, y: w.x0 }), b: mm({ x: w.y, y: w.x1 }), thickness: Math.round(w.t * r.mmPerPx), style: w.style, confidence: w.confidence })
  const len = (p: Proposal) => Math.hypot(p.b.x - p.a.x, p.b.y - p.a.y)
  return out.sort((p, q) => len(q) - len(p)).slice(0, 150)
}
