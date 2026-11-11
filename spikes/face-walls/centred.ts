// Spike: walls stored on a face line (ref: 'left' | 'right' = which face the stored line is, seen a → b;
// no ref = centre line as today), and the centre-line view the rest of v1 reads.
type Pt = { x: number; y: number }
type W = { id: string; a: Pt; b: Pt; thickness: number; ref?: 'left' | 'right'; [k: string]: unknown }
const sub = (p: Pt, q: Pt) => ({ x: p.x - q.x, y: p.y - q.y })
const len = (p: Pt) => Math.hypot(p.x, p.y)
const dirOf = (w: W) => { const d = sub(w.b, w.a); const l = len(d) || 1; return { x: d.x / l, y: d.y / l } }
const leftN = (d: Pt) => ({ x: d.y, y: -d.x })
// Offset from the stored line to the centre line: a left face has its body to the right.
function shift(w: W): Pt {
  if (!w.ref) return { x: 0, y: 0 }
  const n = leftN(dirOf(w)); const k = (w.ref === 'left' ? -1 : 1) * (w.thickness / 2)
  return { x: n.x * k, y: n.y * k }
}
function meet(p: Pt, d: Pt, q: Pt, e: Pt): Pt | null {
  const den = d.x * e.y - d.y * e.x
  if (Math.abs(den) < 0.05) return null
  const t = ((q.x - p.x) * e.y - (q.y - p.y) * e.x) / den
  return { x: p.x + d.x * t, y: p.y + d.y * t }
}
function onSegment(p: Pt, w: W): boolean {
  const d = dirOf(w); const v = sub(p, w.a); const t = v.x * d.x + v.y * d.y; const off = Math.abs(v.x * d.y - v.y * d.x)
  return off <= 1 && t > 1 && t < len(sub(w.b, w.a)) - 1
}
const near = (p: Pt, q: Pt) => len(sub(p, q)) <= 1
const round = (p: Pt) => ({ x: Math.round(p.x), y: Math.round(p.y) })

export function centred<P extends { walls: W[] }>(plan: P): P {
  const walls = plan.walls.map((w) => {
    const s = shift(w); const d = dirOf(w)
    const end = (p: Pt): Pt => {
      const c = { x: p.x + s.x, y: p.y + s.y }            // plain offset
      for (const o of plan.walls) {
        if (o.id === w.id) continue
        const corner = near(o.a, p) || near(o.b, p)          // L corner: stored ends coincide
        const tee = !corner && onSegment(p, o)               // T: this end lies on the other's stored line
        if (!corner && !tee) continue
        const so = shift(o)
        const m = meet(c, d, { x: o.a.x + so.x, y: o.a.y + so.y }, dirOf(o))
        if (m) return m                                      // meet the other wall's centre line
      }
      return c
    }
    const { ref: _ref, ...rest } = w
    return { ...rest, a: round(end(w.a)), b: round(end(w.b)) } as W
  })
  // An opening's offset is measured from its wall's a-end. Where the view moved that end along the wall
  // (a corner or a T), the offset grows by the same length, so the opening stays where it was drawn.
  const grow = new Map<string, number>()
  plan.walls.forEach((w, i) => { const d = dirOf(w); const s = shift(w); const v = sub({ x: w.a.x + s.x, y: w.a.y + s.y }, walls[i].a); grow.set(w.id, v.x * d.x + v.y * d.y) })
  const openings = ((plan as any).openings ?? []).map((o: any) => ({ ...o, offset: Math.round(o.offset + (grow.get(o.wallId) ?? 0)) }))
  return { ...plan, walls, ...((plan as any).openings ? { openings } : {}) }
}
