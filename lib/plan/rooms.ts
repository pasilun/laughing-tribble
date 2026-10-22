import { bounds, polygonArea, wallQuad } from './geometry'
import type { Plan, Pt, Room, View } from './types'

// Room areas from the walls: rasterise the walls shown in a view (openings
// count as closed, so rooms don't leak through doors) and flood-fill from
// each room label. A room open to the outside gets no area.

const CELL = 10 // mm; error is about half a cell along the room's perimeter

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
  const out = new Map<string, number>()
  const rooms = plan.rooms.filter((r) => !r.polygon)
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
  for (const w of walls) {
    const q = wallQuad(w)
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
    // area is shown once, under the first label.
    if (seen[start] >= 0) return
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
