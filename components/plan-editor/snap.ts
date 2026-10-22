import { dist, pointSegmentDistance } from '@/lib/plan/geometry'
import type { Plan, Pt } from '@/lib/plan/types'

export type SnapKind = 'endpoint' | 'onwall' | 'axis' | 'align' | 'grid'
export type Snap = { pt: Pt; kind: SnapKind; wallId?: string; guide?: { from: Pt; to: Pt } }

export type SnapOptions = {
  from?: Pt          // start of the wall/dimension being drawn
  tolerance: number  // mm (screen pixels / zoom)
  grid: number       // mm
  orthoAngle?: number // degrees
  exclude?: string   // wall id to ignore (the one being dragged)
}

// Snapping in priority order, like SketchUp's inference: wall ends, then the
// axis of an existing wall, then horizontal/vertical from the start point,
// then alignment with other wall ends, then the grid.
export function snapPoint(raw: Pt, plan: Plan, opts: SnapOptions): Snap {
  const { tolerance: tol, grid } = opts
  const walls = plan.walls.filter((w) => w.id !== opts.exclude)
  const ends = walls.flatMap((w) => [w.a, w.b])

  let best: Pt | null = null
  let bestD = tol
  for (const p of ends) {
    const d = dist(p, raw)
    if (d <= bestD) {
      best = p
      bestD = d
    }
  }
  if (best) return { pt: { ...best }, kind: 'endpoint' }

  const roundG = (v: number) => Math.round(v / grid) * grid

  // Horizontal / vertical from the start point.
  let pt = { ...raw }
  let kind: SnapKind | null = null
  if (opts.from) {
    const dx = raw.x - opts.from.x
    const dy = raw.y - opts.from.y
    const tan = Math.tan(((opts.orthoAngle ?? 7) * Math.PI) / 180)
    if (Math.abs(dy) <= Math.abs(dx) * tan) {
      pt = { x: raw.x, y: opts.from.y }
      kind = 'axis'
    } else if (Math.abs(dx) <= Math.abs(dy) * tan) {
      pt = { x: opts.from.x, y: raw.y }
      kind = 'axis'
    }
  }

  // Onto an existing wall's axis (T-junctions). On an axis-constrained line,
  // take the intersection with the wall instead of the perpendicular foot.
  for (const w of walls) {
    const { d, t } = pointSegmentDistance(pt, w.a, w.b)
    if (d > tol) continue
    if (kind === 'axis' && opts.from) {
      const hit = intersectAxis(opts.from, pt, w.a, w.b)
      if (hit) return { pt: round1(hit), kind: 'onwall', wallId: w.id }
      continue
    }
    return { pt: round1({ x: w.a.x + (w.b.x - w.a.x) * t, y: w.a.y + (w.b.y - w.a.y) * t }), kind: 'onwall', wallId: w.id }
  }

  // Alignment with other wall ends (free coordinate only).
  let guide: Snap['guide']
  const freeX = !(kind === 'axis' && opts.from && pt.x === opts.from.x)
  const freeY = !(kind === 'axis' && opts.from && pt.y === opts.from.y)
  if (freeX) {
    const e = ends.find((p) => Math.abs(p.x - pt.x) <= tol)
    if (e) {
      pt = { ...pt, x: e.x }
      guide = { from: e, to: pt }
      kind = kind ?? 'align'
    }
  }
  if (freeY) {
    const e = ends.find((p) => Math.abs(p.y - pt.y) <= tol)
    if (e) {
      pt = { ...pt, y: e.y }
      guide = { from: e, to: pt }
      kind = kind ?? 'align'
    }
  }

  // Grid for whatever is still free.
  const out = {
    x: kind === 'axis' && opts.from && pt.x === opts.from.x ? pt.x : guide && pt.x === guide.from.x ? pt.x : roundG(pt.x),
    y: kind === 'axis' && opts.from && pt.y === opts.from.y ? pt.y : guide && pt.y === guide.from.y ? pt.y : roundG(pt.y),
  }
  return { pt: out, kind: kind ?? 'grid', guide }
}

function round1(p: Pt): Pt {
  return { x: Math.round(p.x), y: Math.round(p.y) }
}

// Intersection of the infinite line through a1→a2 with segment b1–b2.
function intersectAxis(a1: Pt, a2: Pt, b1: Pt, b2: Pt): Pt | null {
  const d = { x: a2.x - a1.x, y: a2.y - a1.y }
  const e = { x: b2.x - b1.x, y: b2.y - b1.y }
  const den = d.x * e.y - d.y * e.x
  if (Math.abs(den) < 1e-9) return null
  const u = ((b1.x - a1.x) * d.y - (b1.y - a1.y) * d.x) / den
  if (u < 0 || u > 1) return null
  return { x: b1.x + e.x * u, y: b1.y + e.y * u }
}

// End point at a typed length along the direction from `from` to `toward`.
export function atLength(from: Pt, toward: Pt, length: number): Pt {
  const d = dist(from, toward)
  if (d < 1e-6) return { x: from.x + length, y: from.y }
  return { x: Math.round(from.x + ((toward.x - from.x) / d) * length), y: Math.round(from.y + ((toward.y - from.y) / d) * length) }
}
