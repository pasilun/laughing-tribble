import type { Pt } from '../types'
import { sample, toMm, toPx, type Gray, type Raster } from './raster'

// A printed dimension line ends in strokes across it (extension lines, ticks).
// Claude reads roughly where the ends are off a gridded view; the strokes
// themselves are found here, to about a pixel, so a calibration does not depend
// on eyeballing pixel positions (a few px off is 40 mm at 1:100 and 300 dpi).

export type DimensionEnd = { point: Pt; moved: number; strength: number; found: boolean }

// The ends of the dimension line a→b (plan mm, rough). `searchMm` is how far from
// each given end a stroke is looked for; `spanMm` how far a stroke reaches
// either side of the line.
export function findDimensionEnds(g: Gray, r: Raster, a: Pt, b: Pt, opts: { searchMm?: number; spanMm?: number; threshold?: number } = {}): { a: DimensionEnd; b: DimensionEnd } {
  const th = opts.threshold ?? 128
  const A = toPx(r, a)
  const B = toPx(r, b)
  const len = Math.hypot(B.x - A.x, B.y - A.y)
  if (len < 4) throw new Error('de två punkterna ligger för nära varandra')
  const d = { x: (B.x - A.x) / len, y: (B.y - A.y) / len }
  const n = { x: -d.y, y: d.x }
  const search = (opts.searchMm ?? 350) / r.mmPerPx
  const span = (opts.spanMm ?? 600) / r.mmPerPx
  // The strokes at one end: ink across the line, summed over a band either side of it.
  const end = (P: Pt): DimensionEnd => {
    const ts: number[] = []
    const score: number[] = []
    for (let t = -search; t <= search; t += 0.5) {
      let s = 0
      for (let k = -span; k <= span; k += 1) {
        // The line itself (k ≈ 0) is ink all along: leave it out.
        if (Math.abs(k) < 2.5) continue
        if (sample(g, P.x + d.x * t + n.x * k, P.y + d.y * t + n.y * k) < th) s++
      }
      ts.push(t)
      score.push(s)
    }
    const max = Math.max(...score)
    // Prefer a stroke near the given end among strokes that are about as strong.
    let best = -1
    let bestV = -1
    score.forEach((s, i) => {
      const v = s * (1 - Math.abs(ts[i]) / (2 * search))
      if (s >= 0.6 * max && v > bestV) {
        bestV = v
        best = i
      }
    })
    // Centre of the stroke: the weighted middle of the contiguous run around the peak.
    const half = 0.5 * score[best]
    let lo = best
    let hi = best
    while (lo > 0 && score[lo - 1] >= half) lo--
    while (hi < score.length - 1 && score[hi + 1] >= half) hi++
    let sw = 0
    let st = 0
    for (let i = lo; i <= hi; i++) {
      sw += score[i]
      st += score[i] * ts[i]
    }
    const t0 = st / sw
    const found = score[best] >= 8 // at least ~8 px of stroke across the line
    const p = toMm(r, { x: P.x + d.x * t0, y: P.y + d.y * t0 })
    return { point: { x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 }, moved: Math.round(Math.abs(t0) * r.mmPerPx), strength: score[best], found }
  }
  return { a: end(A), b: end(B) }
}
