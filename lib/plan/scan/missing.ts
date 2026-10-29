import { pointSegmentDistance } from '../geometry'
import type { Plan, Pt } from '../types'
import type { Proposal } from './detect'

// Walls the drawings show and the plan lacks. Each drawing's wall proposals
// are grouped across drawings (same line, overlapping), a wall that two or
// more drawings agree on is kept, and what the plan already covers is dropped.
// A candidate to look at in the images, not a wall to add unseen: handwriting
// and fixtures also make long strokes.

export type MissingWall = {
  a: Pt
  b: Pt
  thickness: number
  sources: string[]
  confidence: number // mean over the drawings
  covered: number // share of its length within reach of a plan wall (0–1)
}

type Item = { source: string; vertical: boolean; c: number; t0: number; t1: number; thickness: number; confidence: number }

function itemOf(source: string, p: Proposal): Item {
  const vertical = Math.abs(p.b.x - p.a.x) < Math.abs(p.b.y - p.a.y)
  return vertical
    ? { source, vertical, c: (p.a.x + p.b.x) / 2, t0: Math.min(p.a.y, p.b.y), t1: Math.max(p.a.y, p.b.y), thickness: p.thickness, confidence: p.confidence }
    : { source, vertical, c: (p.a.y + p.b.y) / 2, t0: Math.min(p.a.x, p.b.x), t1: Math.max(p.a.x, p.b.x), thickness: p.thickness, confidence: p.confidence }
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export function missingWalls(
  plan: Plan,
  found: Array<{ source: string; proposals: Proposal[] }>,
  opts: { minSources?: number; posMm?: number; reachMm?: number; maxCovered?: number } = {},
): MissingWall[] {
  const posMm = opts.posMm ?? 200 // drawings are registered to about this
  const reachMm = opts.reachMm ?? 150
  const maxCovered = opts.maxCovered ?? 0.5
  const minSources = Math.min(opts.minSources ?? 2, found.length)

  // Longest first, so a cluster is seeded by the best-drawn line.
  const items = found.flatMap((f) => f.proposals.map((p) => itemOf(f.source, p))).sort((a, b) => b.t1 - b.t0 - (a.t1 - a.t0))
  const clusters: Item[][] = []
  for (const it of items) {
    const home = clusters.find((cl) => {
      const seed = cl[0]
      if (seed.vertical !== it.vertical || Math.abs(seed.c - it.c) > posMm) return false
      if (cl.some((x) => x.source === it.source)) return false // one line per drawing
      return Math.min(seed.t1, it.t1) - Math.max(seed.t0, it.t0) >= 0.5 * Math.min(seed.t1 - seed.t0, it.t1 - it.t0)
    })
    if (home) home.push(it)
    else clusters.push([it])
  }

  const out: MissingWall[] = []
  for (const cl of clusters) {
    const sources = [...new Set(cl.map((x) => x.source))]
    if (sources.length < minSources) continue
    const c = median(cl.map((x) => x.c))
    const t0 = median(cl.map((x) => x.t0))
    const t1 = median(cl.map((x) => x.t1))
    const pt = (t: number): Pt => (cl[0].vertical ? { x: c, y: t } : { x: t, y: c })
    let covered = 0
    let n = 0
    for (let t = t0; t <= t1; t += 50) {
      n++
      const p = pt(t)
      if (plan.walls.some((w) => pointSegmentDistance(p, w.a, w.b).d <= w.thickness / 2 + reachMm)) covered++
    }
    const share = n ? covered / n : 1
    if (share >= maxCovered) continue
    out.push({
      a: { x: Math.round(pt(t0).x), y: Math.round(pt(t0).y) },
      b: { x: Math.round(pt(t1).x), y: Math.round(pt(t1).y) },
      thickness: Math.round(median(cl.map((x) => x.thickness))),
      sources,
      confidence: Math.round((cl.reduce((s, x) => s + x.confidence, 0) / cl.length) * 100) / 100,
      covered: Math.round(share * 100) / 100,
    })
  }
  // Most drawings agreeing first, then the longest.
  const len = (m: MissingWall) => Math.hypot(m.b.x - m.a.x, m.b.y - m.a.y)
  return out.sort((p, q) => q.sources.length - p.sources.length || len(q) - len(p))
}
