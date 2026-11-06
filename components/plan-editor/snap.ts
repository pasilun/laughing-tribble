import { dist, pointSegmentDistance, wallQuad } from '@/lib/plan/domain/geometry'
import type { Plan, Pt } from '@/lib/plan/domain/types'

type SnapKind = 'endpoint' | 'corner' | 'onwall' | 'face' | 'axis' | 'align' | 'grid'
export type Snap = { pt: Pt; kind: SnapKind; wallId?: string; guide?: { from: Pt; to: Pt } }

export type SnapOptions = {
  from?: Pt          // start of the wall/dimension being drawn
  tolerance: number  // mm (screen pixels / zoom)
  grid: number       // mm
  orthoAngle?: number // degrees
  exclude?: string   // wall id to ignore (the one being dragged)
  faces?: boolean    // also snap to the visible corners and the surfaces of walls, not only the centre line (measuring)
}

// Snapping in priority order, like SketchUp's inference: wall ends, then the
// axis of an existing wall, then horizontal/vertical from the start point,
// then alignment with other wall ends, then the grid.
export function snapPoint(raw: Pt, plan: Plan, opts: SnapOptions): Snap {
  const { tolerance: tol, grid } = opts
  const walls = plan.walls.filter((w) => w.id !== opts.exclude)
  const ends = walls.flatMap((w) => [w.a, w.b])

  let best: Pt | null = null
  let bestKind: SnapKind = 'endpoint'
  let bestD = tol
  for (const p of ends) {
    const d = dist(p, raw)
    if (d <= bestD) {
      best = p
      bestD = d
    }
  }
  // Measuring: the visible corners of the wall bodies compete with the centre-line ends; the nearer wins,
  // and a corner wins a tie.
  const quads = opts.faces ? walls.map((w) => ({ id: w.id, q: wallQuad(w) })) : []
  const near = quads.filter(({ q }) => {
    const xs = q.map((p) => p.x)
    const ys = q.map((p) => p.y)
    return raw.x >= Math.min(...xs) - tol && raw.x <= Math.max(...xs) + tol && raw.y >= Math.min(...ys) - tol && raw.y <= Math.max(...ys) + tol
  })
  const corners: Pt[] = []
  for (const { q } of near) corners.push(...q)
  // Where the surfaces of two walls cross (a T-junction or an L-corner) is a visible corner too.
  for (let i = 0; i < near.length; i++) {
    for (let j = i + 1; j < near.length; j++) {
      for (let a = 0; a < 4; a++) {
        for (let b = 0; b < 4; b++) {
          const hit = segmentCross(near[i].q[a], near[i].q[(a + 1) % 4], near[j].q[b], near[j].q[(b + 1) % 4])
          if (hit) corners.push(hit)
        }
      }
    }
  }
  for (const p of corners) {
    const d = dist(p, raw)
    if (d > bestD) continue
    if (quads.some((o) => insideStrict(p, o.q))) continue
    best = p
    bestD = d
    bestKind = 'corner'
  }
  if (best) return { pt: bestKind === 'corner' ? round1(best) : { ...best }, kind: bestKind }

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
  // When measuring, the two surfaces of a wall are lines to snap to as well; the nearest line wins.
  for (const w of walls) {
    const q = opts.faces ? wallQuad(w) : null
    const lines: Array<{ a: Pt; b: Pt; kind: SnapKind }> = [{ a: w.a, b: w.b, kind: 'onwall' }]
    if (q) lines.push({ a: q[0], b: q[1], kind: 'face' }, { a: q[3], b: q[2], kind: 'face' })
    let pick: { a: Pt; b: Pt; kind: SnapKind; t: number } | null = null
    let pickD = tol
    for (const l of lines) {
      const { d, t } = pointSegmentDistance(pt, l.a, l.b)
      if (d <= pickD) {
        pick = { ...l, t }
        pickD = d
      }
    }
    if (!pick) continue
    if (kind === 'axis' && opts.from) {
      const hit = intersectAxis(opts.from, pt, pick.a, pick.b)
      if (hit) return { pt: round1(hit), kind: pick.kind, wallId: w.id }
      continue
    }
    return { pt: round1({ x: pick.a.x + (pick.b.x - pick.a.x) * pick.t, y: pick.a.y + (pick.b.y - pick.a.y) * pick.t }), kind: pick.kind, wallId: w.id }
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

// Proper crossing of two segments (null when parallel or not touching).
function segmentCross(a1: Pt, a2: Pt, b1: Pt, b2: Pt): Pt | null {
  const d = { x: a2.x - a1.x, y: a2.y - a1.y }
  const e = { x: b2.x - b1.x, y: b2.y - b1.y }
  const den = d.x * e.y - d.y * e.x
  if (Math.abs(den) < 1e-9) return null
  const t = ((b1.x - a1.x) * e.y - (b1.y - a1.y) * e.x) / den
  const u = ((b1.x - a1.x) * d.y - (b1.y - a1.y) * d.x) / den
  if (t < 0 || t > 1 || u < 0 || u > 1) return null
  return { x: a1.x + d.x * t, y: a1.y + d.y * t }
}

// Strictly inside a convex wall body (more than 2 mm from its edge): a corner there is hidden by another wall.
function insideStrict(p: Pt, q: Pt[]): boolean {
  let sign = 0
  for (let i = 0; i < q.length; i++) {
    const a = q[i]
    const b = q[(i + 1) % q.length]
    const len = dist(a, b) || 1
    const cross = ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) / len
    if (Math.abs(cross) <= 2) return false
    const sg = cross > 0 ? 1 : -1
    if (sign === 0) sign = sg
    else if (sg !== sign) return false
  }
  return true
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

export type Justify = 'center' | 'left' | 'right'

// Tracing a scan you usually follow a wall's face, not its centre line.
// Converts a traced face segment to the wall's centre line; "left"/"right"
// is the side of the line (seen from a → b) where the wall body lies.
export function faceToCenter(a: Pt, b: Pt, thickness: number, justify: Justify): { a: Pt; b: Pt } {
  if (justify === 'center') return { a, b }
  const len = dist(a, b) || 1
  // Left normal in y-down coordinates.
  const n = { x: (b.y - a.y) / len, y: -(b.x - a.x) / len }
  const k = (justify === 'left' ? 1 : -1) * (thickness / 2)
  const o = { x: n.x * k, y: n.y * k }
  return { a: { x: Math.round(a.x + o.x), y: Math.round(a.y + o.y) }, b: { x: Math.round(b.x + o.x), y: Math.round(b.y + o.y) } }
}

// Where two consecutive centre lines meet, so a traced corner closes.
export function centerCorner(p1: Pt, p2: Pt, q1: Pt, q2: Pt): Pt | null {
  const d = { x: p2.x - p1.x, y: p2.y - p1.y }
  const e = { x: q2.x - q1.x, y: q2.y - q1.y }
  const den = d.x * e.y - d.y * e.x
  if (Math.abs(den) < 1e-6) return null
  const t = ((q1.x - p1.x) * e.y - (q1.y - p1.y) * e.x) / den
  return { x: Math.round(p1.x + d.x * t), y: Math.round(p1.y + d.y * t) }
}
