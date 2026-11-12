import { along, pointSegmentDistance, wallLength } from '../domain/geometry'
import type { Opening, Plan, Wall } from '../domain/types'

// How close a traced plan is to a reference plan of the same drawing. Walls are scored by length: how much of the
// reference's wall length has a traced wall running the same way within a tolerance of its centre line (recall), and
// how much of the traced length lies on a reference wall (precision). Openings are scored by position: a reference
// opening is found when a traced one of the same family (window, or doorway: door or opening) has its centre within
// `openingMm` of the reference centre. Door swings are not scored. Walls shorter than `minWallMm` are left out.

export type Score = {
  walls: { reference: number; traced: number; referenceM: number; tracedM: number; recall: Record<string, number>; precision100: number; medianOffsetMm: number | null }
  openings: { doorways: { reference: number; found: number; extra: number }; windows: { reference: number; found: number; extra: number } }
}

const vertical = (w: Wall) => Math.abs(w.b.x - w.a.x) < Math.abs(w.b.y - w.a.y)
const centre = (w: Wall) => (vertical(w) ? (w.a.x + w.b.x) / 2 : (w.a.y + w.b.y) / 2)
const span = (w: Wall): [number, number] => {
  const v = vertical(w)
  const p = v ? w.a.y : w.a.x
  const q = v ? w.b.y : w.b.x
  return [Math.min(p, q), Math.max(p, q)]
}
// Axis-aligned walls only: an angled wall counts towards neither side (this drawing has none; masses are not scored).
const straight = (w: Wall) => Math.abs(w.b.x - w.a.x) < 1 || Math.abs(w.b.y - w.a.y) < 1

// The length of `w` lying within `tol` of the centre line of a wall in `others` that runs the same way.
function covered(w: Wall, others: Wall[], tol: number): number {
  const [t0, t1] = span(w)
  const c = centre(w)
  const parts = others
    .filter((o) => straight(o) && vertical(o) === vertical(w) && Math.abs(centre(o) - c) <= tol)
    .map((o) => {
      const [a, b] = span(o)
      return [Math.max(t0, a), Math.min(t1, b)] as [number, number]
    })
    .filter(([a, b]) => b > a)
    .sort((p, q) => p[0] - q[0])
  let total = 0
  let end = -Infinity
  for (const [a, b] of parts) {
    const s = Math.max(a, end)
    if (b > s) total += b - s
    end = Math.max(end, b)
  }
  return total
}

function nearestOffset(w: Wall, others: Wall[]): number | null {
  const [t0, t1] = span(w)
  const c = centre(w)
  let best: number | null = null
  for (const o of others) {
    if (!straight(o) || vertical(o) !== vertical(w)) continue
    const [a, b] = span(o)
    if (Math.min(t1, b) - Math.max(t0, a) < 0.5 * (t1 - t0)) continue
    const d = Math.abs(centre(o) - c)
    if (d <= 300 && (best === null || d < best)) best = d
  }
  return best
}

const family = (o: Opening) => (o.kind === 'window' ? 'window' : 'doorway')
function centres(plan: Plan, fam: string) {
  return plan.openings.filter((o) => family(o) === fam).flatMap((o) => {
    const w = plan.walls.find((x) => x.id === o.wallId)
    return w ? [{ p: along(w, o.offset + o.width / 2), w }] : []
  })
}
function matchOpenings(ref: Plan, got: Plan, fam: string, tol: number) {
  const r = centres(ref, fam)
  const g = centres(got, fam)
  const used = new Set<number>()
  let found = 0
  for (const x of r) {
    let bi = -1
    let bd = Infinity
    g.forEach((y, i) => {
      if (used.has(i)) return
      const d = Math.hypot(x.p.x - y.p.x, x.p.y - y.p.y)
      // Same wall line: the traced centre lies on the reference wall's line (within half its thickness + 100 mm).
      const onLine = pointSegmentDistance(y.p, x.w.a, x.w.b).d <= x.w.thickness / 2 + 100
      if (d <= tol && onLine && d < bd) {
        bd = d
        bi = i
      }
    })
    if (bi >= 0) {
      used.add(bi)
      found++
    }
  }
  return { reference: r.length, found, extra: g.length - used.size }
}

export function scorePlan(ref: Plan, got: Plan, opts: { minWallMm?: number; openingMm?: number } = {}): Score {
  const min = opts.minWallMm ?? 500
  const rw = ref.walls.filter((w) => straight(w) && wallLength(w) >= min)
  const gw = got.walls.filter((w) => straight(w) && wallLength(w) >= min)
  const rl = rw.reduce((a, w) => a + wallLength(w), 0)
  const gl = gw.reduce((a, w) => a + wallLength(w), 0)
  const recall = (tol: number) => (rl ? +(rw.reduce((a, w) => a + covered(w, gw, tol), 0) / rl).toFixed(3) : 0)
  const offs = rw.map((w) => nearestOffset(w, gw)).filter((d): d is number => d !== null).sort((a, b) => a - b)
  return {
    walls: {
      reference: rw.length,
      traced: gw.length,
      referenceM: +(rl / 1000).toFixed(1),
      tracedM: +(gl / 1000).toFixed(1),
      recall: { '50': recall(50), '100': recall(100), '200': recall(200) },
      precision100: gl ? +(gw.reduce((a, w) => a + covered(w, rw, 100), 0) / gl).toFixed(3) : 0,
      medianOffsetMm: offs.length ? Math.round(offs[offs.length >> 1]) : null,
    },
    openings: {
      doorways: matchOpenings(ref, got, 'doorway', opts.openingMm ?? 300),
      windows: matchOpenings(ref, got, 'window', opts.openingMm ?? 300),
    },
  }
}
