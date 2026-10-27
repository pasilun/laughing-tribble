import type { Finding } from './checks'
import { along, leftNormal, wallDir, wallLength } from './geometry'
import type { SpaceGrid } from './rooms'
import type { Plan, Pt, View, Wall } from './types'

// The engineer's pass over a plan's walls and fixtures: walls meet flush,
// holes in load-bearing walls are door-sized, walls between flats are real
// walls, and kitchen and bathroom fixtures sit in rooms that can use them.
// Flags to weigh against the sources (docs/plan-review.md), not verdicts.

const FLUSH = 15 // mm a joint may be off and still count as flush
const NEAR = 300 // a wall end this close to another wall was meant to meet it
const WIDE_HOLE = 1200 // wider than a door in a load-bearing wall needs a beam
const SPLIT_MIN = 120 // a wall between flats thinner than this is a partition

type Local = { along: number; across: number; len: number }
function local(w: Wall, p: Pt): Local {
  const d = wallDir(w)
  const n = leftNormal(d)
  const v = { x: p.x - w.a.x, y: p.y - w.a.y }
  return { along: v.x * d.x + v.y * d.y, across: v.x * n.x + v.y * n.y, len: wallLength(w) }
}
// Distance from p to wall w's body (0 inside it).
function distToWall(w: Wall, p: Pt): number {
  const l = local(w, p)
  const da = l.along < 0 ? -l.along : l.along > l.len ? l.along - l.len : 0
  const dn = Math.max(0, Math.abs(l.across) - w.thickness / 2)
  return Math.hypot(da, dn)
}
function insidePoly(p: Pt, q: Pt[]): boolean {
  let s = 0
  for (let i = 0; i < q.length; i++) {
    const a = q[i]
    const b = q[(i + 1) % q.length]
    const c = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)
    if (c !== 0) {
      if (s === 0) s = Math.sign(c)
      else if (Math.sign(c) !== s) return false
    }
  }
  return true
}
function distToMass(q: Pt[], p: Pt): number {
  if (insidePoly(p, q)) return 0
  let best = Infinity
  for (let i = 0; i < q.length; i++) {
    const a = q[i]
    const b = q[(i + 1) % q.length]
    const L2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2 || 1
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / L2))
    best = Math.min(best, Math.hypot(p.x - a.x - t * (b.x - a.x), p.y - a.y - t * (b.y - a.y)))
  }
  return best
}

export function structureFindings(plan: Plan, view: View, grid: SpaceGrid | null, roomKind: (id: string) => string, flatOf: (k: number) => Set<string>, nameOf: (k: number) => string): Finding[] {
  const out: Finding[] = []
  const shown = <T extends { phase: string }>(x: T) => (view === 'fore' ? x.phase !== 'new' : x.phase !== 'demolish')
  const walls = plan.walls.filter(shown)
  const masses = (plan.masses ?? []).filter(shown)

  // ── joints ──
  for (const w of walls) {
    for (const [end, p] of [['a', w.a], ['b', w.b]] as const) {
      // The wall this end is meant to meet: the nearest other wall or mass.
      let best: { id: string; d: number; wall?: Wall } = { id: '', d: Infinity }
      for (const v of walls) {
        if (v === w) continue
        const d = distToWall(v, p)
        if (d < best.d) best = { id: v.id, d, wall: v }
      }
      for (const m of masses) {
        const d = distToMass(m.points, p)
        if (d < best.d) best = { id: m.id, d }
      }
      const v = best.wall
      if (v && best.d <= NEAR) {
        const l = local(v, p)
        const dir = wallDir(w)
        const vdir = wallDir(v)
        const head = (end === 'b' ? 1 : -1) * (dir.x * leftNormal(vdir).x + dir.y * leftNormal(vdir).y) // >0: heading toward v's left face
        const past = Math.abs(l.across) - v.thickness / 2 // beyond v's face (>0) on the side p is on
        const within = l.along > FLUSH && l.along < l.len - FLUSH
        if (within && Math.abs(head) > 0.9 && past > FLUSH) {
          // Arrived square at v's side: either it went through (sticks out) or stopped short (gap).
          if (Math.sign(l.across) === Math.sign(head))
            out.push({ level: 'warning', code: 'sticks-out', ref: w.id, message: `${w.id} går ${Math.round(past)} mm förbi ytan på ${v.id} – ett hörn som sticker ut` })
          else out.push({ level: 'warning', code: 'joint-gap', ref: w.id, message: `${w.id} slutar ${Math.round(past)} mm från ${v.id} – ska väggarna mötas (annars en springa eller nisch)?` })
          continue
        }
        // Same line, different thickness: a step in the wall face.
        const parallel = Math.abs(dir.x * vdir.x + dir.y * vdir.y) > 0.995
        const atEnd = Math.min(Math.hypot(p.x - v.a.x, p.y - v.a.y), Math.hypot(p.x - v.b.x, p.y - v.b.y)) <= FLUSH + Math.max(w.thickness, v.thickness) / 2
        if (parallel && atEnd && Math.abs(l.across) <= FLUSH && Math.abs(w.thickness - v.thickness) > 20 && w.id < v.id)
          out.push({ level: 'info', code: 'thickness-step', ref: w.id, message: `${w.id} (${w.thickness} mm) fortsätter som ${v.id} (${v.thickness} mm) – ett språng i väggytan; stämmer det med ritningen?` })
      }
      if (best.d <= FLUSH) continue
      if (best.d <= NEAR) {
        if (!v) out.push({ level: 'warning', code: 'joint-gap', ref: w.id, message: `${w.id} slutar ${Math.round(best.d)} mm från ${best.id} – ska väggen möta murmassan?` })
        continue
      }
      if (wallLength(w) < 1200 && !w.exterior)
        out.push({ level: 'info', code: 'free-stub', ref: w.id, message: `${w.id} är en fristående väggbit (${Math.round(wallLength(w))} mm) med fri ände – pelare, skärm eller bänkkant?` })
    }
  }

  // ── holes in load-bearing walls ──
  for (const o of plan.openings.filter(shown)) {
    const w = walls.find((x) => x.id === o.wallId)
    if (!w?.loadBearing || o.kind === 'window') continue
    if (o.width > WIDE_HOLE)
      out.push({ level: 'warning', code: 'wide-hole', ref: o.id, message: `Öppningen ${o.id} i bärande vägg ${w.id} är ${o.width} mm – bredare än en dörr; kräver balk/avväxling som ska framgå av underlaget` })
  }

  if (!grid) return out
  const { spaces, at } = grid

  // ── walls between flats ──
  for (const w of walls) {
    if (w.exterior || w.thickness >= SPLIT_MIN) continue
    const n = leftNormal(wallDir(w))
    const flats = (s: number) => {
      const set = new Set<string>()
      for (const t of [0.25, 0.5, 0.75]) {
        const m = along(w, wallLength(w) * t)
        const k = at({ x: m.x + n.x * s * (w.thickness / 2 + 80), y: m.y + n.y * s * (w.thickness / 2 + 80) })
        if (k >= 0) for (const f of flatOf(k)) set.add(f)
      }
      return set
    }
    const A = flats(1)
    const B = flats(-1)
    if (A.size && B.size && ![...A].some((f) => B.has(f)))
      out.push({ level: 'warning', code: 'thin-split', ref: w.id, message: `${w.id} skiljer lgh ${[...A].join('/')} från lgh ${[...B].join('/')} men är bara ${w.thickness} mm – lägenhetsskiljande väggar är murade/dubbla (ljud, brand)` })
  }

  // ── fixtures: what they say about the rooms ──
  const fx = plan.fixtures.filter(shown).filter((f) => f.kind !== 'balcony' && f.kind !== 'box' && f.kind !== 'radiator' && f.kind !== 'plug')
  const KITCHEN = new Set(['stove', 'sink', 'kitchen'])
  const WET = new Set(['wc', 'shower', 'bath'])
  if (!fx.some((f) => KITCHEN.has(f.kind) || WET.has(f.kind))) return out
  const roomsIn = (k: number) => (k >= 0 ? spaces[k].rooms : [])
  for (const f of fx) {
    if (f.kind === 'shaft' || f.kind === 'exhaust') continue
    const k = at(f)
    const label = f.label ?? f.kind
    if (k < 0) {
      out.push({ level: 'warning', code: 'fixture-in-wall', ref: f.id, message: `${label} (${f.id}) står i en vägg eller massa` })
      continue
    }
    const sp = spaces[k]
    if (sp.open) continue
    if (!sp.rooms.length) {
      out.push({ level: 'error', code: 'fixture-sealed', ref: f.id, message: `${label} (${f.id}) står i ett utrymme utan rumsnamn (${(sp.area / 1e6).toFixed(1).replace('.', ',')} m²) – är linjen framför den en bänkkant och inte en vägg?` })
      continue
    }
    const kinds = new Set(roomsIn(k).map(roomKind))
    if (WET.has(f.kind) && !kinds.has('wet'))
      out.push({ level: 'error', code: 'fixture-room', ref: f.id, message: `${label} (${f.id}) står i ${nameOf(k)} – en WC/dusch hör hemma i ett våtrum` })
    if ((f.kind === 'stove' || f.kind === 'kitchen') && !kinds.has('kitchen'))
      out.push({ level: 'warning', code: 'fixture-room', ref: f.id, message: `${label} (${f.id}) står i ${nameOf(k)} – en spis/köksbänk betyder kök eller kokvrå` })
  }
  // Every kitchen has a stove and a sink, every WC a WC — when the plan records fixtures at all.
  spaces.forEach((sp, k) => {
    if (sp.open || !sp.rooms.length) return
    const kinds = new Set(sp.rooms.map(roomKind))
    const here = fx.filter((f) => at(f) === k).map((f) => f.kind)
    if (kinds.has('kitchen') && !here.some((x) => KITCHEN.has(x)))
      out.push({ level: 'info', code: 'kitchen-fixtures', ref: sp.rooms[0], message: `${nameOf(k)}: kök utan inritad spis/disk – läs symbolerna i underlaget` })
    if (kinds.has('wet') && !here.includes('wc') && !here.includes('shower') && !here.includes('bath'))
      out.push({ level: 'info', code: 'wet-fixtures', ref: sp.rooms[0], message: `${nameOf(k)}: våtrum utan inritad WC/dusch – läs symbolerna i underlaget` })
  })
  return out
}
