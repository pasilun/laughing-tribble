import type { Pt } from '../types'

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

