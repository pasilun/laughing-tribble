import type { Opening, Plan, Pt, Wall } from './types'

export function dist(a: Pt, b: Pt): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

export function wallLength(w: Wall): number {
  return dist(w.a, w.b)
}

// Unit vector along the wall, a → b.
export function wallDir(w: Wall): Pt {
  const len = wallLength(w) || 1
  return { x: (w.b.x - w.a.x) / len, y: (w.b.y - w.a.y) / len }
}

// Unit normal to the left of a → b (in y-down coordinates "left" is (dy, -dx)).
export function leftNormal(d: Pt): Pt {
  return { x: d.y, y: -d.x }
}

export function along(w: Wall, t: number): Pt {
  const d = wallDir(w)
  return { x: w.a.x + d.x * t, y: w.a.y + d.y * t }
}

export function add(a: Pt, b: Pt): Pt {
  return { x: a.x + b.x, y: a.y + b.y }
}

export function scale(a: Pt, k: number): Pt {
  return { x: a.x * k, y: a.y * k }
}

// The four corners of a wall body, in order a-left, b-left, b-right, a-right.
export function wallQuad(w: Wall): Pt[] {
  const n = scale(leftNormal(wallDir(w)), w.thickness / 2)
  return [add(w.a, n), add(w.b, n), add(w.b, scale(n, -1)), add(w.a, scale(n, -1))]
}

export function polygonArea(pts: Pt[]): number {
  let s = 0
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length
    s += pts[i].x * pts[j].y - pts[j].x * pts[i].y
  }
  return Math.abs(s / 2)
}

export function pointSegmentDistance(p: Pt, a: Pt, b: Pt): { d: number; t: number } {
  const len2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2
  if (len2 === 0) return { d: dist(p, a), t: 0 }
  let t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / len2
  t = Math.max(0, Math.min(1, t))
  return { d: dist(p, { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) }), t }
}

// Solid segments of a wall after cutting out the openings shown in a view.
export function wallSegments(w: Wall, openings: Opening[]): Array<[number, number]> {
  const len = wallLength(w)
  const cuts = openings
    .filter((o) => o.wallId === w.id)
    .map((o) => [Math.max(0, o.offset), Math.min(len, o.offset + o.width)] as [number, number])
    .sort((p, q) => p[0] - q[0])
  const segs: Array<[number, number]> = []
  let cur = 0
  for (const [s, e] of cuts) {
    if (s > cur) segs.push([cur, s])
    cur = Math.max(cur, e)
  }
  if (cur < len) segs.push([cur, len])
  return segs
}

export function bounds(plan: Plan): { minX: number; minY: number; maxX: number; maxY: number } {
  const pts: Pt[] = []
  for (const w of plan.walls) pts.push(...wallQuad(w))
  for (const m of plan.masses ?? []) pts.push(...m.points)
  for (const f of plan.fixtures) pts.push({ x: f.x - f.w / 2, y: f.y - f.d / 2 }, { x: f.x + f.w / 2, y: f.y + f.d / 2 })
  for (const r of plan.rooms) pts.push(r.at)
  if (pts.length === 0) return { minX: 0, minY: 0, maxX: 1000, maxY: 1000 }
  return {
    minX: Math.min(...pts.map((p) => p.x)),
    minY: Math.min(...pts.map((p) => p.y)),
    maxX: Math.max(...pts.map((p) => p.x)),
    maxY: Math.max(...pts.map((p) => p.y)),
  }
}

export function roundMm(v: number): number {
  return Math.round(v)
}
