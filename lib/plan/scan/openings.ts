import { along, leftNormal, wallDir, wallLength } from '../geometry'
import { shiftToFree } from '../clear'
import type { Evidence, Opening, Plan, Wall } from '../types'
import { dark, toPx, type Gray, type Raster } from './raster'
import { findDoorSymbols } from './doors'
import { snapWall } from './snap'

// Finds openings in walls from the source drawing: where both of a wall's
// drawn faces stop (and the wall body isn't filled), there is a gap in the
// wall. Gaps of door width and up are returned as openings; which of them
// are doors, and which way those open, is for readDoors to decide.

export type Gap = { wallId: string; offset: number; width: number; method?: string }

function inkNear(g: Gray, r: Raster, x: number, y: number, threshold: number): boolean {
  const p = toPx(r, { x, y })
  for (const dx of [-1, 0, 1]) for (const dy of [-1, 0, 1]) if (dark(g, p.x + dx, p.y + dy, threshold)) return true
  return false
}

export function findGaps(g: Gray, r: Raster, wall: Wall, opts: { minWidth?: number; maxWidth?: number; endMargin?: number; threshold?: number } = {}): Gap[] {
  const minW = opts.minWidth ?? 450
  const maxW = opts.maxWidth ?? 2600
  const th = opts.threshold ?? 128
  const len = wallLength(wall)
  const d = wallDir(wall)
  const n = leftNormal(d)
  const half = wall.thickness / 2
  // Stay clear of the ends: crossing walls fill them.
  const margin = opts.endMargin ?? Math.max(60, half)
  const step = Math.max(5, r.mmPerPx / 2)
  // How much of the wall's band is ink at each step: faces, hatching or fill.
  // Drawings mark doorways differently (both faces stopped, one face dashed,
  // thin lines or ticks across), but always with clearly less ink than the
  // wall either side — so gaps are judged against the wall's own median.
  const ts: number[] = []
  const cover: number[] = []
  for (let t = margin; t <= len - margin + 1e-6; t += step) {
    const c = along(wall, t)
    let hit = 0
    let tot = 0
    for (let s = -1; s <= 1.0001; s += 0.25) {
      tot++
      if (inkNear(g, r, c.x + n.x * s * half, c.y + n.y * s * half, th)) hit++
    }
    ts.push(t)
    cover.push(hit / tot)
  }
  if (!cover.length) return []
  // Smooth over ~100 mm so dashes read as a lighter stretch, not as gaps.
  const k = Math.max(1, Math.round(50 / step))
  const smooth = cover.map((_, i) => {
    let s = 0
    let m = 0
    for (let j = Math.max(0, i - k); j <= Math.min(cover.length - 1, i + k); j++) {
      s += cover[j]
      m++
    }
    return s / m
  })
  const sorted = [...smooth].sort((a, b) => a - b)
  const median = sorted[sorted.length >> 1]
  const limit = Math.max(0.12, Math.min(0.45, median * 0.5))
  const gaps: Gap[] = []
  let start = -1
  for (let i = 0; i <= smooth.length; i++) {
    const open = i < smooth.length && smooth[i] < limit
    if (open && start < 0) start = i
    if (!open && start >= 0) {
      // Smoothing eats into the gap by its radius at each end: give it back.
      const s0 = Math.max(0, ts[start] - k * step)
      const s1 = Math.min(len, ts[i - 1] + step + k * step)
      const w = s1 - s0
      if (w >= minW && w <= maxW) gaps.push({ wallId: wall.id, offset: Math.round(s0), width: Math.round(w), method: 'mellanrum' })
      start = -1
    }
  }
  return gaps
}

// Doorways drawn as a dashed face: older Stockholm drawings outline each room
// as a closed figure and mark a door by dashing that outline across the
// doorway; the other face may stay solid. Each face line is located (the
// outline can sit a little off the wall's nominal face), sampled along the
// wall, and stretches that alternate ink and paper like dashes are openings.
// Junctions (breaks where another wall meets, passed in) and solid or
// missing lines are not dashes.
export function findDashed(g: Gray, r: Raster, wall: Wall, opts: { minWidth?: number; maxWidth?: number; endMargin?: number; threshold?: number; junctions?: Array<[number, number]> } = {}): Gap[] {
  const minW = opts.minWidth ?? 450
  const maxW = opts.maxWidth ?? 2600
  const th = opts.threshold ?? 128
  const len = wallLength(wall)
  const d = wallDir(wall)
  const n = leftNormal(d)
  const half = wall.thickness / 2
  const margin = opts.endMargin ?? Math.max(60, half)
  const step = r.mmPerPx / 2
  // Ink on a line across ±1 px only: dash gaps along the line must stay open.
  const inkAt = (t: number, off: number) => {
    const c = along(wall, t)
    for (const k of [-1, 0, 1]) {
      const p = toPx(r, { x: c.x + n.x * (off + k * r.mmPerPx), y: c.y + n.y * (off + k * r.mmPerPx) })
      if (dark(g, p.x, p.y, th)) return true
    }
    return false
  }
  const out: Gap[] = []
  for (const side of [1, -1]) {
    // The face line: the offset near the nominal face with the most ink.
    let bestOff = side * half
    let bestInk = -1
    const reach = Math.max(2 * r.mmPerPx, half * 0.35)
    for (let o = -reach; o <= reach + 1e-6; o += r.mmPerPx / 2) {
      let hits = 0
      let tot = 0
      for (let t = margin; t <= len - margin; t += 4 * step) {
        tot++
        if (inkAt(t, side * half + o)) hits++
      }
      if (tot && hits / tot > bestInk) {
        bestInk = hits / tot
        bestOff = side * half + o
      }
    }
    const ts: number[] = []
    const ink: boolean[] = []
    for (let t = margin; t <= len - margin + 1e-6; t += step) {
      ts.push(t)
      ink.push(inkAt(t, bestOff))
    }
    if (ink.length < 4) continue
    // Breaks in the line, short enough to be dash gaps (dashes drawn with a
    // pen are ~2-4 mm on paper with ~0.5-1 mm gaps), and not where another
    // wall meets this face (that break is the junction).
    const breaks: Array<[number, number]> = []
    let b0 = -1
    for (let i = 0; i <= ink.length; i++) {
      const off = i < ink.length && !ink[i]
      if (off && b0 < 0) b0 = i
      if (!off && b0 >= 0) {
        const a = ts[b0]
        const e = ts[i - 1] + step
        const bl = e - a
        const atJunction = (opts.junctions ?? []).some(([c, rad]) => a < c + rad && e > c - rad)
        if (b0 > 0 && i < ink.length && bl >= 25 && bl <= 140 && !atJunction) breaks.push([a, e])
        b0 = -1
      }
    }
    // Runs of breaks spaced like dashes (150-550 mm apart): at least two
    // breaks, i.e. three dashes, make a dashed stretch. It reaches about one
    // dash beyond the outer breaks; where an end dash runs into the solid
    // line can't be seen, so ends are good to about one dash length.
    let k = 0
    while (k < breaks.length) {
      let m = k
      // Dash gaps are drawn alike: lengths within a factor 2 of each other
      // (scan noise makes breaks of any length).
      const blen = (q: number) => breaks[q][1] - breaks[q][0]
      const alike = (q: number) => Math.max(blen(q), blen(k)) <= 2 * Math.min(blen(q), blen(k))
      while (m + 1 < breaks.length && breaks[m + 1][0] - breaks[m][1] >= 120 && breaks[m + 1][0] - breaks[m][1] <= 550 && alike(m + 1)) m++
      if (m > k) {
        let dash = 0
        for (let q = k; q < m; q++) dash += breaks[q + 1][0] - breaks[q][1]
        dash /= m - k
        const s0 = Math.max(0, breaks[k][0] - dash)
        const s1 = Math.min(len, breaks[m][1] + dash)
        if (s1 - s0 >= minW && s1 - s0 <= maxW) out.push({ wallId: wall.id, offset: Math.round(s0), width: Math.round(s1 - s0), method: 'streckad' })
      }
      k = m + 1
    }
  }
  return mergeGaps(out)
}

// Opening centres drawn as a short line across the wall (the 1936 Stockholm
// plans): ink just outside both faces, nothing running along the wall
// beside it (so not a crossing wall), and ending within ~0.6 m (so not a
// wall continuing). The drawing gives no width: a standard width is used,
// marked as estimated in the method name.
export const CENTRE_MARK_WIDTH = 800

export function findCentreMarks(g: Gray, r: Raster, wall: Wall, opts: { threshold?: number; junctions?: Array<[number, number]>; width?: number; oneSided?: boolean; oneSidedWidth?: number } = {}): Gap[] {
  const th = opts.threshold ?? 128
  const width = opts.width ?? CENTRE_MARK_WIDTH
  const d = wallDir(wall)
  const n = leftNormal(d)
  const len = wallLength(wall)
  const h = wall.thickness / 2
  const ink = (x: number, y: number) => {
    const p = toPx(r, { x, y })
    return dark(g, p.x, p.y, th) || dark(g, p.x + 1, p.y, th) || dark(g, p.x - 1, p.y, th) || dark(g, p.x, p.y + 1, th) || dark(g, p.x, p.y - 1, th)
  }
  const hits: number[] = []
  const oneSided: number[] = []
  for (let t = 150; t < len - 150; t += 10) {
    if ((opts.junctions ?? []).some(([c, rad]) => Math.abs(t - c) < rad + 60)) continue
    const c = along(wall, t)
    const at = (side: number, off: number, dt = 0) => ink(c.x + n.x * side * (h + off) + d.x * dt, c.y + n.y * side * (h + off) + d.y * dt)
    // The mark ends somewhere 0.26-0.7 m out (a wall would continue); room
    // labels written near a door must not hide that end.
    const ends = (side: number, from = 260) => {
      for (let o = from; o <= 700; o += 20) if (!at(side, o)) return true
      return false
    }
    // A mark: drawn from the face out, thin (nothing beside it), ending.
    const mark = (side: number) => at(side, 40) && at(side, 120) && at(side, 220) && !at(side, 170, 70) && !at(side, 170, -70) && ends(side)
    if (mark(1) && mark(-1)) hits.push(t)
    // Doors into small rooms (WC, closet) are often marked on the hall side
    // only: one-sided marks, kept apart and given a smaller standard width.
    // These are drawn shorter (~0.15-0.25 m), so they need less length,
    // and must stay clear of the wall's ends (corner lines look the same).
    else if (opts.oneSided !== false && t > 300 && t < len - 300 && !(opts.junctions ?? []).some(([c, rad]) => Math.abs(t - c) < rad + 250)) {
      const short = (side: number) => at(side, 40) && at(side, 120) && !at(side, 120, 70) && !at(side, 120, -70) && ends(side, 160)
      if (short(1) || short(-1)) oneSided.push(t)
    }
  }
  // A line drawn with a pen is 1-3 px wide: hits within 60 mm are one mark;
  // a run much wider than a pen line is something else (a wall, text).
  const group = (ts: number[]) => {
    const out: Array<[number, number]> = []
    for (const t of ts) {
      const last = out[out.length - 1]
      if (last && t - last[1] <= 60) last[1] = t
      else out.push([t, t])
    }
    return out.filter(([a, b]) => b - a <= Math.max(60, 6 * r.mmPerPx)).map(([a, b]) => (a + b) / 2)
  }
  const one = group(oneSided).filter((c) => !hits.some((t) => Math.abs(t - c) < 150))
  const make = (c: number, w: number, method: string) => ({ wallId: wall.id, offset: Math.round(Math.max(0, c - w / 2)), width: Math.round(Math.min(w, len)), method })
  return [
    ...group(hits).map((c) => make(c, width, 'mittstreck (bredd uppskattad)')),
    ...one.map((c) => make(c, opts.oneSidedWidth ?? 700, 'mittstreck ensidig (bredd uppskattad)')),
  ]
    .filter((gp) => gp.offset + gp.width <= len)
    .sort((a, b) => a.offset - b.offset)
}

// Overlapping finds (both faces, or gap and dashes) are one opening.
function mergeGaps(gs: Gap[]): Gap[] {
  const sorted = [...gs].sort((a, b) => a.offset - b.offset)
  const out: Gap[] = []
  for (const gp of sorted) {
    const last = out[out.length - 1]
    if (last && last.wallId === gp.wallId && gp.offset <= last.offset + last.width) {
      const end = Math.max(last.offset + last.width, gp.offset + gp.width)
      last.width = end - last.offset
      if (gp.method && !(last.method ?? '').split('+').includes(gp.method)) last.method = last.method ? `${last.method}+${gp.method}` : gp.method
    } else out.push({ ...gp })
  }
  return out
}

// A long wall is often drawn in parts (a face that jogs, another thickness
// past a crossing wall), and one straight fit then misses it or scatters.
// Each stretch between crossing walls is located on its own instead.
const PART_RMS = 40

export function locateParts(g: Gray, r: Raster, wall: Wall, plan: Plan, threshold?: number): Array<{ t0: number; t1: number; part: Wall; drawn?: Wall }> {
  const len = wallLength(wall)
  const cuts = junctionsOn(wall, plan)
    .filter(([t]) => t > 0 && t < len)
    .sort((a, b) => a[0] - b[0])
  const out: Array<{ t0: number; t1: number; part: Wall; drawn?: Wall }> = []
  let prev: [number, number] = [0, 0]
  for (const cut of [...cuts, [len, 0] as [number, number]]) {
    const t0 = prev[0] + prev[1]
    const t1 = cut[0] - cut[1]
    prev = cut
    if (t1 - t0 < 300) continue
    const part: Wall = { ...wall, id: `${wall.id}@${Math.round(t0)}`, a: along(wall, t0), b: along(wall, t1) }
    const fit = snapWall(g, r, part, [], { threshold, square: true })
    out.push({ t0, t1, part, drawn: fit.wall && fit.report.ok ? fit.wall : undefined })
  }
  // A stretch much thinner than the rest, or off their line, is a label or
  // a leader line read as a wall.
  const drawn = out.filter((x) => x.drawn)
  const thick = drawn.map((x) => x.drawn!.thickness).sort((a, b) => a - b)[drawn.length >> 1]
  const off = (q: Wall) => offsetOf(wall, along(q, wallLength(q) / 2))
  const odd = drawn.filter((x) => {
    const others = drawn.filter((o) => o !== x).map((o) => off(o.drawn!))
    return x.drawn!.thickness < 0.6 * thick || (others.length > 0 && others.every((o) => Math.abs(o - off(x.drawn!)) > 0.3 * thick))
  })
  for (const x of odd) x.drawn = undefined
  return out
}

// Stretches drawn with clearly different thickness or line: one fit for
// the whole wall would misread them.
function partsDiffer(parts: Array<{ part: Wall; drawn?: Wall }>): boolean {
  const ds = parts.filter((x) => x.drawn).map((x) => ({ t: x.drawn!.thickness, c: offsetOf(x.part, along(x.drawn!, wallLength(x.drawn!) / 2)) }))
  return ds.some((a) => ds.some((b) => Math.abs(a.t - b.t) > 0.2 * Math.max(a.t, b.t) || Math.abs(a.c - b.c) > 0.2 * Math.max(a.t, b.t)))
}

// Signed distance of p from the wall's centreline (towards its left normal).
function offsetOf(wall: Wall, p: { x: number; y: number }): number {
  const n = leftNormal(wallDir(wall))
  return (p.x - wall.a.x) * n.x + (p.y - wall.a.y) * n.y
}

// Do the faces of the drawn stretches either side stop across this one?
// Both must: a wall hidden by fixtures still has its faces running through.
function facesStop(g: Gray, r: Raster, wall: Wall, x: { t0: number; t1: number }, sides: Array<{ drawn?: Wall } | undefined>, threshold?: number): boolean {
  const ns = sides.map((p) => p?.drawn)
  if (!ns[0] || !ns[1]) return false
  const n = leftNormal(wallDir(wall))
  const th = threshold ?? 128
  const centres = ns.map((d) => offsetOf(wall, along(d!, wallLength(d!) / 2)))
  const mid = (centres[0] + centres[1]) / 2
  const faces = ns.flatMap((d, i) => [centres[i] - d!.thickness / 2, centres[i] + d!.thickness / 2])
  // A face line runs on unbroken; a label written across it does not.
  return faces.every((f) => {
    let run = 0
    let longest = 0
    let tot = 0
    for (let t = x.t0 + 60; t <= x.t1 - 60; t += 10) {
      const c = along(wall, t)
      tot++
      const inkAt = (o: number) => {
        const p = toPx(r, { x: c.x + n.x * o, y: c.y + n.y * o })
        return dark(g, p.x, p.y, th)
      }
      // Line-like: ink at the face, paper just outside the wall.
      let hit = false
      for (let e = -20; e <= 20 && !hit; e += 5) hit = inkAt(f + e) && !inkAt(f + e + Math.sign(f - mid) * 70)
      run = hit ? run + 1 : 0
      longest = Math.max(longest, run)
    }
    return tot > 0 && longest / tot < 0.4
  })
}

// How far a's position moved along the wall when it was located in the source.
function shiftOf(w: Wall, drawn: Wall): number {
  const d = wallDir(w)
  return (drawn.a.x - w.a.x) * d.x + (drawn.a.y - w.a.y) * d.y
}

// Where other plan walls meet or cross this one: [position along it, radius].
function junctionsOn(w: Wall, plan: Plan): Array<[number, number]> {
  const d = wallDir(w)
  const n = leftNormal(d)
  const len = wallLength(w)
  const out: Array<[number, number]> = []
  for (const o of plan.walls) {
    if (o.id === w.id) continue
    const rad = o.thickness / 2 + 40
    const pts = [o.a, o.b]
    // Ends that touch this wall, and crossings of its line.
    for (const p of pts) {
      const t = (p.x - w.a.x) * d.x + (p.y - w.a.y) * d.y
      const off = Math.abs((p.x - w.a.x) * n.x + (p.y - w.a.y) * n.y)
      if (t > -rad && t < len + rad && off <= w.thickness / 2 + o.thickness / 2 + 60) out.push([t, rad])
    }
    const e = wallDir(o)
    const den = d.x * e.y - d.y * e.x
    if (Math.abs(den) > 0.2) {
      const t = ((o.a.x - w.a.x) * e.y - (o.a.y - w.a.y) * e.x) / den
      const u = ((o.a.x - w.a.x) * d.y - (o.a.y - w.a.y) * d.x) / den
      if (t > 0 && t < len && u > -rad && u < wallLength(o) + rad) out.push([t, rad])
    }
  }
  return out
}

export const METHODS = ['mellanrum', 'streckad', 'mittstreck', 'dörrbåge'] as const
type Find = Gap & { hinge?: 'a' | 'b'; swing?: 'left' | 'right' }

// How each method fares on the openings the plan already has (doors and
// passages; windows are read from facades): how many it finds. Drawings
// use one or two conventions, so a method that finds (almost) none of the
// known openings in a drawing only finds noise there.
export type MethodCheck = { method: string; found: number; known: number; used: boolean }

// Openings the source shows, against the plan: new ones (with evidence),
// found as gaps, dashed faces or door symbols, and confirmations of
// existing ones (evidence to add to them). The source may draw a wall a
// little off the plan's line (another drawing, measured differently): each
// wall is first located in the source with the snap fit, gaps are read
// along that line, and walls the source doesn't show are skipped rather
// than read as one long gap. Door symbols are searched along the plan's
// line, so they are found in walls that can't be located too.
//
// methods: which detectors to use; 'auto' (default) tests each on the
// plan's known openings and uses those that find at least a quarter of
// them (old drawings leave WC and closet doors out, so not more).
export function newOpenings(
  g: Gray,
  r: Raster,
  plan: Plan,
  ids?: string[],
  threshold?: number,
  methods: string[] | 'auto' = 'auto',
): { openings: Opening[]; confirms: Array<{ id: string; evidence: Evidence }>; skipped: string[]; located: Map<Wall, Wall>; checks: MethodCheck[] } {
  const skipped: string[] = []
  const located = new Map<Wall, Wall>()
  // 1. Every method on every wall, kept apart.
  const raw = new Map<string, Record<string, Find[]>>()
  const walls = plan.walls.filter((w) => !ids || ids.includes(w.id) || plan.openings.some((o) => o.wallId === w.id && o.kind !== 'window'))
  for (const w of walls) {
    const per: Record<string, Find[]> = { mellanrum: [], streckad: [], mittstreck: [], dörrbåge: [] }
    // One-sided marks only in light interior partitions (WC and closet
    // doors): on facades, party and load-bearing walls whatever is drawn
    // on the far side reads as a mark.
    const light = !w.exterior && !w.apartmentBoundary && !w.loadBearing
    // Reads the detectors along a located stretch `drawn` that starts at `from` on w.
    const read = (drawn: Wall, part: Wall, from: number) => {
      const shift = from + shiftOf(part, drawn)
      const junctions = junctionsOn(w, plan).map(([t, rad]) => [t - shift, rad] as [number, number])
      const back = (fs: Gap[]) => fs.map((f) => ({ ...f, offset: Math.round(f.offset + shift) }))
      per.mellanrum.push(...back(findGaps(g, r, drawn, { threshold })))
      per.streckad.push(...back(findDashed(g, r, drawn, { threshold, junctions })))
      // A centre mark gives the centre only, and its width is a guess: it moves
      // along the wall (up to 0.25 m) to clear the walls it meets, and says so.
      const clearMark = (f: Gap): Gap => {
        const o = shiftToFree(plan, w, f.offset, f.width)
        if (o === null) return { ...f, method: `${f.method}, ligger mot vägg` }
        if (o === f.offset) return f
        return { ...f, offset: o, method: `${f.method}, flyttad ${Math.abs(o - f.offset)} mm från vägg` }
      }
      per.mittstreck.push(...back(findCentreMarks(g, r, drawn, { threshold, junctions, oneSided: light })).map(clearMark))
    }
    const fit = snapWall(g, r, w, [], { threshold, square: true })
    const parts = locateParts(g, r, w, plan, threshold)
    if (fit.wall && fit.report.ok && fit.report.rmsMm <= PART_RMS && !partsDiffer(parts)) {
      located.set(w, fit.wall)
      read(fit.wall, w, 0)
    } else {
      if (!parts.some((x) => x.drawn)) skipped.push(w.id)
      parts.forEach((x, i) => {
        if (x.drawn) read(x.drawn, x.part, x.t0)
        // A stretch whose faces stop between two stretches that are drawn: a
        // passage the whole width between the crossing walls.
        else if (x.t1 - x.t0 >= 450 && x.t1 - x.t0 <= 2600 && facesStop(g, r, w, x, [parts[i - 1], parts[i + 1]], threshold))
          per.mellanrum.push({ wallId: w.id, offset: Math.round(x.t0), width: Math.round(x.t1 - x.t0), method: 'mellanrum (hel sträcka)' })
      })
    }
    per.dörrbåge = findDoorSymbols(g, r, w, { threshold }).map((d) => ({ wallId: w.id, offset: d.offset, width: d.width, hinge: d.hinge, swing: d.swing, method: 'dörrbåge' }))
    raw.set(w.id, per)
  }
  // 2. Which methods this drawing answers to.
  // Learn only from openings some other archive drawing shows: not ones
  // drawn in by hand, nor ones from a survey of today's flat (role
  // before/after) – that would let the survey steer an archive-only build.
  const archive = new Set((plan.sources ?? []).filter((x) => x.role === 'archive' && x.id !== r.id).map((x) => x.id))
  const known = plan.openings.filter((o) => o.kind !== 'window' && raw.has(o.wallId) && (o.evidence ?? []).some((e) => archive.has(e.source)))
  const hitsKnown = (f: Find, o: Opening) => f.wallId === o.wallId && Math.min(f.offset + f.width, o.offset + o.width) - Math.max(f.offset, o.offset) >= 0.5 * Math.min(f.width, o.width)
  const checks: MethodCheck[] = METHODS.map((m) => {
    const found = known.filter((o) => (raw.get(o.wallId)?.[m] ?? []).some((f) => hitsKnown(f, o))).length
    const used = methods === 'auto' ? known.length < 3 || found >= Math.max(2, known.length / 4) : methods.includes(m)
    return { method: m, found, known: known.length, used }
  })
  const isUsed = (m: string) => checks.find((c) => c.method === m)?.used
  // 3. Merge the used methods per wall, compare with the plan.
  const out: Opening[] = []
  // Ids not used by the plan or by earlier finds.
  const taken = new Set(plan.openings.map((o) => o.id))
  const freeId = (wallId: string) => {
    let k = 1
    while (taken.has(`o-${wallId}-${k}`)) k++
    taken.add(`o-${wallId}-${k}`)
    return `o-${wallId}-${k}`
  }
  const confirms: Array<{ id: string; evidence: Evidence }> = []
  for (const w of walls) {
    if (ids && !ids.includes(w.id)) continue
    const per = raw.get(w.id)!
    const existing = plan.openings.filter((o) => o.wallId === w.id)
    const finds: Find[] = mergeGaps([...(isUsed('mellanrum') ? per.mellanrum : []), ...(isUsed('streckad') ? per.streckad : [])])
    // A centre mark only where nothing better shows the opening.
    for (const m of isUsed('mittstreck') ? per.mittstreck : [])
      if (!finds.some((f) => Math.min(f.offset + f.width, m.offset + m.width) - Math.max(f.offset, m.offset) > 0)) finds.push(m)
    // A door symbol gives the swing; its width is read in 100 mm steps, so a
    // gap of about that width keeps its own, measured extent.
    for (const dr of isUsed('dörrbåge') ? per.dörrbåge : []) {
      const same = finds.findIndex((f) => Math.min(f.offset + f.width, dr.offset + dr.width) - Math.max(f.offset, dr.offset) > 0.3 * dr.width)
      if (same < 0) {
        finds.push(dr)
        continue
      }
      const f = finds[same]
      const extent = Math.abs(f.width - dr.width) <= 150 ? { offset: f.offset, width: f.width } : {}
      finds[same] = { ...dr, ...extent, method: `${f.method}+dörrbåge` }
    }
    for (const gp of finds) {
      const offset = gp.offset
      if (offset < 0 || offset + gp.width > wallLength(w)) continue
      const evidence: Evidence = { source: r.id, method: gp.method ?? 'mellanrum', offset, width: gp.width }
      const ov = (o: Opening) => Math.min(o.offset + o.width, offset + gp.width) - Math.max(o.offset, offset)
      const hit = existing.find((o) => ov(o) > 0)
      if (hit) {
        // Plan drawings show windows as lines across the wall, not gaps:
        // a find there is no evidence for the window (facades are).
        if (hit.kind === 'window') continue
        // Evidence only when it is the same opening: overlapping by at least
        // half of the larger one (not a long merged find spanning several).
        const same = ov(hit) >= 0.5 * Math.max(hit.width, gp.width)
        if (same && !hit.evidence?.some((e) => e.source === r.id)) confirms.push({ id: hit.id, evidence })
        continue
      }
      out.push({
        id: freeId(w.id),
        wallId: w.id,
        kind: gp.hinge ? 'door' : 'opening',
        offset,
        width: gp.width,
        phase: 'existing',
        ...(gp.hinge ? { hinge: gp.hinge, swing: gp.swing } : {}),
        // No wall left between the walls it runs between: the rooms either side are one space.
        ...(!gp.hinge && gp.method?.includes('hel sträcka') ? { through: true } : {}),
        evidence: [evidence],
      })
    }
  }
  return { openings: out, confirms, skipped: skipped.filter((id) => !ids || ids.includes(id)), located, checks }
}

// Whether the source shows this stretch of wall as solid (no gap or dashes
// overlapping it) – for checking an opening found in another drawing.
export function showsWall(g: Gray, r: Raster, plan: Plan, wall: Wall, offset: number, width: number, threshold?: number): boolean | undefined {
  const fit = snapWall(g, r, wall, [], { threshold, square: true })
  if (!fit.wall || !fit.report.ok) return undefined
  const shift = shiftOf(wall, fit.wall)
  const junctions = junctionsOn(wall, plan).map(([t, rad]) => [t - shift, rad] as [number, number])
  const gaps = mergeGaps([...findGaps(g, r, fit.wall, { threshold }), ...findDashed(g, r, fit.wall, { threshold, junctions })])
  return !gaps.some((gp) => Math.min(gp.offset + shift + gp.width, offset + width) - Math.max(gp.offset + shift, offset) > 0.3 * width)
}
