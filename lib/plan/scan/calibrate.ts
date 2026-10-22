import { dist } from '../geometry'
import type { Pt } from '../types'
import type { Raster } from './raster'

// Least-squares scale from several known distances read off the source.
// Points are in plan mm under the source's current calibration; the result
// is the factor that makes them match, with each measurement's residual.

export type Measurement = { a: Pt; b: Pt; mm: number; label?: string }

export type Calibration = {
  factor: number
  mmPerPx: number
  rmsMm: number
  residuals: Array<{ label: string; measuredMm: number; drawnMm: number; residualMm: number; residualPct: number }>
}

export function calibrate(r: Raster, ms: Measurement[]): Calibration {
  const valid = ms.filter((m) => m.mm > 0 && dist(m.a, m.b) > 0)
  if (valid.length === 0) throw new Error('minst ett mått med längd > 0 krävs')
  // Minimise Σ(k·d − m)² → k = Σ d·m / Σ d²
  let sdm = 0
  let sdd = 0
  for (const m of valid) {
    const d = dist(m.a, m.b)
    sdm += d * m.mm
    sdd += d * d
  }
  const k = sdm / sdd
  const residuals = valid.map((m, i) => {
    const drawn = dist(m.a, m.b) * k
    return {
      label: m.label ?? `m${i + 1}`,
      measuredMm: m.mm,
      drawnMm: Math.round(drawn),
      residualMm: Math.round(drawn - m.mm),
      residualPct: Math.round(((drawn - m.mm) / m.mm) * 1000) / 10,
    }
  })
  const rms = Math.sqrt(residuals.reduce((s, x) => s + (x.drawnMm - x.measuredMm) ** 2, 0) / residuals.length)
  return { factor: k, mmPerPx: r.mmPerPx * k, rmsMm: Math.round(rms), residuals }
}

// Source position after rescaling around a fixed plan point (so whatever is
// already traced near the anchor stays put).
export function rescaleAround(r: Raster, factor: number, anchor: Pt): { x: number; y: number; mmPerPx: number } {
  return { x: anchor.x + (r.x - anchor.x) * factor, y: anchor.y + (r.y - anchor.y) * factor, mmPerPx: r.mmPerPx * factor }
}
