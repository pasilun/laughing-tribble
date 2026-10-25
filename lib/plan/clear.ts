import { leftNormal, wallDir, wallLength, wallQuad } from './geometry'
import type { Plan, Wall } from './types'

// An opening stays clear of the walls it meets: a window must not run into a
// corner wall, and a door must not sit against a stair wall. Positions are
// along the wall, in mm from its a-end.

export const CLEAR_MM = 100

// Other walls whose outline lies inside this wall's band, as spans along it.
// Outlines are sampled, so oblique walls work too.
export function blockers(plan: Plan, wall: Wall): Array<{ id: string; a: number; b: number }> {
  const d = wallDir(wall)
  const n = leftNormal(d)
  const h = wall.thickness / 2
  const out: Array<{ id: string; a: number; b: number }> = []
  for (const o of plan.walls) {
    if (o.id === wall.id) continue
    const q = wallQuad(o)
    let lo = Infinity
    let hi = -Infinity
    for (let i = 0; i < q.length; i++) {
      const p = q[i]
      const r = q[(i + 1) % q.length]
      const steps = Math.max(1, Math.ceil(Math.hypot(r.x - p.x, r.y - p.y) / 10))
      for (let k = 0; k <= steps; k++) {
        const x = p.x + ((r.x - p.x) * k) / steps - wall.a.x
        const y = p.y + ((r.y - p.y) * k) / steps - wall.a.y
        if (Math.abs(x * n.x + y * n.y) > h) continue
        const t = x * d.x + y * d.y
        lo = Math.min(lo, t)
        hi = Math.max(hi, t)
      }
    }
    if (hi >= lo) out.push({ id: o.id, a: lo, b: hi })
  }
  return out
}

// Walls whose outline an opening of this span runs into (10 mm tolerance).
export function clashes(plan: Plan, wall: Wall, offset: number, width: number): string[] {
  return blockers(plan, wall)
    .filter((b) => Math.min(b.b, offset + width - 10) - Math.max(b.a, offset + 10) > 0)
    .map((b) => b.id)
}

// Where an opening can go along the wall: clear of the blockers by CLEAR_MM.
export function freeSpans(plan: Plan, wall: Wall): Array<[number, number]> {
  const len = wallLength(wall)
  const blocked = blockers(plan, wall)
    .map((b) => [b.a - CLEAR_MM, b.b + CLEAR_MM] as [number, number])
    .sort((p, q) => p[0] - q[0])
  const free: Array<[number, number]> = []
  let cur = 0
  for (const [a, b] of blocked) {
    if (a > cur) free.push([cur, Math.min(a, len)])
    cur = Math.max(cur, b)
  }
  if (cur < len) free.push([cur, len])
  return free.filter(([a, b]) => b > a)
}

// A window with a known width: the part of its span that is free, or null
// when less than minWidth of it is. Used for drawn openings.
export function clipToFree(plan: Plan, wall: Wall, offset: number, width: number, minWidth = 300): { offset: number; width: number } | null {
  let best: [number, number] | null = null
  for (const [a, b] of freeSpans(plan, wall)) {
    const lo = Math.max(a, offset)
    const hi = Math.min(b, offset + width)
    if (hi - lo > (best ? best[1] - best[0] : 0)) best = [lo, hi]
  }
  if (!best || best[1] - best[0] < minWidth) return null
  return { offset: Math.round(best[0]), width: Math.round(best[1] - best[0]) }
}

// An opening of unknown width (a centre mark) only fixes its centre to about
// ±0.2 m: move it along the wall, by the least that clears the walls it meets.
// Null when no place within maxShift does.
export function shiftToFree(plan: Plan, wall: Wall, offset: number, width: number, maxShift = 250): number | null {
  const free = freeSpans(plan, wall)
  const fits = (o: number) => free.some(([a, b]) => o >= a && o + width <= b)
  if (fits(offset)) return offset
  for (let s = 10; s <= maxShift; s += 10) {
    for (const o of [offset + s, offset - s]) if (o >= 0 && fits(o)) return Math.round(o)
  }
  return null
}
