import { along, leftNormal, wallDir, wallLength } from '../geometry'
import type { Opening, Plan, Wall } from '../types'
import { dark, toPx, type Gray, type Raster } from './raster'

// Finds openings in walls from the source drawing: where both of a wall's
// drawn faces stop (and the wall body isn't filled), there is a gap in the
// wall. Gaps of door width and up are returned as openings; which of them
// are doors, and which way those open, is for readDoors to decide.

export type Gap = { wallId: string; offset: number; width: number }

function inkNear(g: Gray, r: Raster, x: number, y: number, threshold: number): boolean {
  const p = toPx(r, { x, y })
  for (const dx of [-1, 0, 1]) for (const dy of [-1, 0, 1]) if (dark(g, p.x + dx, p.y + dy, threshold)) return true
  return false
}

export function findGaps(g: Gray, r: Raster, wall: Wall, opts: { minWidth?: number; maxWidth?: number; endMargin?: number; threshold?: number } = {}): Gap[] {
  const minW = opts.minWidth ?? 450
  const maxW = opts.maxWidth ?? 2600
  const th = opts.threshold ?? 128
  const len = wallLength(wall)
  const d = wallDir(wall)
  const n = leftNormal(d)
  const half = wall.thickness / 2
  // Stay clear of the ends: crossing walls fill them.
  const margin = opts.endMargin ?? Math.max(60, half)
  const step = Math.max(5, r.mmPerPx / 2)
  const gaps: Gap[] = []
  let start = -1
  for (let t = margin; t <= len - margin + 1e-6; t += step) {
    const c = along(wall, t)
    const face = (s: number) => inkNear(g, r, c.x + n.x * s * half, c.y + n.y * s * half, th)
    const open = !face(1) && !face(-1) && !inkNear(g, r, c.x, c.y, th)
    if (open && start < 0) start = t
    if ((!open || t + step > len - margin) && start >= 0) {
      const end = open ? t : t - step
      const w = end - start
      if (w >= minW && w <= maxW) gaps.push({ wallId: wall.id, offset: Math.round(start), width: Math.round(w) })
      start = -1
    }
  }
  return gaps
}

// New openings for the plan: gaps not already covered by an opening there.
export function newOpenings(g: Gray, r: Raster, plan: Plan, ids?: string[], threshold?: number): Opening[] {
  const out: Opening[] = []
  for (const w of plan.walls) {
    if (ids && !ids.includes(w.id)) continue
    const existing = plan.openings.filter((o) => o.wallId === w.id)
    for (const gp of findGaps(g, r, w, { threshold })) {
      const overlaps = existing.some((o) => Math.min(o.offset + o.width, gp.offset + gp.width) - Math.max(o.offset, gp.offset) > 0)
      if (overlaps) continue
      out.push({ id: `o-${w.id}-${out.filter((o) => o.wallId === w.id).length + 1}`, wallId: w.id, kind: 'opening', offset: gp.offset, width: gp.width, phase: 'existing' })
    }
  }
  return out
}
