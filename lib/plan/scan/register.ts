import { dark, type Gray, type Raster } from './raster'
import type { Rect } from './view'

// Aligns one source drawing to another (or to the plan's reference source)
// by searching scale and offset for the best overlap of ink, coarse to fine.
// Different drawings of the same floor share the facades, stairs and most
// walls, which is enough to lock on even when the layouts differ in detail.

export type Registration = { scale: number; dx: number; dy: number; score: number; mmPerPx: number; x: number; y: number }

type Grid = { w: number; h: number; c: number; v: Float32Array }

// Ink on a plan-mm grid: 1 where any of 3×3 samples in the cell is dark.
function inkGrid(g: Gray, r: { x: number; y: number; mmPerPx: number }, rect: Rect, c: number, threshold: number): Grid {
  const w = Math.ceil(rect.w / c)
  const h = Math.ceil(rect.h / c)
  const v = new Float32Array(w * h)
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      let hit = 0
      for (let a = 0; a < 3 && !hit; a++)
        for (let b = 0; b < 3 && !hit; b++) {
          const x = rect.x + (i + (a + 0.5) / 3) * c
          const y = rect.y + (j + (b + 0.5) / 3) * c
          if (dark(g, (x - r.x) / r.mmPerPx, (y - r.y) / r.mmPerPx, threshold)) hit = 1
        }
      v[j * w + i] = hit
    }
  return { w, h, c, v }
}

// Spread ink a cell so near-misses still score (tolerates line weight and
// small drawing errors).
function blur(gr: Grid, side: number): Grid {
  const out = new Float32Array(gr.v.length)
  for (let j = 0; j < gr.h; j++)
    for (let i = 0; i < gr.w; i++) {
      let s = 0
      for (let b = -1; b <= 1; b++)
        for (let a = -1; a <= 1; a++) {
          const x = i + a
          const y = j + b
          if (x >= 0 && y >= 0 && x < gr.w && y < gr.h) s += gr.v[y * gr.w + x] * (a === 0 && b === 0 ? 1 : side)
        }
      out[j * gr.w + i] = Math.min(1, s)
    }
  return { ...gr, v: out }
}

// Best shift of `mov` over `ref` within ±range cells. Symmetric score: each
// side's ink is checked against the other's blurred ink, so identical
// drawings score 1 and neither growing nor shrinking one side is favoured.
function bestShift(ref: Grid, refBlur: Grid, refCells: number[], mov: Grid, movBlur: Grid, range: number) {
  const movCells: number[] = []
  for (let k = 0; k < mov.v.length; k++) if (mov.v[k]) movCells.push(k)
  const total = movCells.length + refCells.length
  if (!movCells.length || !refCells.length) return { si: 0, sj: 0, score: 0 }
  const at = (gr: Grid, i: number, j: number) => (i >= 0 && j >= 0 && i < gr.w && j < gr.h ? gr.v[j * gr.w + i] : 0)
  let best = { si: 0, sj: 0, score: -1 }
  for (let sj = -range; sj <= range; sj++)
    for (let si = -range; si <= range; si++) {
      let s = 0
      for (const k of movCells) s += at(refBlur, (k % mov.w) + si, Math.floor(k / mov.w) + sj)
      for (const k of refCells) s += at(movBlur, (k % ref.w) - si, Math.floor(k / ref.w) - sj)
      if (s > best.score) best = { si, sj, score: s }
    }
  return { ...best, score: best.score / total }
}

export function register(
  ref: { g: Gray; r: Raster },
  mov: { g: Gray; r: Raster },
  rect: Rect,
  opts: { scaleMin?: number; scaleMax?: number; shiftMm?: number; threshold?: number } = {},
): Registration {
  const th = opts.threshold ?? 128
  const smin = opts.scaleMin ?? 0.9
  const smax = opts.scaleMax ?? 1.1
  const shift = opts.shiftMm ?? 2000
  // Scaling is about the rect centre, so a scale change doesn't also shift the area.
  const cx = rect.x + rect.w / 2
  const cy = rect.y + rect.h / 2
  const place = (s: number, dx: number, dy: number) => ({
    mmPerPx: mov.r.mmPerPx * s,
    x: cx + (mov.r.x - cx) * s + dx,
    y: cy + (mov.r.y - cy) * s + dy,
  })
  const run = (c: number, scales: number[], dx0: number, dy0: number, range: number, side: number) => {
    const refG = inkGrid(ref.g, ref.r, rect, c, th)
    const refBlur = blur(refG, side)
    const refCells: number[] = []
    for (let k = 0; k < refG.v.length; k++) if (refG.v[k]) refCells.push(k)
    const out: Array<{ s: number; dx: number; dy: number; score: number }> = []
    for (const s of scales) {
      const p = place(s, dx0, dy0)
      const m = inkGrid(mov.g, p, rect, c, th)
      const b = bestShift(refG, refBlur, refCells, m, blur(m, side), range)
      // Moving the image by +si cells moves its ink by +si cells.
      out.push({ s, dx: dx0 + b.si * c, dy: dy0 + b.sj * c, score: b.score })
    }
    return out.sort((x, y) => y.score - x.score)
  }
  const span = (a: number, b: number, step: number) => {
    const out: number[] = []
    for (let s = a; s <= b + 1e-9; s += step) out.push(Math.round(s * 10000) / 10000)
    return out
  }
  // Cells must be well above the scan's pixel size or sampling aliasing
  // decides the fit instead of the drawing.
  const minC = 2.5 * Math.max(ref.r.mmPerPx, mov.r.mmPerPx)
  const coarseC = Math.max(60, 4 * minC, Math.max(rect.w, rect.h) / 120)
  // Each finer level also sharpens the tolerance, so it can tell close fits apart.
  // Coarse scores are close for neighbouring scales, so the best few coarse
  // candidates are each refined and the best refined fit wins.
  const coarse = run(coarseC, span(smin, smax, 0.01), 0, 0, Math.ceil(shift / coarseC), 0.5).slice(0, 4)
  let b = { s: 1, dx: 0, dy: 0, score: -1 }
  for (const c0 of coarse) {
    // Refine at the finest cell, reaching past the coarse cell, so every
    // scale gets a fair shift instead of whatever the coarse grid allowed.
    const reach = Math.ceil(coarseC / minC) + 1
    const c1 = run(minC, span(c0.s - 0.012, c0.s + 0.012, 0.002), c0.dx, c0.dy, reach, 0.3)[0]
    const c2 = run(minC, span(c1.s - 0.002, c1.s + 0.002, 0.0005), c1.dx, c1.dy, 3, 0.15)[0]
    if (c2.score > b.score) b = c2
  }
  const p = place(b.s, b.dx, b.dy)
  return { scale: b.s, dx: Math.round(b.dx), dy: Math.round(b.dy), score: Math.round(b.score * 1000) / 1000, mmPerPx: p.mmPerPx, x: Math.round(p.x), y: Math.round(p.y) }
}
