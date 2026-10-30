import { dist, wallDir, wallLength } from './geometry'
import type { Dimension, Fixture, Mass, Note, Opening, Plan, Pt, Room, Sheet, Source, TitleBlock, Underlay, Wall } from './types'

// Small, targeted edits. Claude and the editor both change a plan only
// through these, so an edit never regenerates parts it doesn't touch.

type Kinds = {
  wall: Wall
  mass: Mass
  opening: Opening
  fixture: Fixture
  room: Room
  dimension: Dimension
  note: Note
  source: Source
}
export type Kind = keyof Kinds

const COLLECTION: { [K in Kind]: 'walls' | 'masses' | 'openings' | 'fixtures' | 'rooms' | 'dimensions' | 'notes' | 'sources' } = {
  wall: 'walls',
  mass: 'masses',
  opening: 'openings',
  fixture: 'fixtures',
  room: 'rooms',
  dimension: 'dimensions',
  note: 'notes',
  source: 'sources',
}

export const KINDS = Object.keys(COLLECTION) as Kind[]

export type Op =
  | { op: 'add'; kind: Kind; item: Kinds[Kind] }
  | { op: 'update'; kind: Kind; id: string; patch: Record<string, unknown> }
  | { op: 'delete'; kind: Kind; id: string }
  // Moves every wall end that sits at `from` (joined walls follow).
  | { op: 'moveVertex'; from: Pt; to: Pt }
  // Translates a wall; walls joined at its ends stretch to follow.
  | { op: 'moveWall'; id: string; dx: number; dy: number }
  // Changes a wall's length by moving one end along the wall's direction.
  | { op: 'setWallLength'; id: string; length: number; fixed?: 'a' | 'b' }
  // Scales the drawing about a point, separately along x and y: every wall end, mass corner,
  // fixture centre, room label and outline, dimension end and note moves; openings keep their
  // size and stay at the same relative place on their wall; wall thicknesses and fixture sizes
  // stay. For a traced plan whose overall size is a little off the printed one. `sources` also
  // rescales the source drawings by that (equal on both axes) factor, so the underlay still fits.
  | { op: 'scale'; origin: Pt; fx: number; fy: number; sources?: number }
  | { op: 'setSheet'; patch: Partial<Omit<Sheet, 'titleBlock'>> }
  | { op: 'setTitleBlock'; patch: Partial<TitleBlock> }
  | { op: 'setUnderlay'; underlay: Underlay | null }

export type OpResult = { plan: Plan; errors: string[] }

const JOIN_TOLERANCE = 1 // mm

function roundPt(p: Pt): Pt {
  return { x: Math.round(p.x), y: Math.round(p.y) }
}

function roundItem<T>(item: T): T {
  // Integer millimetres everywhere, except free-form numbers like rotation.
  const out = { ...item } as Record<string, unknown>
  for (const [k, v] of Object.entries(out)) {
    if (k === 'rotation' || k === 'mmPerPx' || k === 'opacity' || k === 'dpi') continue
    if (typeof v === 'number') out[k] = Math.round(v)
    else if (v && typeof v === 'object' && 'x' in v && 'y' in v) out[k] = roundPt(v as Pt)
    else if (Array.isArray(v) && v.every((p) => p && typeof p === 'object' && 'x' in p)) out[k] = v.map((p) => roundPt(p as Pt))
  }
  return out as T
}

// Openings are measured from the wall's a-end. When that end moves, its
// openings move with it, so they stay where they were drawn (kept on the wall).
function followA(plan: Plan, before: Wall, after: Wall): Plan {
  const d = wallDir(before)
  const shift = (after.a.x - before.a.x) * d.x + (after.a.y - before.a.y) * d.y
  if (Math.abs(shift) < 0.5) return plan
  const len = wallLength(after)
  return {
    ...plan,
    openings: plan.openings.map((o) =>
      o.wallId !== after.id ? o : { ...o, offset: Math.round(Math.max(0, Math.min(len - o.width, o.offset - shift))) },
    ),
  }
}

function moveVertex(plan: Plan, from: Pt, to: Pt): Plan {
  const target = roundPt(to)
  const walls = plan.walls.map((w) => ({
    ...w,
    a: dist(w.a, from) <= JOIN_TOLERANCE ? target : w.a,
    b: dist(w.b, from) <= JOIN_TOLERANCE ? target : w.b,
  }))
  return plan.walls.reduce((next, before, i) => (before.a === walls[i].a ? next : followA(next, before, walls[i])), { ...plan, walls })
}

// True for a convex polygon with area, corners in either winding order.
function convex(pts: Pt[]): boolean {
  let sign = 0
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    const c = pts[(i + 2) % pts.length]
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)
    if (Math.abs(cross) < 1) continue
    if (sign === 0) sign = Math.sign(cross)
    else if (Math.sign(cross) !== sign) return false
  }
  return sign !== 0
}

export function validatePlan(plan: Plan): string[] {
  const errors: string[] = []
  for (const kind of KINDS) {
    const ids = new Set<string>()
    for (const item of plan[COLLECTION[kind]] ?? []) {
      if (!item.id) errors.push(`${kind} saknar id`)
      else if (ids.has(item.id)) errors.push(`${kind} ${item.id}: id finns redan`)
      ids.add(item.id)
    }
  }
  if (![50, 100, 150, 200].includes(plan.sheet.scale)) errors.push(`skala 1:${plan.sheet.scale} stöds inte (1:50, 1:100, 1:150, 1:200)`)
  const walls = new Map(plan.walls.map((w) => [w.id, w]))
  for (const w of plan.walls) {
    if (dist(w.a, w.b) < 1) errors.push(`vägg ${w.id}: har ingen längd`)
    if (!(w.thickness > 0)) errors.push(`vägg ${w.id}: tjocklek måste vara > 0`)
  }
  for (const m of plan.masses ?? []) {
    if (!Array.isArray(m.points) || m.points.length < 3) errors.push(`massa ${m.id}: behöver minst tre hörn`)
    else if (!convex(m.points)) errors.push(`massa ${m.id}: hörnen måste bilda en konvex form i ordning runt om – dela upp en annan form i flera`)
  }
  for (const o of plan.openings) {
    const w = walls.get(o.wallId)
    if (!w) {
      errors.push(`öppning ${o.id}: väggen ${o.wallId} finns inte`)
      continue
    }
    const len = dist(w.a, w.b)
    if (!Number.isFinite(o.offset) || !(o.width > 0)) errors.push(`öppning ${o.id}: offset och bredd måste vara tal (bredd > 0)`)
    else if (o.offset < 0 || o.offset + o.width > len + 0.5)
      errors.push(`öppning ${o.id}: ligger utanför väggen ${w.id} (${o.offset}+${o.width} > ${Math.round(len)} mm)`)
  }
  return errors
}

function applyOne(plan: Plan, op: Op): Plan {
  switch (op.op) {
    case 'add': {
      const key = COLLECTION[op.kind]
      if (!key) throw new Error(`okänd typ ${op.kind}`)
      const list = (plan[key] ?? []) as Array<{ id: string }>
      if (list.some((i) => i.id === op.item.id)) throw new Error(`${op.kind} ${op.item.id} finns redan`)
      return { ...plan, [key]: [...list, roundItem(op.item)] }
    }
    case 'update': {
      const key = COLLECTION[op.kind]
      if (!key) throw new Error(`okänd typ ${op.kind}`)
      const list = (plan[key] ?? []) as Array<{ id: string }>
      if (!list.some((i) => i.id === op.id)) throw new Error(`${op.kind} ${op.id} finns inte`)
      if ('id' in op.patch && op.patch.id !== op.id) throw new Error('id kan inte ändras')
      const next = { ...plan, [key]: list.map((i) => (i.id === op.id ? roundItem({ ...i, ...op.patch }) : i)) }
      if (op.kind !== 'wall' || !('a' in op.patch)) return next
      const before = plan.walls.find((w) => w.id === op.id)!
      return followA(next, before, (next.walls ?? []).find((w) => w.id === op.id)!)
    }
    case 'delete': {
      const key = COLLECTION[op.kind]
      if (!key) throw new Error(`okänd typ ${op.kind}`)
      const list = (plan[key] ?? []) as Array<{ id: string }>
      if (!list.some((i) => i.id === op.id)) throw new Error(`${op.kind} ${op.id} finns inte`)
      const next = { ...plan, [key]: list.filter((i) => i.id !== op.id) }
      // Openings belong to their wall.
      if (op.kind === 'wall') next.openings = next.openings.filter((o) => o.wallId !== op.id)
      return next
    }
    case 'moveVertex':
      return moveVertex(plan, op.from, op.to)
    case 'moveWall': {
      const w = plan.walls.find((x) => x.id === op.id)
      if (!w) throw new Error(`vägg ${op.id} finns inte`)
      const a2 = { x: w.a.x + op.dx, y: w.a.y + op.dy }
      const b2 = { x: w.b.x + op.dx, y: w.b.y + op.dy }
      return moveVertex(moveVertex(plan, w.a, a2), w.b, b2)
    }
    case 'setWallLength': {
      const w = plan.walls.find((x) => x.id === op.id)
      if (!w) throw new Error(`vägg ${op.id} finns inte`)
      if (!(op.length > 0)) throw new Error('längden måste vara > 0')
      const d = wallDir(w)
      if ((op.fixed ?? 'a') === 'a') return moveVertex(plan, w.b, { x: w.a.x + d.x * op.length, y: w.a.y + d.y * op.length })
      return moveVertex(plan, w.a, { x: w.b.x - d.x * op.length, y: w.b.y - d.y * op.length })
    }
    case 'scale': {
      const { origin: o, fx, fy } = op
      if (!(fx > 0.5 && fx < 2 && fy > 0.5 && fy < 2)) throw new Error('scale: faktorerna måste ligga mellan 0,5 och 2')
      const mv = (p: Pt): Pt => ({ x: o.x + (p.x - o.x) * fx, y: o.y + (p.y - o.y) * fy })
      const lenFactor = (w: Wall) => {
        const dx = w.b.x - w.a.x
        const dy = w.b.y - w.a.y
        const l = Math.hypot(dx, dy)
        return l === 0 ? 1 : Math.hypot(dx * fx, dy * fy) / l
      }
      const factors = new Map(plan.walls.map((w) => [w.id, lenFactor(w)]))
      const walls = plan.walls.map((w) => ({ ...w, a: mv(w.a), b: mv(w.b) }))
      const openings = plan.openings.map((x) => {
        const f = factors.get(x.wallId) ?? 1
        const w = walls.find((q) => q.id === x.wallId)
        const centre = f * (x.offset + x.width / 2)
        return { ...x, offset: Math.max(0, Math.min(w ? wallLength(w) - x.width : Infinity, centre - x.width / 2)) }
      })
      const k = op.sources
      return {
        ...plan,
        walls,
        openings,
        masses: plan.masses?.map((m) => ({ ...m, points: m.points.map(mv) })),
        fixtures: plan.fixtures.map((x) => ({ ...x, ...mv({ x: x.x, y: x.y }) })),
        rooms: plan.rooms.map((r) => ({ ...r, at: mv(r.at), ...(r.polygon ? { polygon: r.polygon.map(mv) } : {}) })),
        dimensions: plan.dimensions.map((d) => ({ ...d, a: mv(d.a), b: mv(d.b) })),
        notes: plan.notes.map((n) => ({ ...n, at: mv(n.at) })),
        ...(k && plan.sources ? { sources: plan.sources.map((s) => ({ ...s, ...mv({ x: s.x, y: s.y }), mmPerPx: s.mmPerPx * k })) } : {}),
      }
    }
    case 'setSheet':
      return { ...plan, sheet: { ...plan.sheet, ...op.patch, titleBlock: plan.sheet.titleBlock } }
    case 'setTitleBlock':
      return { ...plan, sheet: { ...plan.sheet, titleBlock: { ...plan.sheet.titleBlock, ...op.patch } } }
    case 'setUnderlay':
      return { ...plan, underlay: op.underlay ?? undefined }
    default:
      throw new Error(`okänd operation ${(op as { op: string }).op}`)
  }
}

// Applies all ops or none: any failing op or a resulting invalid plan
// returns the original plan plus the errors.
export function applyOps(plan: Plan, ops: Op[]): OpResult {
  let next = plan
  for (let i = 0; i < ops.length; i++) {
    try {
      next = applyOne(next, ops[i])
    } catch (e) {
      return { plan, errors: [`operation ${i + 1} (${ops[i].op}): ${(e as Error).message}`] }
    }
  }
  const errors = validatePlan(next)
  return errors.length > 0 ? { plan, errors } : { plan: next, errors: [] }
}

let counter = 0
export function newId(prefix: string): string {
  counter = (counter + 1) % 1000
  return `${prefix}-${Date.now().toString(36)}${counter.toString(36)}`
}
