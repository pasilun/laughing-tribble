import type { Opening, Plan, Pt, Wall } from './types'

// Walls stored on a face (wall.ref) and the centre-line view the rest of the code reads while it still assumes a body
// centred on the stored line. The view is temporary: the code moves to one function for a wall's body, a few places
// at a time, and then the view is deleted (docs/v2-engine-plan.md, section 3).
//
// The view of a plan with no face-referenced wall is the plan itself, so it is safe to apply at any entry point, and
// applying it twice is the same as once (the view has no face-referenced walls).

const sub = (p: Pt, q: Pt): Pt => ({ x: p.x - q.x, y: p.y - q.y })
const norm = (p: Pt) => Math.hypot(p.x, p.y)
const near = (p: Pt, q: Pt) => norm(sub(p, q)) <= 1

function dirOf(w: Wall): Pt {
  const d = sub(w.b, w.a)
  const l = norm(d) || 1
  return { x: d.x / l, y: d.y / l }
}

// From the stored line to the centre line: a left face has its body on the right of a → b, and the other way round.
// The left normal of a direction (dx, dy) in plan coordinates (y down) is (dy, -dx).
export function centreShift(w: Wall): Pt {
  if (!w.ref) return { x: 0, y: 0 }
  const d = dirOf(w)
  const k = (w.ref === 'left' ? -1 : 1) * (w.thickness / 2)
  return { x: d.y * k, y: -d.x * k }
}

function meet(p: Pt, d: Pt, q: Pt, e: Pt): Pt | null {
  const den = d.x * e.y - d.y * e.x
  if (Math.abs(den) < 0.05) return null
  const t = ((q.x - p.x) * e.y - (q.y - p.y) * e.x) / den
  return { x: p.x + d.x * t, y: p.y + d.y * t }
}

// Whether p lies on the inside of w's stored line (a T-joint against it), within 1 mm.
function onLine(p: Pt, w: Wall): boolean {
  const d = dirOf(w)
  const v = sub(p, w.a)
  const t = v.x * d.x + v.y * d.y
  return Math.abs(v.x * d.y - v.y * d.x) <= 1 && t > 1 && t < norm(sub(w.b, w.a)) - 1
}

const round = (p: Pt): Pt => ({ x: Math.round(p.x), y: Math.round(p.y) })

// A wall's centre line in the view: moved by half its thickness, and each end run to the centre line of the wall it
// meets (an L corner, where stored ends coincide, or a T, where the end lies on the other's stored line).
function centreLine(w: Wall, walls: Wall[]): { a: Pt; b: Pt } {
  const s = centreShift(w)
  const d = dirOf(w)
  const end = (p: Pt): Pt => {
    const c = { x: p.x + s.x, y: p.y + s.y }
    for (const o of walls) {
      if (o.id === w.id) continue
      if (!near(o.a, p) && !near(o.b, p) && !onLine(p, o)) continue
      const so = centreShift(o)
      const m = meet(c, d, { x: o.a.x + so.x, y: o.a.y + so.y }, dirOf(o))
      if (m) return m
    }
    return c
  }
  return { a: round(end(w.a)), b: round(end(w.b)) }
}

export function hasFaceWalls(plan: Pick<Plan, 'walls'>): boolean {
  return plan.walls.some((w) => w.ref)
}

// The plan as the centre-line code reads it: every wall on its centre line, without ref. An opening is measured from
// its wall's a-end; where the view moved that end along the wall, the offset grows by the same length, so the opening
// stays where it is drawn.
export function centreLines<P extends Pick<Plan, 'walls'> & { openings?: Opening[] }>(plan: P): P {
  if (!hasFaceWalls(plan)) return plan
  const grow = new Map<string, number>()
  const walls = plan.walls.map((w): Wall => {
    const { a, b } = centreLine(w, plan.walls)
    const s = centreShift(w)
    const d = dirOf(w)
    const moved = sub({ x: w.a.x + s.x, y: w.a.y + s.y }, a)
    grow.set(w.id, moved.x * d.x + moved.y * d.y)
    const { ref: _ref, ...rest } = w
    void _ref
    return { ...rest, a, b }
  })
  const openings = plan.openings?.map((o) => (grow.get(o.wallId) ? { ...o, offset: Math.round(o.offset + grow.get(o.wallId)!) } : o))
  return { ...plan, walls, ...(openings ? { openings } : {}) }
}
