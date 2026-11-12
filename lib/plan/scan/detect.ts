import type { Pt } from '../domain/types'
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
  // At most this many proposals, longest first (default 150: what a person or Claude can review).
  maxProposals?: number
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
      const ov = (k: Band) => Math.min(k.x1, b) - Math.max(k.x0, a)
      const hits = active.filter((k) => ov(k) >= 0.7 * Math.min(k.x1 - k.x0, b - a))
      if (!hits.length) next.push({ y0: y, y1: y + 1, x0: a, x1: b, rows: 1 })
      active = active.filter((k) => !hits.includes(k))
      // A run much longer than a band (a window's glass lines joining the
      // wall pieces either side) carries each band on without widening it.
      for (const m of hits) {
        const grow = ov(m) >= 0.7 * Math.max(m.x1 - m.x0, b - a)
        next.push({ y0: m.y0, y1: y + 1, x0: grow ? Math.min(m.x0, a) : m.x0, x1: grow ? Math.max(m.x1, b) : m.x1, rows: m.rows + 1 })
      }
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
function rowWalls(g: Gray, box: { x0: number; x1: number; y0: number; y1: number }, mmPerPx: number, o: Required<Omit<DetectOptions, 'rect' | 'maxProposals'>>) {
  const minRun = Math.max(5, Math.round(o.minLengthMm / mmPerPx))
  const all = bands(g, box.x0, box.x1, box.y0, box.y1, minRun, o.threshold)
  // Archive scans draw walls with pens up to ~1 mm at 1:100, i.e. lines up
  // to ~120 mm thick in plan terms: anything that thin may be one face of an
  // outlined wall, so pairing comes first.
  const lineMax = Math.max(3.5, 130 / mmPerPx)
  const thin = Math.max(3.5, 35 / mmPerPx)
  const out: Array<{ x0: number; x1: number; y: number; t: number; style: 'filled' | 'outline'; confidence: number }> = []
  const tMin = o.minThicknessMm / mmPerPx
  const tMax = o.maxThicknessMm / mmPerPx
  const mid = (b: Band) => (b.y0 + b.y1) / 2
  // Pair lines: two face lines a wall thickness apart, thickness measured line centre to line centre (lines
  // straddle the wall faces). A face is often broken where a crossing wall meets it while the opposite face runs
  // on, so a long line pairs with each shorter line along it, over the stretch they share: the overlap must be
  // most of the shorter line, not of the longer. The pair must be neighbours: no third line between them over
  // that stretch (else the outer face of one wall would pair with the far face of the next).
  const lines = all.filter((b) => b.y1 - b.y0 <= lineMax).sort((p, q) => p.y0 - q.y0)
  const used = new Set<Band>()
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    for (let j = i + 1; j < lines.length; j++) {
      const m = lines[j]
      if (m.y0 <= l.y1) continue
      const span = mid(m) - mid(l)
      if (span < tMin) continue
      if (span > tMax) break
      const x0 = Math.max(l.x0, m.x0)
      const x1 = Math.min(l.x1, m.x1)
      const ov = x1 - x0
      const ratio = ov / Math.min(l.x1 - l.x0, m.x1 - m.x0)
      if (ov < minRun || ratio < 0.7) continue
      const between = lines.some((k) => k !== l && k !== m && mid(k) > mid(l) && mid(k) < mid(m) && Math.min(k.x1, x1) - Math.max(k.x0, x0) >= 0.5 * ov)
      if (between) continue
      used.add(l).add(m)
      out.push({ x0, x1, y: (mid(l) + mid(m)) / 2, t: span, style: 'outline', confidence: Math.round(Math.min(1, ov / Math.max(l.x1 - l.x0, m.x1 - m.x0) + 0.3) * 100) / 100 })
    }
  }
  // Unpaired bands thick enough to be a wall: a filled wall. One as thin as
  // a pen line is more likely a lone line (furniture, a dimension), so it
  // gets a low confidence.
  for (const b of all) {
    if (used.has(b)) continue
    const t = b.y1 - b.y0
    if (t > thin && t >= tMin && t <= tMax)
      out.push({ x0: b.x0, x1: b.x1, y: mid(b), t, style: 'filled', confidence: t > lineMax ? Math.min(1, b.rows / t) : 0.4 })
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
  return out.sort((p, q) => len(q) - len(p)).slice(0, opts.maxProposals ?? 150)
}
