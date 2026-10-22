import { dist, wallDir } from './geometry'
import type { Dimension, Fixture, Note, Opening, Plan, Pt, Room, Sheet, Source, TitleBlock, Underlay, Wall } from './types'

// Small, targeted edits. Claude and the editor both change a plan only
// through these, so an edit never regenerates parts it doesn't touch.

type Kinds = {
  wall: Wall
  opening: Opening
  fixture: Fixture
  room: Room
  dimension: Dimension
  note: Note
  source: Source
}
export type Kind = keyof Kinds

const COLLECTION: { [K in Kind]: 'walls' | 'openings' | 'fixtures' | 'rooms' | 'dimensions' | 'notes' | 'sources' } = {
  wall: 'walls',
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

function moveVertex(plan: Plan, from: Pt, to: Pt): Plan {
  const target = roundPt(to)
  return {
    ...plan,
    walls: plan.walls.map((w) => ({
      ...w,
      a: dist(w.a, from) <= JOIN_TOLERANCE ? target : w.a,
      b: dist(w.b, from) <= JOIN_TOLERANCE ? target : w.b,
    })),
  }
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
  const walls = new Map(plan.walls.map((w) => [w.id, w]))
  for (const w of plan.walls) {
    if (dist(w.a, w.b) < 1) errors.push(`vägg ${w.id}: har ingen längd`)
    if (!(w.thickness > 0)) errors.push(`vägg ${w.id}: tjocklek måste vara > 0`)
  }
  for (const o of plan.openings) {
    const w = walls.get(o.wallId)
    if (!w) {
      errors.push(`öppning ${o.id}: väggen ${o.wallId} finns inte`)
      continue
    }
    const len = dist(w.a, w.b)
    if (o.offset < 0 || o.offset + o.width > len + 0.5)
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
      return { ...plan, [key]: list.map((i) => (i.id === op.id ? roundItem({ ...i, ...op.patch }) : i)) }
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
