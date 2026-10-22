import type { Pt } from '../types'
import { sample, toPx, type Gray, type Raster } from './raster'

// Dark runs along a line through the source drawing, in mm from the line's
// start. One sample per source pixel, so a run is accurate to ~1 px.

export type Run = { from: number; to: number; width: number; mid: number }

export function profile(g: Gray, r: Raster, from: Pt, to: Pt, threshold = 128): { length: number; runs: Run[] } {
  const p0 = toPx(r, from)
  const p1 = toPx(r, to)
  const lenPx = Math.hypot(p1.x - p0.x, p1.y - p0.y)
  const n = Math.max(2, Math.ceil(lenPx))
  const runs: Run[] = []
  let start = -1
  const step = lenPx / n
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const isDark = i < n && sample(g, p0.x + (p1.x - p0.x) * t, p0.y + (p1.y - p0.y) * t) < threshold
    if (isDark && start < 0) start = i
    if (!isDark && start >= 0) {
      const a = start * step * r.mmPerPx
      const b = i * step * r.mmPerPx
      runs.push({ from: a, to: b, width: b - a, mid: (a + b) / 2 })
      start = -1
    }
  }
  return { length: lenPx * r.mmPerPx, runs }
}

export function roundRun(x: Run): Run {
  return { from: Math.round(x.from), to: Math.round(x.to), width: Math.round(x.width), mid: Math.round(x.mid) }
}
