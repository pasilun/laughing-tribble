import { along, bounds, polygonArea, wallLength, wallQuad, wallSegments } from './geometry'
import type { Plan, Pt, Room, View } from './types'

// Room areas from the walls: rasterise the walls shown in a view (openings
// count as closed, so rooms don't leak through doors, except a passage marked
// through, which has no wall in it) and flood-fill from each room label. A
// room open to the outside gets no area.

const CELL = 10 // mm; error is about half a cell along the room's perimeter
const JOIN_SLACK = 2 * CELL

function insideConvex(p: Pt, q: Pt[]): boolean {
  let sign = 0
  for (let i = 0; i < q.length; i++) {
    const a = q[i]
    const b = q[(i + 1) % q.length]
    const c = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)
    if (c !== 0) {
      if (sign === 0) sign = Math.sign(c)
      else if (Math.sign(c) !== sign) return false
    }
  }
  return true
}

export function roomAreas(plan: Plan, view: View): Map<string, number> {
  return roomSpaces(plan, view).areas
}

// Areas per room label, plus — for a space holding several labels (open
// plan, or rooms merged by demolition) — the other names it includes, so
// the one area shown can say what it covers.
export function roomSpaces(plan: Plan, view: View): { areas: Map<string, number>; includes: Map<string, string[]> } {
  const includes = new Map<string, string[]>()
  const areas = spaces(plan, view, includes)
  return { areas, includes }
}

function spaces(plan: Plan, view: View, includes: Map<string, string[]>): Map<string, number> {
  const out = new Map<string, number>()
  const rooms = plan.rooms.filter((r) => !r.polygon && !(view === 'efter' && r.goneAfter))
  for (const r of plan.rooms) if (r.polygon && r.polygon.length >= 3) out.set(r.id, polygonArea(r.polygon))
  const walls = plan.walls.filter((w) => (view === 'fore' ? w.phase !== 'new' : w.phase !== 'demolish'))
  if (rooms.length === 0 || walls.length === 0) return out

  const b = bounds({ ...plan, walls, fixtures: [], rooms: [] })
  const x0 = b.minX - 2 * CELL
  const y0 = b.minY - 2 * CELL
  const nx = Math.ceil((b.maxX - x0) / CELL) + 3
  const ny = Math.ceil((b.maxY - y0) / CELL) + 3
  if (nx * ny > 8_000_000) return out // unreasonably large plan; skip

  const solid = new Uint8Array(nx * ny)
  // A passage marked through leaves its stretch of the wall open.
  const through = plan.openings.filter((o) => o.through && o.phase !== (view === 'fore' ? 'new' : 'demolish'))
  for (const w of walls) {
    const len = wallLength(w) || 1
    const dx = (w.b.x - w.a.x) / len
    const dy = (w.b.y - w.a.y) / len
    for (const [s, e] of wallSegments(w, through)) {
      // Ends of the wall itself are stretched a little so hairline gaps at joints
      // (a traced wall stopping a few mm short of the one it meets) don't let
      // rooms merge; the ends beside a passage are left as they are.
      const ua = s <= 0.5 ? JOIN_SLACK : 0
      const ub = e >= len - 0.5 ? JOIN_SLACK : 0
      const a = along(w, s)
      const b = along(w, e)
      const q = wallQuad({ ...w, a: { x: a.x - dx * ua, y: a.y - dy * ua }, b: { x: b.x + dx * ub, y: b.y + dy * ub } })
      const i0 = Math.max(0, Math.floor((Math.min(...q.map((p) => p.x)) - x0) / CELL))
      const i1 = Math.min(nx - 1, Math.ceil((Math.max(...q.map((p) => p.x)) - x0) / CELL))
      const j0 = Math.max(0, Math.floor((Math.min(...q.map((p) => p.y)) - y0) / CELL))
      const j1 = Math.min(ny - 1, Math.ceil((Math.max(...q.map((p) => p.y)) - y0) / CELL))
      for (let j = j0; j <= j1; j++)
        for (let i = i0; i <= i1; i++) if (insideConvex({ x: x0 + (i + 0.5) * CELL, y: y0 + (j + 0.5) * CELL }, q)) solid[j * nx + i] = 1
    }
  }

  // Masses are solid like walls.
  for (const m of (plan.masses ?? []).filter((x) => (view === 'fore' ? x.phase !== 'new' : x.phase !== 'demolish'))) {
    const q = m.points
    const i0 = Math.max(0, Math.floor((Math.min(...q.map((p) => p.x)) - x0) / CELL))
    const i1 = Math.min(nx - 1, Math.ceil((Math.max(...q.map((p) => p.x)) - x0) / CELL))
    const j0 = Math.max(0, Math.floor((Math.min(...q.map((p) => p.y)) - y0) / CELL))
    const j1 = Math.min(ny - 1, Math.ceil((Math.max(...q.map((p) => p.y)) - y0) / CELL))
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) if (insideConvex({ x: x0 + (i + 0.5) * CELL, y: y0 + (j + 0.5) * CELL }, q)) solid[j * nx + i] = 1
  }

  const seen = new Int32Array(nx * ny).fill(-1)
  rooms.forEach((r: Room, k) => {
    const si = Math.floor((r.at.x - x0) / CELL)
    const sj = Math.floor((r.at.y - y0) / CELL)
    if (si < 0 || sj < 0 || si >= nx || sj >= ny || solid[sj * nx + si]) return
    const start = sj * nx + si
    // Same space as an earlier label (e.g. rooms merged by demolition): the
    // area is shown once, under the first label, which lists the others.
    if (seen[start] >= 0) {
      const first = rooms[seen[start]]
      includes.set(first.id, [...(includes.get(first.id) ?? []), view === 'efter' && r.renamed ? r.renamed : r.name])
      return
    }
    const stack = [start]
    seen[start] = k
    let count = 0
    let open = false
    while (stack.length) {
      const c = stack.pop()!
      count++
      const i = c % nx
      const j = (c - i) / nx
      if (i === 0 || j === 0 || i === nx - 1 || j === ny - 1) {
        open = true
        continue
      }
      for (const n of [c - 1, c + 1, c - nx, c + nx]) {
        if (!solid[n] && seen[n] < 0) {
          seen[n] = k
          stack.push(n)
        }
      }
    }
    if (!open) out.set(r.id, count * CELL * CELL)
  })
  return out
}
