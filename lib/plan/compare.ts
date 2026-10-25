import { wallDir, wallLength } from './geometry'
import type { Opening, Plan, Pt, Wall } from './types'

// Compares a plan with a reference plan of the same floor (e.g. one built
// from archive drawings against one from a survey). Walls are paired by
// id; the reference is brought into the plan's frame by a scale and offset
// per axis fitted on those walls (plans made from different drawings have
// different origins). Reported per wall: centreline offset and thickness
// difference; per opening: matched (and how far off), missed, or extra.

export type AxisFit = { scale: number; offset: number; rmsMm: number; n: number }
export type WallDiff = { id: string; axis: 'x' | 'y'; refPos: number; pos: number; diffMm: number; refThickness: number; thickness: number; thicknessDiffMm: number }
export type OpeningMatch = { id: string; refId: string; wallId: string; centreDiffMm: number; widthDiffMm: number }
export type Comparison = {
  fit: { x: AxisFit; y: AxisFit }
  walls: WallDiff[]
  wallsOnlyInRef: string[]
  wallsOnlyInPlan: string[]
  openings: { matched: OpeningMatch[]; missed: Array<{ refId: string; wallId: string; kind: string }>; extra: Array<{ id: string; wallId: string; kind: string }> }
}

const vertical = (w: Wall) => Math.abs(w.b.x - w.a.x) < Math.abs(w.b.y - w.a.y)
const centre = (w: Wall) => (vertical(w) ? (w.a.x + w.b.x) / 2 : (w.a.y + w.b.y) / 2)

function fitAxis(pairs: Array<[number, number]>): AxisFit {
  // Least squares p = s·r + t, then one pass without outliers (> 3× median residual).
  const solve = (ps: Array<[number, number]>) => {
    const n = ps.length
    const mr = ps.reduce((a, [r]) => a + r, 0) / n
    const mp = ps.reduce((a, [, p]) => a + p, 0) / n
    let num = 0
    let den = 0
    for (const [r, p] of ps) {
      num += (r - mr) * (p - mp)
      den += (r - mr) ** 2
    }
    const s = den > 0 ? num / den : 1
    return { s, t: mp - s * mr }
  }
  if (pairs.length < 2) return { scale: 1, offset: pairs.length ? pairs[0][1] - pairs[0][0] : 0, rmsMm: 0, n: pairs.length }
  let { s, t } = solve(pairs)
  const res = pairs.map(([r, p]) => Math.abs(p - (s * r + t)))
  const med = [...res].sort((a, b) => a - b)[res.length >> 1]
  const keep = pairs.filter((_, i) => res[i] <= Math.max(30, 3 * med))
  if (keep.length >= 2) ({ s, t } = solve(keep))
  const rms = Math.sqrt(keep.reduce((a, [r, p]) => a + (p - (s * r + t)) ** 2, 0) / keep.length)
  return { scale: s, offset: t, rmsMm: Math.round(rms), n: keep.length }
}

export function comparePlans(planIn: Plan, refIn: Plan, opts: { matchMm?: number; view?: 'fore' | 'efter' } = {}): Comparison {
  // Compare one state: before (default) leaves out what is new, after what is demolished.
  const keep = (phase: string) => (opts.view === 'efter' ? phase !== 'demolish' : phase !== 'new')
  const only = (p: Plan): Plan => ({ ...p, walls: p.walls.filter((w) => keep(w.phase)), openings: p.openings.filter((o) => keep(o.phase)) })
  const plan = only(planIn)
  const ref = only(refIn)
  const P = new Map(plan.walls.map((w) => [w.id, w]))
  const R = new Map(ref.walls.map((w) => [w.id, w]))
  const shared = [...R.keys()].filter((id) => P.has(id) && vertical(P.get(id)!) === vertical(R.get(id)!))
  const xs: Array<[number, number]> = []
  const ys: Array<[number, number]> = []
  for (const id of shared) (vertical(R.get(id)!) ? xs : ys).push([centre(R.get(id)!), centre(P.get(id)!)])
  const fx = fitAxis(xs)
  const fy = fitAxis(ys)
  const map = (p: Pt): Pt => ({ x: fx.scale * p.x + fx.offset, y: fy.scale * p.y + fy.offset })

  const walls: WallDiff[] = shared.map((id) => {
    const r = R.get(id)!
    const w = P.get(id)!
    const v = vertical(r)
    const refPos = v ? fx.scale * centre(r) + fx.offset : fy.scale * centre(r) + fy.offset
    const pos = centre(w)
    const k = v ? fx.scale : fy.scale
    return {
      id,
      axis: v ? 'x' : 'y',
      refPos: Math.round(refPos),
      pos: Math.round(pos),
      diffMm: Math.round(pos - refPos),
      refThickness: Math.round(r.thickness * k),
      thickness: w.thickness,
      thicknessDiffMm: Math.round(w.thickness - r.thickness * k),
    }
  })

  // Openings: centre points in the plan's frame, matched to the nearest plan
  // opening (same orientation, within matchMm of the centre).
  const matchMm = opts.matchMm ?? 450
  const centreOf = (o: Opening, ws: Map<string, Wall>, f: (p: Pt) => Pt) => {
    const w = ws.get(o.wallId)
    if (!w) return null
    const d = wallDir(w)
    const t = o.offset + o.width / 2
    return { p: f({ x: w.a.x + d.x * t, y: w.a.y + d.y * t }), v: vertical(w), len: wallLength(w) }
  }
  const planOps = plan.openings.map((o) => ({ o, c: centreOf(o, P, (p) => p) })).filter((x) => x.c)
  const used = new Set<string>()
  const matched: OpeningMatch[] = []
  const missed: Comparison['openings']['missed'] = []
  for (const ro of ref.openings) {
    const rc = centreOf(ro, R, map)
    if (!rc) continue
    let best: { o: Opening; dist: number } | null = null
    for (const { o, c } of planOps) {
      if (used.has(o.id) || c!.v !== rc.v || (o.kind === 'window') !== (ro.kind === 'window')) continue
      const dist = Math.hypot(c!.p.x - rc.p.x, c!.p.y - rc.p.y)
      if (dist <= matchMm && (!best || dist < best.dist)) best = { o, dist }
    }
    if (best) {
      used.add(best.o.id)
      matched.push({ id: best.o.id, refId: ro.id, wallId: best.o.wallId, centreDiffMm: Math.round(best.dist), widthDiffMm: Math.round(best.o.width - ro.width * (rc.v ? fy.scale : fx.scale)) })
    } else missed.push({ refId: ro.id, wallId: ro.wallId, kind: ro.kind })
  }
  const extra = plan.openings.filter((o) => !used.has(o.id)).map((o) => ({ id: o.id, wallId: o.wallId, kind: o.kind }))
  return {
    fit: { x: fx, y: fy },
    walls: walls.sort((a, b) => Math.abs(b.diffMm) - Math.abs(a.diffMm)),
    wallsOnlyInRef: [...R.keys()].filter((id) => !P.has(id)),
    wallsOnlyInPlan: [...P.keys()].filter((id) => !R.has(id)),
    openings: { matched, missed, extra },
  }
}
