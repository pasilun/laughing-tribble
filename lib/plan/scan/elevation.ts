import { wallDir, wallLength } from '../geometry'
import type { Pt, Wall } from '../types'
import { dark, toPx, type Gray, type Raster } from './raster'

// Windows from a facade drawing. In an elevation the wall surface is blank
// paper and every window is a framed figure (frame, sashes, glazing bars),
// so along one floor's row of windows the columns holding any ink are the
// windows. Facade x maps to a position along a plan wall through two anchor
// points (e.g. the building's corners); a facade drawn as seen from outside
// comes out mirrored, which the anchors take care of.

export type FacadeWindow = { x0: number; x1: number; y0: number; y1: number } // source mm
export type Anchor = { facadeX: number; plan: Pt }

export function findWindows(g: Gray, r: Raster, band: { y0: number; y1: number }, xs?: { x0: number; x1: number }, opts: { minWidth?: number; maxWidth?: number; threshold?: number } = {}): FacadeWindow[] {
  const minW = opts.minWidth ?? 350
  const maxW = opts.maxWidth ?? 3000
  const th = opts.threshold ?? 128
  const mm = r.mmPerPx
  const pa = toPx(r, { x: xs?.x0 ?? r.x, y: band.y0 })
  const pb = toPx(r, { x: xs?.x1 ?? r.x + r.widthPx * mm, y: band.y1 })
  const px0 = Math.max(1, Math.floor(pa.x))
  const px1 = Math.min(g.w - 2, Math.ceil(pb.x))
  const py0 = Math.max(1, Math.floor(pa.y))
  const py1 = Math.min(g.h - 2, Math.ceil(pb.y))
  // Ink on a slightly thick line: the pixel or one above/below (scans are a
  // little skewed, lines a few pixels thick).
  const ink = (x: number, y: number) => dark(g, x, y, th) || dark(g, x, y - 1, th) || dark(g, x, y + 1, th)
  // Horizontal runs of ink per pixel row, allowing 2 px breaks. Speckle
  // never makes long runs; window frames (sill, head, transoms) do.
  type Run = { x0: number; x1: number; y: number }
  const runs: Run[] = []
  const minPx = minW / mm
  const maxPx = maxW / mm
  for (let y = py0; y <= py1; y++) {
    let s = -1
    let gap = 0
    for (let x = px0; x <= px1 + 3; x++) {
      const v = x <= px1 && ink(x, y)
      if (v) {
        if (s < 0) s = x
        gap = 0
      } else if (s >= 0 && ++gap > 2) {
        const e = x - gap
        if (e - s >= minPx && e - s <= maxPx) runs.push({ x0: s, x1: e, y })
        s = -1
        gap = 0
      }
    }
  }
  // Group runs with the same ends (±100 mm): stacked lines of one window.
  const tol = 100 / mm
  const groups: Run[][] = []
  for (const run of runs.sort((a, b) => a.x0 - b.x0 || a.y - b.y)) {
    const grp = groups.find((gr) => Math.abs(gr[0].x0 - run.x0) <= tol && Math.abs(gr[0].x1 - run.x1) <= tol)
    if (grp) grp.push(run)
    else groups.push([run])
  }
  const med = (v: number[]) => [...v].sort((a, b) => a - b)[v.length >> 1]
  const found: FacadeWindow[] = []
  for (const grp of groups) {
    // Distinct lines: rows more than ~100 mm apart.
    const ys = [...new Set(grp.map((q) => q.y))].sort((a, b) => a - b)
    const lines: number[] = []
    for (const y of ys) if (!lines.length || y - lines[lines.length - 1] > tol) lines.push(y)
    if (lines.length < 2 || (lines[lines.length - 1] - lines[0]) * mm < 300) continue
    const a = toPxInv(r, med(grp.map((q) => q.x0)), lines[0])
    const b = toPxInv(r, med(grp.map((q) => q.x1)), lines[lines.length - 1])
    found.push({ x0: a.x, x1: b.x, y0: a.y, y1: b.y })
  }
  // Frames are drawn double (outer and inner line): overlapping finds are
  // one window, the outer extent.
  found.sort((p, q) => p.x0 - q.x0)
  const out: FacadeWindow[] = []
  for (const w of found) {
    const last = out[out.length - 1]
    if (last && w.x0 < last.x1) {
      last.x0 = Math.min(last.x0, w.x0)
      last.x1 = Math.max(last.x1, w.x1)
      last.y0 = Math.min(last.y0, w.y0)
      last.y1 = Math.max(last.y1, w.y1)
    } else out.push({ ...w })
  }
  return out
}

// Source pixel → source mm.
function toPxInv(r: Raster, px: number, py: number): Pt {
  return { x: r.x + px * r.mmPerPx, y: r.y + py * r.mmPerPx }
}

// Facade x → distance along the wall from its a-end, through two anchors.
export function facadeToWall(wall: Wall, anchors: [Anchor, Anchor]): (fx: number) => number {
  const d = wallDir(wall)
  const t = (p: Pt) => (p.x - wall.a.x) * d.x + (p.y - wall.a.y) * d.y
  const [p, q] = anchors
  const k = (t(q.plan) - t(p.plan)) / (q.facadeX - p.facadeX)
  return (fx) => t(p.plan) + (fx - p.facadeX) * k
}

// Windows that fall on the wall, as offset/width along it (ordered by offset).
export function windowsOnWall(wins: FacadeWindow[], wall: Wall, anchors: [Anchor, Anchor]): Array<{ offset: number; width: number; height: number; win: FacadeWindow }> {
  const map = facadeToWall(wall, anchors)
  const len = wallLength(wall)
  const out: Array<{ offset: number; width: number; height: number; win: FacadeWindow }> = []
  for (const w of wins) {
    const a = map(w.x0)
    const b = map(w.x1)
    const lo = Math.min(a, b)
    const hi = Math.max(a, b)
    // Windows mostly on the wall (the mapping is good to ~0.1 m, and a wall
    // end at a corner sits on the centreline): clipped to it. One mostly
    // beyond the end belongs to a neighbouring wall or flat.
    const a0 = Math.max(0, lo)
    const b0 = Math.min(len, hi)
    if (b0 - a0 < 0.8 * (hi - lo)) continue
    out.push({ offset: Math.round(a0), width: Math.round(b0 - a0), height: Math.round(w.y1 - w.y0), win: w })
  }
  return out.sort((x, y) => x.offset - y.offset)
}
