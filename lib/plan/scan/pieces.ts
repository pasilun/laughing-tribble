import type { Pt } from '../domain/types'

// Detected walls come in pieces where a door or window breaks them.
export type Piece = { a: Pt; b: Pt; thickness: number }

// Detected walls come in pieces where a door or window breaks them: join
// pieces on one line (centre within 60 mm, similar thickness) across gaps up
// to 2 m (a door plus the break where a crossing wall meets one face), so the
// openings tool sees one wall with a gap.
// centreMm: how far apart two pieces' centre lines may be and still be one wall (hand drawn
// and slightly skewed scans need more than a drawing made by machine).
export function joinPieces(pieces: Piece[], centreMm = 60): Piece[] {
  const vert = (p: Piece) => Math.abs(p.b.x - p.a.x) < Math.abs(p.b.y - p.a.y)
  const span = (p: Piece) => (vert(p) ? { c: (p.a.x + p.b.x) / 2, t0: Math.min(p.a.y, p.b.y), t1: Math.max(p.a.y, p.b.y) } : { c: (p.a.y + p.b.y) / 2, t0: Math.min(p.a.x, p.b.x), t1: Math.max(p.a.x, p.b.x) })
  const out: Array<{ v: boolean; c: number; t0: number; t1: number; th: number[] }> = []
  for (const p of [...pieces].sort((x, y) => span(x).t0 - span(y).t0)) {
    const s = span(p)
    const v = vert(p)
    const m = out.find((o) => o.v === v && Math.abs(o.c - s.c) <= centreMm && s.t0 - o.t1 <= 2000 && Math.abs(o.th[0] - p.thickness) <= 0.35 * Math.max(o.th[0], p.thickness))
    if (m) {
      m.t1 = Math.max(m.t1, s.t1)
      m.th.push(p.thickness)
    } else out.push({ v, c: s.c, t0: s.t0, t1: s.t1, th: [p.thickness] })
  }
  return out.map((o) => {
    const th = Math.round(o.th.sort((a, b) => a - b)[o.th.length >> 1])
    return o.v ? { a: { x: o.c, y: o.t0 }, b: { x: o.c, y: o.t1 }, thickness: th } : { a: { x: o.t0, y: o.c }, b: { x: o.t1, y: o.c }, thickness: th }
  })
}


// One wall found as two side by side: a thick wall drawn as several lines (an exterior wall with its window sills
// between the faces) pairs into an outer and an inner strip whose faces touch. Long strips (a counter or a cupboard
// drawn along a partition is short) on the same axis that overlap
// for most of the shorter one, with at most `gapMm` between their facing faces and no more than `maxMm` in all,
// become one wall from the outer face of one to the outer face of the other, over the longer one's length.
export function mergeStacked(pieces: Piece[], gapMm = 40, maxMm = 600, minLenMm = 2500): Piece[] {
  const vert = (p: Piece) => Math.abs(p.b.x - p.a.x) < Math.abs(p.b.y - p.a.y)
  type S = { v: boolean; lo: number; hi: number; t0: number; t1: number }
  const toS = (p: Piece): S => {
    const v = vert(p)
    const c = v ? (p.a.x + p.b.x) / 2 : (p.a.y + p.b.y) / 2
    const t0 = v ? Math.min(p.a.y, p.b.y) : Math.min(p.a.x, p.b.x)
    const t1 = v ? Math.max(p.a.y, p.b.y) : Math.max(p.a.x, p.b.x)
    return { v, lo: c - p.thickness / 2, hi: c + p.thickness / 2, t0, t1 }
  }
  const ss = pieces.map(toS)
  let merged = true
  while (merged) {
    merged = false
    for (let i = 0; i < ss.length && !merged; i++)
      for (let j = i + 1; j < ss.length && !merged; j++) {
        const p = ss[i]
        const q = ss[j]
        if (p.v !== q.v || p.t1 - p.t0 < minLenMm || q.t1 - q.t0 < minLenMm) continue
        const ov = Math.min(p.t1, q.t1) - Math.max(p.t0, q.t0)
        if (ov < 0.6 * Math.min(p.t1 - p.t0, q.t1 - q.t0)) continue
        const gap = Math.max(p.lo, q.lo) - Math.min(p.hi, q.hi)
        const lo = Math.min(p.lo, q.lo)
        const hi = Math.max(p.hi, q.hi)
        if (gap > gapMm || hi - lo > maxMm) continue
        const longer = p.t1 - p.t0 >= q.t1 - q.t0 ? p : q
        ss[i] = { v: p.v, lo, hi, t0: longer.t0, t1: longer.t1 }
        ss.splice(j, 1)
        merged = true
      }
  }
  return ss.map((s) => {
    const c = Math.round((s.lo + s.hi) / 2)
    const thickness = Math.round(s.hi - s.lo)
    return s.v ? { a: { x: c, y: s.t0 }, b: { x: c, y: s.t1 }, thickness } : { a: { x: s.t0, y: c }, b: { x: s.t1, y: c }, thickness }
  })
}
