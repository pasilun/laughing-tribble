import { dist, leftNormal, wallDir, wallLength } from '../geometry'
import type { Op } from '../ops'
import type { Plan, Pt, Wall } from '../types'
import { profile, type Run } from './profile'
import type { Gray, Raster } from './raster'

// Snaps roughly placed walls onto the source drawing: cross-sections across
// each wall find the drawn wall body (a filled band or a pair of outlines),
// a robust line fit through their centres gives position and angle, and the
// median width gives thickness. Ends near another wall are then joined at
// the centreline intersection.

export type SnapOptions = {
  searchMm?: number        // how far either side of the rough line to look
  sections?: number        // cross-sections per wall
  threshold?: number       // grey level counted as ink
  keepThickness?: boolean  // only move, don't change thickness
  joinMm?: number          // ends this close to another wall are joined
  square?: boolean         // walls within SQUARE_DEG of the axes are made exactly straight (default on)
  priorThickness?: number  // thickness to prefer instead of the wall's current one (which may be a bad first guess)
}

// Scans give noisy angles on short walls (fixtures in the way) and are often
// slightly skewed; real walls near the axes are meant to be on them.
const SQUARE_DEG = 3

function squared(a: Pt, b: Pt): { a: Pt; b: Pt } {
  const deg = (Math.atan2(Math.abs(b.y - a.y), Math.abs(b.x - a.x)) * 180) / Math.PI
  if (deg <= SQUARE_DEG) {
    const y = (a.y + b.y) / 2
    return { a: { x: a.x, y }, b: { x: b.x, y } }
  }
  if (deg >= 90 - SQUARE_DEG) {
    const x = (a.x + b.x) / 2
    return { a: { x, y: a.y }, b: { x, y: b.y } }
  }
  return { a, b }
}

export type SnapReport = {
  id: string
  ok: boolean
  confidence: number      // share of cross-sections that agree with the fit
  sections: number
  shiftMm: number         // largest end movement from the rough line
  angleDeg: number        // rotation from the rough line
  thicknessMm: number     // measured
  rmsMm: number           // scatter of section centres around the fitted line
  note?: string
}

type Section = { t: number; centre: number; width: number }

function candidates(runs: Run[], search: number, expect?: number): Array<{ centre: number; width: number; score: number }> {
  const out: Array<{ centre: number; width: number; score: number }> = []
  // A pair of outlines is measured line centre to line centre: drawn lines
  // straddle the wall face.
  const consider = (from: number, to: number, pair: boolean) => {
    const width = to - from
    if (width < 35 || width > 600) return
    const centre = (from + to) / 2
    const off = Math.abs(centre - search) / search
    const thick = expect ? Math.abs(width - expect) / expect : width > 400 ? 0.5 : 0
    out.push({ centre, width, score: off + 1.5 * thick + (pair ? 0.05 : 0) })
  }
  for (let i = 0; i < runs.length; i++) {
    consider(runs[i].from, runs[i].to, false)
    for (let j = i + 1; j < runs.length; j++) consider(runs[i].mid, runs[j].mid, true)
  }
  return out.sort((a, b) => a.score - b.score)
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

// Least-squares line centre(t) = a + b·t through the inliers.
function fitLine(ss: Section[]): { a: number; b: number } {
  if (ss.length === 1) return { a: ss[0].centre, b: 0 }
  const n = ss.length
  const mt = ss.reduce((s, x) => s + x.t, 0) / n
  const mc = ss.reduce((s, x) => s + x.centre, 0) / n
  let num = 0
  let den = 0
  for (const x of ss) {
    num += (x.t - mt) * (x.centre - mc)
    den += (x.t - mt) ** 2
  }
  const b = den > 0 ? num / den : 0
  return { a: mc - b * mt, b }
}

// Fits one wall. Returns the new centreline and thickness, or a report of why not.
export function snapWall(g: Gray, r: Raster, wall: Wall, skip: Array<[number, number]>, opts: SnapOptions = {}): { wall?: Wall; report: SnapReport } {
  const search = opts.searchMm ?? Math.max(150, wall.thickness * 1.5)
  const count = opts.sections ?? 11
  const len = wallLength(wall)
  const d = wallDir(wall)
  const n = leftNormal(d)
  const fail = (note: string): { report: SnapReport } => ({
    report: { id: wall.id, ok: false, confidence: 0, sections: 0, shiftMm: 0, angleDeg: 0, thicknessMm: 0, rmsMm: 0, note },
  })
  if (len < 100) return fail('för kort vägg')

  // Positions in the middle 70 % (ends run into crossing walls), clear of
  // openings, spread evenly.
  const free: number[] = []
  for (let i = 0; i <= 60; i++) {
    const t = len * (0.15 + (0.7 * i) / 60)
    if (!skip.some(([s, e]) => t > s - 80 && t < e + 80)) free.push(t)
  }
  const picks = free.length <= count ? free : Array.from({ length: count }, (_, i) => free[Math.round((i * (free.length - 1)) / Math.max(1, count - 1))])
  if (picks.length === 0) return fail('väggen är öppningar hela vägen')
  const sections: Section[] = []
  for (const t of picks) {
    const c = { x: wall.a.x + d.x * t, y: wall.a.y + d.y * t }
    const from = { x: c.x - n.x * search, y: c.y - n.y * search }
    const to = { x: c.x + n.x * search, y: c.y + n.y * search }
    const best = candidates(profile(g, r, from, to, opts.threshold).runs, search, opts.priorThickness ?? wall.thickness)[0]
    // Section coordinate: + towards the left normal, 0 on the rough line.
    if (best && best.score < 1.2) sections.push({ t, centre: best.centre - search, width: best.width })
  }
  if (sections.length < 2) return fail('hittade ingen ritad vägg här – fel läge, eller väggen saknas i underlaget')

  // Robust fit: median line first, then refit on sections within 25 mm.
  const med = median(sections.map((s) => s.centre))
  let inliers = sections.filter((s) => Math.abs(s.centre - med) <= 40)
  if (inliers.length < 2) inliers = sections
  let fit = fitLine(inliers)
  inliers = sections.filter((s) => Math.abs(s.centre - (fit.a + fit.b * s.t)) <= 25)
  if (inliers.length >= 2) fit = fitLine(inliers)
  else inliers = sections
  const thickness = median(inliers.map((s) => s.width))
  const rms = Math.sqrt(inliers.reduce((s, x) => s + (x.centre - (fit.a + fit.b * x.t)) ** 2, 0) / inliers.length)

  const offA = fit.a
  const offB = fit.a + fit.b * len
  const fitted = { a: { x: wall.a.x + n.x * offA, y: wall.a.y + n.y * offA }, b: { x: wall.b.x + n.x * offB, y: wall.b.y + n.y * offB } }
  const { a, b } = opts.square === false ? fitted : squared(fitted.a, fitted.b)
  const confidence = inliers.length / picks.length
  const report: SnapReport = {
    id: wall.id,
    ok: confidence >= 0.4,
    confidence: Math.round(confidence * 100) / 100,
    sections: inliers.length,
    shiftMm: Math.round(Math.max(Math.abs(offA), Math.abs(offB))),
    angleDeg: Math.round((Math.atan(fit.b) * 180) / Math.PI * 100) / 100,
    thicknessMm: Math.round(thickness),
    rmsMm: Math.round(rms * 10) / 10,
  }
  if (!report.ok) report.note = 'osäker – få tvärsnitt stämmer, kontrollera i bilden'
  const t = opts.keepThickness ? wall.thickness : Math.round(thickness / 5) * 5
  return { wall: { ...wall, a, b, thickness: t }, report }
}

// The same wall fitted in several drawings of the floor: each drawing's
// pen and scan blur differ, so the median of their positions and
// thicknesses is steadier than any one of them.
export function snapWallConsensus(srcs: Array<{ g: Gray; r: Raster }>, wall: Wall, skip: Array<[number, number]>, opts: SnapOptions = {}): { wall?: Wall; report: SnapReport } {
  const runs = srcs.map(({ g, r }) => ({ id: r.id, ...snapWall(g, r, wall, skip, opts) }))
  // A fit tilted away from the others caught something else (a fixture, a
  // neighbouring line) in that drawing.
  const fits = runs.filter((x) => x.report.ok && x.wall)
  const tilt = fits.length ? median(fits.map((x) => x.report.angleDeg)) : 0
  const ok = fits.filter((x) => Math.abs(x.report.angleDeg - tilt) <= 1)
  const per = runs.map((x) => `${x.id} ${ok.includes(x) ? x.report.thicknessMm : '–'}`).join(', ')
  if (ok.length < Math.min(2, srcs.length)) {
    const report = ok[0]?.report ?? runs[0].report
    return { report: { ...report, id: wall.id, ok: false, note: `för få ritningar visar väggen (${per})` } }
  }
  const n = leftNormal(wallDir(wall))
  const off = (p: Pt, q: Pt) => (q.x - p.x) * n.x + (q.y - p.y) * n.y
  const offA = median(ok.map((x) => off(wall.a, x.wall!.a)))
  const offB = median(ok.map((x) => off(wall.b, x.wall!.b)))
  const thickness = median(ok.map((x) => x.report.thicknessMm))
  const fitted = { a: { x: wall.a.x + n.x * offA, y: wall.a.y + n.y * offA }, b: { x: wall.b.x + n.x * offB, y: wall.b.y + n.y * offB } }
  const { a, b } = opts.square === false ? fitted : squared(fitted.a, fitted.b)
  const report: SnapReport = {
    id: wall.id,
    ok: true,
    confidence: Math.round(median(ok.map((x) => x.report.confidence)) * 100) / 100,
    sections: ok.reduce((t, x) => t + x.report.sections, 0),
    shiftMm: Math.round(Math.max(Math.abs(offA), Math.abs(offB))),
    angleDeg: Math.round((Math.atan2(offB - offA, wallLength(wall)) * 180) / Math.PI * 100) / 100,
    thicknessMm: Math.round(thickness),
    rmsMm: Math.round(median(ok.map((x) => x.report.rmsMm)) * 10) / 10,
    note: `median av ${ok.length} ritningar (tj ${per})`,
  }
  const t = opts.keepThickness ? wall.thickness : Math.round(thickness / 5) * 5
  return { wall: { ...wall, a, b, thickness: t }, report }
}

function intersect(p: Pt, d: Pt, q: Pt, e: Pt): Pt | null {
  const den = d.x * e.y - d.y * e.x
  if (Math.abs(den) < 1e-6) return null
  const s = ((q.x - p.x) * e.y - (q.y - p.y) * e.x) / den
  return { x: p.x + d.x * s, y: p.y + d.y * s }
}

// Moves each snapped end onto the centreline of the wall it meets (L-corner
// or T-junction), when that wall is within joinMm.
export function joinEnds(walls: Wall[], others: Wall[], joinMm: number): Wall[] {
  const out = walls.map((w) => ({ ...w }))
  const all = () => [...out, ...others]
  for (const w of out) {
    for (const end of ['a', 'b'] as const) {
      const p = w[end]
      const d = wallDir(w)
      let best: { q: Pt; dd: number } | null = null
      for (const o of all()) {
        if (o.id === w.id) continue
        const e = wallDir(o)
        if (Math.abs(d.x * e.y - d.y * e.x) < 0.2) continue // near-parallel
        const q = intersect(p, d, o.a, e)
        if (!q) continue
        const dd = dist(p, q)
        // The meeting point must lie on (or just past the end of) the other wall.
        const lo = wallLength(o)
        const s = (q.x - o.a.x) * e.x + (q.y - o.a.y) * e.y
        if (s < -joinMm || s > lo + joinMm) continue
        if (dd <= joinMm && (!best || dd < best.dd)) best = { q, dd }
      }
      if (best) w[end] = best.q
    }
  }
  return out
}

function rounded(w: Wall): Wall {
  return { ...w, a: { x: Math.round(w.a.x), y: Math.round(w.a.y) }, b: { x: Math.round(w.b.x), y: Math.round(w.b.y) } }
}

// Snaps existing walls (by id) and/or new rough walls, joins their ends and
// returns the ops that apply the result, plus a report per wall.
// With more drawings in `also`, each wall is the median over all of them.
export function snapWalls(
  g: Gray,
  r: Raster,
  plan: Plan,
  input: { ids?: string[]; add?: Wall[] },
  opts: SnapOptions = {},
  also: Array<{ g: Gray; r: Raster }> = [],
): { ops: Op[]; reports: SnapReport[]; walls: Wall[] } {
  const reports: SnapReport[] = []
  const snapped: Wall[] = []
  const targets: Array<{ wall: Wall; isNew: boolean }> = []
  for (const id of input.ids ?? []) {
    const w = plan.walls.find((x) => x.id === id)
    if (!w) {
      reports.push({ id, ok: false, confidence: 0, sections: 0, shiftMm: 0, angleDeg: 0, thicknessMm: 0, rmsMm: 0, note: 'väggen finns inte' })
      continue
    }
    targets.push({ wall: w, isNew: false })
  }
  for (const w of input.add ?? []) targets.push({ wall: { ...w, phase: w.phase ?? 'existing', thickness: w.thickness || 120 }, isNew: true })

  for (const { wall } of targets) {
    const skip = plan.openings
      .filter((o) => o.wallId === wall.id)
      .map((o) => [o.offset, o.offset + o.width] as [number, number])
    const res = also.length ? snapWallConsensus([{ g, r }, ...also], wall, skip, opts) : snapWall(g, r, wall, skip, opts)
    reports.push(res.report)
    // An unsure fit still joins, but keeps its rough position.
    snapped.push(res.wall && res.report.ok ? res.wall : wall)
  }

  const ids = new Set(targets.map((t) => t.wall.id))
  const others = plan.walls.filter((w) => !ids.has(w.id))
  const joined = joinEnds(snapped, others, opts.joinMm ?? 250).map(rounded)

  const ops: Op[] = []
  // Unsnapped walls joined to a moved end follow it; the explicit updates
  // below then set the snapped walls exactly.
  joined.forEach((w, i) => {
    const { wall: orig, isNew } = targets[i]
    if (isNew) return
    for (const end of ['a', 'b'] as const)
      if (others.some((o) => dist(o.a, orig[end]) <= 1 || dist(o.b, orig[end]) <= 1)) ops.push({ op: 'moveVertex', from: orig[end], to: w[end] })
  })
  joined.forEach((w, i) => {
    const { wall: orig, isNew } = targets[i]
    if (isNew) {
      ops.push({ op: 'add', kind: 'wall', item: w })
      return
    }
    ops.push({ op: 'update', kind: 'wall', id: w.id, patch: { a: w.a, b: w.b, thickness: w.thickness } })
    // Openings are measured from the a-end: keep them where they were drawn.
    const d = wallDir(w)
    const shift = (orig.a.x - w.a.x) * d.x + (orig.a.y - w.a.y) * d.y
    const newLen = wallLength(w)
    for (const o of plan.openings.filter((x) => x.wallId === w.id)) {
      const offset = Math.round(Math.max(0, Math.min(newLen - o.width, o.offset + shift)))
      if (offset !== o.offset) ops.push({ op: 'update', kind: 'opening', id: o.id, patch: { offset } })
    }
  })
  return { ops, reports, walls: joined }
}
