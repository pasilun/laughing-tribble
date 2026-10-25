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

// Doorways drawn as a dashed face: older Stockholm drawings outline each room
// as a closed figure and mark a door by dashing that outline across the
// doorway; the other face may stay solid. Each face line is located (the
// outline can sit a little off the wall's nominal face), sampled along the
// wall, and stretches that alternate ink and paper like dashes are openings.
// Junctions (breaks where another wall meets, passed in) and solid or
// missing lines are not dashes.
export function findDashed(g: Gray, r: Raster, wall: Wall, opts: { minWidth?: number; maxWidth?: number; endMargin?: number; threshold?: number; junctions?: Array<[number, number]> } = {}): Gap[] {
  const minW = opts.minWidth ?? 450
  const maxW = opts.maxWidth ?? 2600
  const th = opts.threshold ?? 128
  const len = wallLength(wall)
  const d = wallDir(wall)
  const n = leftNormal(d)
  const half = wall.thickness / 2
  const margin = opts.endMargin ?? Math.max(60, half)
  const step = r.mmPerPx / 2
  // Ink on a line across ±1 px only: dash gaps along the line must stay open.
  const inkAt = (t: number, off: number) => {
    const c = along(wall, t)
    for (const k of [-1, 0, 1]) {
      const p = toPx(r, { x: c.x + n.x * (off + k * r.mmPerPx), y: c.y + n.y * (off + k * r.mmPerPx) })
      if (dark(g, p.x, p.y, th)) return true
    }
    return false
  }
  const out: Gap[] = []
  for (const side of [1, -1]) {
    // The face line: the offset near the nominal face with the most ink.
    let bestOff = side * half
    let bestInk = -1
    const reach = Math.max(2 * r.mmPerPx, half * 0.35)
    for (let o = -reach; o <= reach + 1e-6; o += r.mmPerPx / 2) {
      let hits = 0
      let tot = 0
      for (let t = margin; t <= len - margin; t += 4 * step) {
        tot++
        if (inkAt(t, side * half + o)) hits++
      }
      if (tot && hits / tot > bestInk) {
        bestInk = hits / tot
        bestOff = side * half + o
      }
    }
    const ts: number[] = []
    const ink: boolean[] = []
    for (let t = margin; t <= len - margin + 1e-6; t += step) {
      ts.push(t)
      ink.push(inkAt(t, bestOff))
    }
    if (ink.length < 4) continue
    // Breaks in the line, short enough to be dash gaps (dashes drawn with a
    // pen are ~2-4 mm on paper with ~0.5-1 mm gaps), and not where another
    // wall meets this face (that break is the junction).
    const breaks: Array<[number, number]> = []
    let b0 = -1
    for (let i = 0; i <= ink.length; i++) {
      const off = i < ink.length && !ink[i]
      if (off && b0 < 0) b0 = i
      if (!off && b0 >= 0) {
        const a = ts[b0]
        const e = ts[i - 1] + step
        const bl = e - a
        const atJunction = (opts.junctions ?? []).some(([c, rad]) => a < c + rad && e > c - rad)
        if (b0 > 0 && i < ink.length && bl >= 25 && bl <= 140 && !atJunction) breaks.push([a, e])
        b0 = -1
      }
    }
    // Runs of breaks spaced like dashes (150-550 mm apart): at least two
    // breaks, i.e. three dashes, make a dashed stretch. It reaches about one
    // dash beyond the outer breaks; where an end dash runs into the solid
    // line can't be seen, so ends are good to about one dash length.
    let k = 0
    while (k < breaks.length) {
      let m = k
      while (m + 1 < breaks.length && breaks[m + 1][0] - breaks[m][1] >= 120 && breaks[m + 1][0] - breaks[m][1] <= 550) m++
      if (m > k) {
        let dash = 0
        for (let q = k; q < m; q++) dash += breaks[q + 1][0] - breaks[q][1]
        dash /= m - k
        const s0 = Math.max(0, breaks[k][0] - dash)
        const s1 = Math.min(len, breaks[m][1] + dash)
        if (s1 - s0 >= minW && s1 - s0 <= maxW) out.push({ wallId: wall.id, offset: Math.round(s0), width: Math.round(s1 - s0) })
      }
      k = m + 1
    }
  }
  return mergeGaps(out)
}

// Overlapping finds (both faces, or gap and dashes) are one opening.
function mergeGaps(gs: Gap[]): Gap[] {
  const sorted = [...gs].sort((a, b) => a.offset - b.offset)
  const out: Gap[] = []
  for (const gp of sorted) {
    const last = out[out.length - 1]
    if (last && last.wallId === gp.wallId && gp.offset <= last.offset + last.width) {
      const end = Math.max(last.offset + last.width, gp.offset + gp.width)
      last.width = end - last.offset
    } else out.push({ ...gp })
  }
  return out
}

// How far a's position moved along the wall when it was located in the source.
function shiftOf(w: Wall, drawn: Wall): number {
  const d = wallDir(w)
  return (drawn.a.x - w.a.x) * d.x + (drawn.a.y - w.a.y) * d.y
}

// Where other plan walls meet or cross this one: [position along it, radius].
function junctionsOn(w: Wall, plan: Plan): Array<[number, number]> {
  const d = wallDir(w)
  const n = leftNormal(d)
  const len = wallLength(w)
  const out: Array<[number, number]> = []
  for (const o of plan.walls) {
    if (o.id === w.id) continue
    const rad = o.thickness / 2 + 40
    const pts = [o.a, o.b]
    // Ends that touch this wall, and crossings of its line.
    for (const p of pts) {
      const t = (p.x - w.a.x) * d.x + (p.y - w.a.y) * d.y
      const off = Math.abs((p.x - w.a.x) * n.x + (p.y - w.a.y) * n.y)
      if (t > -rad && t < len + rad && off <= w.thickness / 2 + o.thickness / 2 + 60) out.push([t, rad])
    }
    const e = wallDir(o)
    const den = d.x * e.y - d.y * e.x
    if (Math.abs(den) > 0.2) {
      const t = ((o.a.x - w.a.x) * e.y - (o.a.y - w.a.y) * e.x) / den
      const u = ((o.a.x - w.a.x) * d.y - (o.a.y - w.a.y) * d.x) / den
      if (t > 0 && t < len && u > -rad && u < wallLength(o) + rad) out.push([t, rad])
    }
  }
  return out
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
    const shift = shiftOf(w, drawn)
    const existing = plan.openings.filter((o) => o.wallId === w.id)
    // Junction positions on the drawn line (it may start a little off the plan's).
    const junctions = junctionsOn(w, plan).map(([t, rad]) => [t - shiftOf(w, drawn), rad] as [number, number])
    for (const gp of mergeGaps([...findGaps(g, r, drawn, { threshold }), ...findDashed(g, r, drawn, { threshold, junctions })])) {
      const offset = Math.round(gp.offset + shift)
      if (offset < 0 || offset + gp.width > wallLength(w)) continue
      const overlaps = existing.some((o) => Math.min(o.offset + o.width, offset + gp.width) - Math.max(o.offset, offset) > 0)
      if (overlaps) continue
      out.push({ id: `o-${w.id}-${out.filter((o) => o.wallId === w.id).length + 1}`, wallId: w.id, kind: 'opening', offset, width: gp.width, phase: 'existing' })
    }
  }
  return { openings: out, skipped, located }
}
