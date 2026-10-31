// Plain geometry for site plans. Coordinates are metres in the map's own grid (SWEREF 99 TM:
// x = easting, y = northing, y up), not the plan editor's millimetres with y down.

export type P = { x: number; y: number }

export const dist = (a: P, b: P) => Math.hypot(b.x - a.x, b.y - a.y)

export function area(ring: P[]): number {
  let s = 0
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % ring.length]
    s += a.x * b.y - b.x * a.y
  }
  return Math.abs(s) / 2
}

export function centroid(ring: P[]): P {
  let a = 0
  let cx = 0
  let cy = 0
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i]
    const q = ring[(i + 1) % ring.length]
    const f = p.x * q.y - q.x * p.y
    a += f
    cx += (p.x + q.x) * f
    cy += (p.y + q.y) * f
  }
  return a === 0 ? ring[0] : { x: cx / (3 * a), y: cy / (3 * a) }
}

export function bbox(pts: P[]) {
  return { minX: Math.min(...pts.map((p) => p.x)), maxX: Math.max(...pts.map((p) => p.x)), minY: Math.min(...pts.map((p) => p.y)), maxY: Math.max(...pts.map((p) => p.y)) }
}

export function closestOnSegment(p: P, a: P, b: P): P {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const l2 = dx * dx + dy * dy
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2))
  return { x: a.x + t * dx, y: a.y + t * dy }
}

export function pointInRing(p: P, ring: P[]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]
    const b = ring[j]
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

// The shortest line between two closed outlines: [from a point of `a`, to a point of `b`].
export function shortest(a: P[], b: P[]): { from: P; to: P; d: number } {
  let best = { from: a[0], to: b[0], d: Infinity }
  const edges = (r: P[]) => r.map((p, i) => [p, r[(i + 1) % r.length]] as const)
  for (const p of a)
    for (const [s, e] of edges(b)) {
      const q = closestOnSegment(p, s, e)
      const d = dist(p, q)
      if (d < best.d) best = { from: p, to: q, d }
    }
  for (const p of b)
    for (const [s, e] of edges(a)) {
      const q = closestOnSegment(p, s, e)
      const d = dist(p, q)
      if (d < best.d) best = { from: q, to: p, d }
    }
  return best
}

export function hull(points: P[]): P[] {
  const pts = [...points].sort((p, q) => p.x - q.x || p.y - q.y)
  if (pts.length < 3) return pts
  const cross = (o: P, a: P, b: P) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
  const lower: P[] = []
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop()
    lower.push(p)
  }
  const upper: P[] = []
  for (const p of [...pts].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop()
    upper.push(p)
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)]
}

// The smallest rectangle (any angle) around a set of points: corners in order, plus its sides.
export function minRect(points: P[]): { corners: P[]; width: number; depth: number; angle: number } {
  const h = hull(points)
  let best: { corners: P[]; width: number; depth: number; angle: number; a: number } | null = null
  for (let i = 0; i < h.length; i++) {
    const p = h[i]
    const q = h[(i + 1) % h.length]
    const ang = Math.atan2(q.y - p.y, q.x - p.x)
    const c = Math.cos(-ang)
    const s = Math.sin(-ang)
    const r = h.map((v) => ({ x: v.x * c - v.y * s, y: v.x * s + v.y * c }))
    const b = bbox(r)
    const w = b.maxX - b.minX
    const d = b.maxY - b.minY
    if (!best || w * d < best.a) {
      const back = (x: number, y: number): P => ({ x: x * Math.cos(ang) - y * Math.sin(ang), y: x * Math.sin(ang) + y * Math.cos(ang) })
      best = { a: w * d, width: w, depth: d, angle: ang, corners: [back(b.minX, b.minY), back(b.maxX, b.minY), back(b.maxX, b.maxY), back(b.minX, b.maxY)] }
    }
  }
  if (!best) return { corners: points, width: 0, depth: 0, angle: 0 }
  // Long side first, angle folded to (-90°, 90°].
  let { width, depth, angle } = best
  if (depth > width) {
    ;[width, depth] = [depth, width]
    angle += Math.PI / 2
  }
  while (angle > Math.PI / 2) angle -= Math.PI
  while (angle <= -Math.PI / 2) angle += Math.PI
  return { corners: best.corners, width, depth, angle }
}
