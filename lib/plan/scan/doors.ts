import { along, leftNormal, wallDir } from '../geometry'
import type { Op } from '../ops'
import type { Opening, Plan, Pt, Wall } from '../types'
import { dark, toPx, type Gray, type Raster } from './raster'

// Reads door swings off a source drawing instead of guessing them: each of
// the four possibilities (hinge at either jamb, leaf to either side) has its
// own quarter arc around the hinge, and only the drawn one lies on ink.
// Drawings show leaves at anything from 30° to 90° open, so only the part of
// the arc nearest the closed position is required.

export type DoorCandidate = { hinge: 'a' | 'b'; swing: 'left' | 'right'; score: number; shiftMm?: number }
export type DoorReading = {
  id: string
  best?: DoorCandidate
  current: DoorCandidate
  candidates: DoorCandidate[]
  confident: boolean
  changed: boolean
}

const ray = (closedDir: Pt, openDir: Pt, deg: number): Pt => {
  const t = (deg * Math.PI) / 180
  return { x: closedDir.x * Math.cos(t) + openDir.x * Math.sin(t), y: closedDir.y * Math.cos(t) + openDir.y * Math.sin(t) }
}

// Centre of the ink nearest to point c along direction u (searching ±reach
// px), in mm from c — or null if there's no ink. Measuring the line's centre
// rather than "is there ink" is what tells a straight line from a gentle
// arc when lines are thick.
function inkCentre(g: Gray, r: Raster, c: Pt, u: Pt, reachPx: number, threshold: number): number | null {
  const step = 0.5
  let best: number | null = null
  for (const sgn of [1, -1]) {
    for (let k = 0; k <= reachPx; k += step) {
      const t = sgn * k * r.mmPerPx
      const p = toPx(r, { x: c.x + u.x * t, y: c.y + u.y * t })
      if (!dark(g, p.x, p.y, threshold)) continue
      // Walk across the run to find its middle.
      let a = k
      let b = k
      while (b + step <= reachPx + 6) {
        const q = toPx(r, { x: c.x + u.x * sgn * (b + step) * r.mmPerPx, y: c.y + u.y * sgn * (b + step) * r.mmPerPx })
        if (!dark(g, q.x, q.y, threshold)) break
        b += step
      }
      while (a - step >= 0) {
        const q = toPx(r, { x: c.x + u.x * sgn * (a - step) * r.mmPerPx, y: c.y + u.y * sgn * (a - step) * r.mmPerPx })
        if (!dark(g, q.x, q.y, threshold)) break
        a -= step
      }
      const mid = sgn * ((a + b) / 2) * r.mmPerPx
      if (best === null || Math.abs(mid) < Math.abs(best)) best = mid
      break
    }
  }
  return best
}

// Residual (px) of the best straight-line fit through (t, v) pairs.
function lineResidual(ts: number[], vs: number[], r: Raster): number {
  const n = ts.length
  const mt = ts.reduce((a, b) => a + b, 0) / n
  const mv = vs.reduce((a, b) => a + b, 0) / n
  let num = 0
  let den = 0
  for (let i = 0; i < n; i++) {
    num += (ts[i] - mt) * (vs[i] - mv)
    den += (ts[i] - mt) ** 2
  }
  const k = den ? num / den : 0
  let ss = 0
  for (let i = 0; i < n; i++) ss += (vs[i] - (mv + k * (ts[i] - mt))) ** 2
  return Math.sqrt(ss / n) / r.mmPerPx
}

// 1 when the residual is within line-drawing noise, 0 when it is clearly
// the wrong shape.
const shapeFactor = (rmsPx: number) => Math.max(0, Math.min(1, (3 - rmsPx) / 2))

// The leaf: straight ink from the hinge at some opening angle.
function leafFit(g: Gray, r: Raster, hinge: Pt, dir: Pt, w: number, threshold: number) {
  const lat = { x: -dir.y, y: dir.x }
  const ts: number[] = []
  const vs: number[] = []
  const N = 14
  for (let i = 0; i < N; i++) {
    const t = w * (0.15 + (0.77 * i) / (N - 1))
    const v = inkCentre(g, r, { x: hinge.x + dir.x * t, y: hinge.y + dir.y * t }, lat, 6, threshold)
    if (v !== null) {
      ts.push(t)
      vs.push(v)
    }
  }
  if (ts.length < N * 0.6) return 0
  return (ts.length / N) * shapeFactor(lineResidual(ts, vs, r))
}

// The arc: ink at a constant radius around the hinge from the leaf back to
// the closed position.
function arcFit(g: Gray, r: Raster, hinge: Pt, closedDir: Pt, openDir: Pt, psi: number, w: number, threshold: number) {
  const ts: number[] = []
  const vs: number[] = []
  let n = 0
  for (let deg = 5; deg <= psi - 5; deg += 3) {
    n++
    const dir = ray(closedDir, openDir, deg)
    const v = inkCentre(g, r, { x: hinge.x + dir.x * w, y: hinge.y + dir.y * w }, dir, Math.max(6, (0.12 * w) / r.mmPerPx), threshold)
    if (v !== null) {
      ts.push(deg)
      vs.push(v)
    }
  }
  if (!n || ts.length < n * 0.6) return 0
  // Radii must be constant: the residual about their mean (slope 0).
  const mean = vs.reduce((a, b) => a + b, 0) / vs.length
  const rms = Math.sqrt(vs.reduce((a, v) => a + (v - mean) ** 2, 0) / vs.length) / r.mmPerPx
  return (ts.length / n) * shapeFactor(rms)
}

function hingeScore(g: Gray, r: Raster, hinge: Pt, closedDir: Pt, openDir: Pt, w: number, threshold: number) {
  let leaf = 0
  let psi = 0
  for (let deg = 25; deg <= 92; deg += 2) {
    const v = leafFit(g, r, hinge, ray(closedDir, openDir, deg), w, threshold)
    if (v > leaf + 1e-9) {
      leaf = v
      psi = deg
    }
  }
  const arc = psi ? arcFit(g, r, hinge, closedDir, openDir, psi, w, threshold) : 0
  return { score: (leaf + arc) / 2, leaf, arc, psi }
}

export function readDoor(g: Gray, r: Raster, wall: Wall, o: Opening, threshold = 128): DoorReading {
  const d = wallDir(wall)
  const n = leftNormal(d)
  const half = wall.thickness / 2
  const candidates: DoorCandidate[] = []
  for (const hinge of ['a', 'b'] as const)
    for (const swing of ['left', 'right'] as const) {
      const side = swing === 'left' ? 1 : -1
      const atA = hinge === 'a'
      const face = (t: number) => {
        const j = along(wall, t)
        return { x: j.x + n.x * side * half, y: j.y + n.y * side * half }
      }
      // The hinge, on the face the door opens to.
      const h = face(atA ? o.offset : o.offset + o.width)
      const closed = atA ? d : { x: -d.x, y: -d.y }
      const open = { x: n.x * side, y: n.y * side }
      // Where the plan is set by measurement the drawing can sit a little
      // off: let the whole symbol slide, scoring all parts at one position.
      const reach = Math.max(150, o.width * 0.2)
      const step = Math.max(20, r.mmPerPx * 2)
      let best = { score: -1, du: 0, dn: 0 }
      for (let du = -reach; du <= reach + 1e-6; du += step)
        for (let dn = -reach; dn <= reach + 1e-6; dn += step) {
          const sh = { x: d.x * du + n.x * dn, y: d.y * du + n.y * dn }
          const hs = hingeScore(g, r, { x: h.x + sh.x, y: h.y + sh.y }, closed, open, o.width, threshold)
          if (hs.score > best.score) best = { score: hs.score, du, dn }
        }
      candidates.push({ hinge, swing, score: Math.round(Math.max(0, best.score) * 100) / 100, shiftMm: Math.round(Math.hypot(best.du, best.dn)) })
    }
  candidates.sort((x, y) => y.score - x.score)
  const [first, second] = candidates
  // A clear winner: straight leaf and round arc found, well ahead of the rest.
  const confident = first.score >= 0.6 && first.score - second.score >= 0.2
  const current = candidates.find((c) => c.hinge === (o.hinge ?? 'a') && c.swing === (o.swing ?? 'left'))!
  const best = first.score >= 0.6 ? first : undefined
  return {
    id: o.id,
    best,
    current,
    candidates,
    confident,
    changed: !!best && confident && (best.hinge !== current.hinge || best.swing !== current.swing),
  }
}

export function readDoors(g: Gray, r: Raster, plan: Plan, ids?: string[], threshold?: number): { readings: DoorReading[]; ops: Op[] } {
  const readings: DoorReading[] = []
  const ops: Op[] = []
  for (const o of plan.openings) {
    if (o.kind !== 'door' || (ids && !ids.includes(o.id))) continue
    const wall = plan.walls.find((w) => w.id === o.wallId)
    if (!wall) continue
    const rd = readDoor(g, r, wall, o, threshold)
    readings.push(rd)
    if (rd.changed && rd.best) ops.push({ op: 'update', kind: 'opening', id: o.id, patch: { hinge: rd.best.hinge, swing: rd.best.swing } })
  }
  return { readings, ops }
}

const COMPASS = ['öster', 'sydost', 'söder', 'sydväst', 'väster', 'nordväst', 'norr', 'nordost']

// Direction in plain words (plan y points down, north up).
export function compass(v: Pt): string {
  const deg = (Math.atan2(v.y, v.x) * 180) / Math.PI // 0 = east, 90 = south
  return COMPASS[((Math.round(deg / 45) % 8) + 8) % 8]
}

// "gångjärn vid västra karmen (7300,7847), öppnar mot norr"
export function describeDoor(wall: Wall, o: Opening): string {
  const d = wallDir(wall)
  const n = leftNormal(d)
  const atA = (o.hinge ?? 'a') === 'a'
  const side = (o.swing ?? 'left') === 'left' ? 1 : -1
  const jamb = along(wall, atA ? o.offset : o.offset + o.width)
  const towardsHinge = atA ? { x: -d.x, y: -d.y } : d
  const opens = { x: n.x * side, y: n.y * side }
  const jambWord: Record<string, string> = {
    öster: 'östra', väster: 'västra', norr: 'norra', söder: 'södra',
    nordost: 'nordöstra', nordväst: 'nordvästra', sydost: 'sydöstra', sydväst: 'sydvästra',
  }
  return `gångjärn vid ${jambWord[compass(towardsHinge)]} karmen (${Math.round(jamb.x)},${Math.round(jamb.y)}), öppnar mot ${compass(opens)}`
}
