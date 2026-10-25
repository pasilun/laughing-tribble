import { along, leftNormal, wallDir, wallLength } from '../geometry'
import type { Opening, Plan, Wall } from '../types'
import { dark, toPx, type Gray, type Raster } from './raster'
import { snapWall } from './snap'

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
  // How much of the wall's band is ink at each step: faces, hatching or fill.
  // Drawings mark doorways differently (both faces stopped, one face dashed,
  // thin lines or ticks across), but always with clearly less ink than the
  // wall either side — so gaps are judged against the wall's own median.
  const ts: number[] = []
  const cover: number[] = []
  for (let t = margin; t <= len - margin + 1e-6; t += step) {
    const c = along(wall, t)
    let hit = 0
    let tot = 0
    for (let s = -1; s <= 1.0001; s += 0.25) {
      tot++
      if (inkNear(g, r, c.x + n.x * s * half, c.y + n.y * s * half, th)) hit++
    }
    ts.push(t)
    cover.push(hit / tot)
  }
  if (!cover.length) return []
  // Smooth over ~100 mm so dashes read as a lighter stretch, not as gaps.
  const k = Math.max(1, Math.round(50 / step))
  const smooth = cover.map((_, i) => {
    let s = 0
    let m = 0
    for (let j = Math.max(0, i - k); j <= Math.min(cover.length - 1, i + k); j++) {
      s += cover[j]
      m++
    }
    return s / m
  })
  const sorted = [...smooth].sort((a, b) => a - b)
  const median = sorted[sorted.length >> 1]
  const limit = Math.max(0.12, Math.min(0.45, median * 0.5))
  const gaps: Gap[] = []
  let start = -1
  for (let i = 0; i <= smooth.length; i++) {
    const open = i < smooth.length && smooth[i] < limit
    if (open && start < 0) start = i
    if (!open && start >= 0) {
      // Smoothing eats into the gap by its radius at each end: give it back.
      const s0 = Math.max(0, ts[start] - k * step)
      const s1 = Math.min(len, ts[i - 1] + step + k * step)
      const w = s1 - s0
      if (w >= minW && w <= maxW) gaps.push({ wallId: wall.id, offset: Math.round(s0), width: Math.round(w) })
      start = -1
    }
  }
  return gaps
}

// New openings for the plan: gaps not already covered by an opening there.
// The source may draw a wall a little off the plan's line (another drawing,
// measured differently): each wall is first located in the source with the
// snap fit, gaps are read along that line, and walls the source doesn't
// show are skipped rather than read as one long gap.
export function newOpenings(g: Gray, r: Raster, plan: Plan, ids?: string[], threshold?: number): { openings: Opening[]; skipped: string[]; located: Map<Wall, Wall> } {
  const out: Opening[] = []
  const skipped: string[] = []
  const located = new Map<Wall, Wall>()
  for (const w of plan.walls) {
    if (ids && !ids.includes(w.id)) continue
    const fit = snapWall(g, r, w, [], { threshold, square: true })
    if (!fit.wall || !fit.report.ok) {
      skipped.push(w.id)
      continue
    }
    const drawn = fit.wall
    located.set(w, drawn)
    // Offsets on the drawn line → offsets on the plan's wall.
    const d = wallDir(w)
    const shift = (drawn.a.x - w.a.x) * d.x + (drawn.a.y - w.a.y) * d.y
    const existing = plan.openings.filter((o) => o.wallId === w.id)
    for (const gp of findGaps(g, r, drawn, { threshold })) {
      const offset = Math.round(gp.offset + shift)
      if (offset < 0 || offset + gp.width > wallLength(w)) continue
      const overlaps = existing.some((o) => Math.min(o.offset + o.width, offset + gp.width) - Math.max(o.offset, offset) > 0)
      if (overlaps) continue
      out.push({ id: `o-${w.id}-${out.filter((o) => o.wallId === w.id).length + 1}`, wallId: w.id, kind: 'opening', offset, width: gp.width, phase: 'existing' })
    }
  }
  return { openings: out, skipped, located }
}
