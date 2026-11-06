import { along, bounds, leftNormal, wallDir, wallLength } from './geometry'
import type { Mass, Opening, Plan, Pt, Room, Wall } from './types'

// What a wall, an opening or a mass of masonry is called in words, for a person reading the checks: where it is and
// what it separates, never its id (the ids are for Claude and for the file). "Väggen mellan Hall och Kök (2,4 m)",
// "yttervägg mot söder (9,0 m)", "dörren (900 mm) i väggen mot Hall".

const m1 = (mm: number) => `${(mm / 1000).toFixed(1).replace('.', ',')} m`

export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

// Compass word for a direction on the sheet (screen x right, y down); the north arrow may be turned.
function compass(plan: Plan, v: Pt): string {
  const bearing = (Math.atan2(v.x, -v.y) * 180) / Math.PI // 0 = up, clockwise
  const rel = (((bearing - (plan.sheet.northAngle ?? 0)) % 360) + 360) % 360
  const names = ['norr', 'nordost', 'öster', 'sydost', 'söder', 'sydväst', 'väster', 'nordväst']
  return names[Math.round(rel / 45) % 8]
}

function inPolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]
    const b = poly[j]
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

// The room a point lies in: by outline where a room has one, otherwise the nearest label within 3 m.
function roomAt(plan: Plan, p: Pt): Room | null {
  const outlined = plan.rooms.find((r) => r.polygon && r.polygon.length >= 3 && inPolygon(p, r.polygon))
  if (outlined) return outlined
  let best: Room | null = null
  let bestD = 3000
  for (const r of plan.rooms) {
    const d = Math.hypot(r.at.x - p.x, r.at.y - p.y)
    if (d < bestD) {
      best = r
      bestD = d
    }
  }
  return best
}

// Where in the plan a point is, in words (a third of the plan each way).
function zone(plan: Plan, p: Pt): string {
  const b = bounds(plan)
  const fx = (p.x - b.minX) / Math.max(1, b.maxX - b.minX)
  const fy = (p.y - b.minY) / Math.max(1, b.maxY - b.minY)
  const col = fx < 1 / 3 ? 'west' : fx > 2 / 3 ? 'east' : 'mid'
  const row = fy < 1 / 3 ? 'north' : fy > 2 / 3 ? 'south' : 'mid'
  if (row === 'mid' && col === 'mid') return 'mitt i planen'
  const rows = { north: 'nord', south: 'syd', mid: '' }
  const cols = { west: 'väst', east: 'öst', mid: '' }
  const w = `${rows[row]}${cols[col]}` || ''
  const word = w === 'nord' ? 'norra' : w === 'syd' ? 'södra' : w === 'väst' ? 'västra' : w === 'öst' ? 'östra' : `${w}ra`
  return `${word} delen`
}

const mid = (w: Wall): Pt => ({ x: (w.a.x + w.b.x) / 2, y: (w.a.y + w.b.y) / 2 })

// Is this wall on the outside of the building: flagged, or lying along the edge of the plan.
function isOuter(plan: Plan, w: Wall): boolean {
  if (w.exterior) return true
  const b = bounds(plan)
  const c = mid(w)
  const tol = w.thickness * 0.75 + 60
  const horizontal = Math.abs(w.b.y - w.a.y) < Math.abs(w.b.x - w.a.x)
  return horizontal ? Math.abs(c.y - b.minY) <= tol + 400 || Math.abs(c.y - b.maxY) <= tol + 400 : Math.abs(c.x - b.minX) <= tol + 400 || Math.abs(c.x - b.maxX) <= tol + 400
}

export function describeWall(plan: Plan, w: Wall): string {
  const len = m1(wallLength(w))
  const c = mid(w)
  const n = leftNormal(wallDir(w))
  if (isOuter(plan, w)) {
    const b = bounds(plan)
    const centre = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 }
    const out = n.x * (c.x - centre.x) + n.y * (c.y - centre.y) >= 0 ? n : { x: -n.x, y: -n.y }
    return `yttervägg mot ${compass(plan, out)} (${len})`
  }
  const off = w.thickness / 2 + 350
  const a = roomAt(plan, { x: c.x + n.x * off, y: c.y + n.y * off })
  const b = roomAt(plan, { x: c.x - n.x * off, y: c.y - n.y * off })
  if (a && b && a.id !== b.id) return `väggen mellan ${a.name} och ${b.name} (${len})`
  const one = a ?? b
  if (one) return `väggen mot ${one.name} (${len})`
  return `väggen (${len}) i ${zone(plan, c)}`
}

export function describeMass(plan: Plan, m: Mass): string {
  const c = { x: m.points.reduce((t, p) => t + p.x, 0) / m.points.length, y: m.points.reduce((t, p) => t + p.y, 0) / m.points.length }
  const r = roomAt(plan, c)
  return r ? `murmassan vid ${r.name}` : `murmassan i ${zone(plan, c)}`
}

const KIND = { door: 'dörren', window: 'fönstret', opening: 'öppningen' } as const

export function describeOpening(plan: Plan, o: Opening): string {
  const w = plan.walls.find((x) => x.id === o.wallId)
  return `${KIND[o.kind]} (${o.width} mm) i ${w ? describeWall(plan, w) : 'en vägg som saknas'}`
}

// What a finding's `ref` (a wall, opening, mass or fixture id) is called, or its id if it is not one of those.
export function describeRef(plan: Plan, ref: string): string {
  const w = plan.walls.find((x) => x.id === ref)
  if (w) return describeWall(plan, w)
  const o = plan.openings.find((x) => x.id === ref)
  if (o) return describeOpening(plan, o)
  const m = (plan.masses ?? []).find((x) => x.id === ref)
  if (m) return describeMass(plan, m)
  return ref
}

// Where to put a numbered marker for the item a finding points at.
export function refPoint(plan: Plan, ref: string): Pt | null {
  const w = plan.walls.find((x) => x.id === ref)
  if (w) return mid(w)
  const o = plan.openings.find((x) => x.id === ref)
  if (o) {
    const ow = plan.walls.find((x) => x.id === o.wallId)
    return ow ? along(ow, o.offset + o.width / 2) : null
  }
  const m = (plan.masses ?? []).find((x) => x.id === ref)
  if (m) return { x: m.points.reduce((t, p) => t + p.x, 0) / m.points.length, y: m.points.reduce((t, p) => t + p.y, 0) / m.points.length }
  const f = plan.fixtures.find((x) => x.id === ref)
  if (f) return { x: f.x, y: f.y }
  return null
}
