import type { Op } from './ops'
import { spaceGrid } from './rooms'
import type { Plan, Pt } from './types'

// The simple surface for small models: plan_fix verbs instead of raw operations, and plan_next,
// which says where a plan stands and what to do next, with the arguments filled in.

type Verb = Record<string, unknown>

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const pt = (v: unknown): Pt | undefined => {
  const p = v as Pt | undefined
  return p && num(p.x) !== undefined && num(p.y) !== undefined ? { x: p.x, y: p.y } : undefined
}

function freeId(prefix: string, taken: Set<string>): string {
  let n = 1
  while (taken.has(`${prefix}${n}`)) n++
  taken.add(`${prefix}${n}`)
  return `${prefix}${n}`
}

// One verb per change: {"wall":"w3","move":{"dx":0,"dy":-40}}, {"wall":"w3","thickness":200},
// {"wall":"w3","delete":true}, {"add_wall":{"a":{..},"b":{..},"thickness":200,"exterior":true}},
// {"opening":"o2","offset":900,"width":800,"kind":"door","hinge":"a","swing":"left"},
// {"opening":"o2","delete":true}, {"add_room":{"name":"Kök","at":{..}}}, {"room":"r1","name":"Kök"}.
export function verbsToOps(plan: Plan, verbs: Verb[]): { ops: Op[]; errors: string[] } {
  const ops: Op[] = []
  const errors: string[] = []
  const walls = new Set(plan.walls.map((w) => w.id))
  const rooms = new Set(plan.rooms.map((r) => r.id))
  verbs.forEach((v, i) => {
    const at = `verb ${i + 1}`
    if (typeof v.wall === 'string') {
      const id = v.wall
      if (!plan.walls.some((w) => w.id === id)) return void errors.push(`${at}: väggen ${id} finns inte`)
      if (v.delete === true) return void ops.push({ op: 'delete', kind: 'wall', id })
      const mv = v.move as { dx?: unknown; dy?: unknown } | undefined
      if (mv) ops.push({ op: 'moveWall', id, dx: num(mv.dx) ?? 0, dy: num(mv.dy) ?? 0 })
      if (num(v.length) !== undefined) ops.push({ op: 'setWallLength', id, length: v.length as number, fixed: v.fixed === 'b' ? 'b' : 'a' })
      const patch: Record<string, unknown> = {}
      if (num(v.thickness) !== undefined) patch.thickness = v.thickness
      if (typeof v.exterior === 'boolean') patch.exterior = v.exterior
      if (typeof v.loadBearing === 'boolean') patch.loadBearing = v.loadBearing
      if (Object.keys(patch).length) ops.push({ op: 'update', kind: 'wall', id, patch })
      return
    }
    if (v.add_wall) {
      const w = v.add_wall as { a?: unknown; b?: unknown; thickness?: unknown; exterior?: unknown; loadBearing?: unknown }
      const a = pt(w.a)
      const b = pt(w.b)
      if (!a || !b) return void errors.push(`${at}: add_wall behöver a och b som {x,y}`)
      const id = freeId('w', walls)
      ops.push({ op: 'add', kind: 'wall', item: { id, a, b, thickness: num(w.thickness) ?? 200, phase: 'existing', ...(w.exterior === true ? { exterior: true } : {}), ...(w.loadBearing === true ? { loadBearing: true } : {}) } })
      return
    }
    if (typeof v.opening === 'string') {
      const id = v.opening
      if (!plan.openings.some((o) => o.id === id)) return void errors.push(`${at}: öppningen ${id} finns inte`)
      if (v.delete === true) return void ops.push({ op: 'delete', kind: 'opening', id })
      const patch: Record<string, unknown> = {}
      for (const k of ['offset', 'width', 'height']) if (num(v[k]) !== undefined) patch[k] = v[k]
      if (v.kind === 'door' || v.kind === 'window' || v.kind === 'opening') patch.kind = v.kind
      if (v.hinge === 'a' || v.hinge === 'b') patch.hinge = v.hinge
      if (v.swing === 'left' || v.swing === 'right') patch.swing = v.swing
      if (!Object.keys(patch).length) return void errors.push(`${at}: inget att ändra på ${id}`)
      ops.push({ op: 'update', kind: 'opening', id, patch })
      return
    }
    if (v.add_room) {
      const r = v.add_room as { name?: unknown; at?: unknown }
      const p = pt(r.at)
      if (typeof r.name !== 'string' || !p) return void errors.push(`${at}: add_room behöver name och at {x,y}`)
      ops.push({ op: 'add', kind: 'room', item: { id: freeId('r', rooms), name: r.name, at: p } })
      return
    }
    if (typeof v.room === 'string') {
      const id = v.room
      if (!plan.rooms.some((r) => r.id === id)) return void errors.push(`${at}: rummet ${id} finns inte`)
      if (v.delete === true) return void ops.push({ op: 'delete', kind: 'room', id })
      const patch: Record<string, unknown> = {}
      if (typeof v.name === 'string') patch.name = v.name
      if (pt(v.at)) patch.at = pt(v.at)
      if (!Object.keys(patch).length) return void errors.push(`${at}: inget att ändra på ${id}`)
      ops.push({ op: 'update', kind: 'room', id, patch })
      return
    }
    errors.push(`${at}: okänd rad – använd wall, add_wall, opening, add_room eller room`)
  })
  return { ops, errors }
}

export const FIX_DOC = `set: lista med enkla ändringar (id från plan_get):
- {"wall":"w3","move":{"dx":0,"dy":-40}} flytta (mm, y växer nedåt) · {"wall":"w3","thickness":200} · {"wall":"w3","length":3500,"fixed":"a"} · {"wall":"w3","exterior":true,"loadBearing":true} · {"wall":"w3","delete":true}
- {"add_wall":{"a":{"x":0,"y":0},"b":{"x":4000,"y":0},"thickness":200,"exterior":true}} (läggs in ungefär; plan_audit visar sedan hur långt från ritningen den ligger och plan_fix fäster den)
- {"opening":"o2","offset":900,"width":800,"kind":"door","hinge":"a","swing":"left"} · {"opening":"o2","delete":true}
- {"add_room":{"name":"Kök","at":{"x":3000,"y":2000}}} · {"room":"r1","name":"Kök"} · {"room":"r1","delete":true}`

export type Step = { done: string[]; next: string; why?: string }

// Where the plan stands and the one thing to do now.
export function nextStep(plan: Plan, state: { openIssues?: number } = {}): Step {
  const done: string[] = []
  const sources = (plan.sources ?? []).filter((s) => s.view !== 'elevation')
  const hasSource = sources.length > 0 || !!plan.underlay
  const calibrated = sources.some((s) => s.calibration) || !!plan.underlay
  const id = plan.id
  if (!hasSource && plan.walls.length === 0)
    return { done, next: `plan_upload_link {"plan_id":"${id}"} – ge länken till användaren och vänta tills de säger att ritningen är uppladdad. Rita inget före det.` }
  if (hasSource) done.push(`källritning: ${sources.map((s) => s.id).join(', ') || 'underlag'}`)
  if (hasSource && !calibrated)
    return { done, next: `Kalibrera: läs de tryckta yttermåtten i ritningen (plan_scan_view) och kör plan_trace {"plan_id":"${id}","printed_outer_mm":{"width":…,"length":…}}. Om den inte hittar huset säkert: plan_scan_dimension med ändpunkterna.`, why: 'utan kalibrering är alla mått fel' }
  if (calibrated) done.push('kalibrerad')
  if (plan.walls.length === 0)
    return { done, next: `plan_trace {"plan_id":"${id}","printed_outer_mm":{…}} ger ett utkast av väggar och öppningar. Eller lägg in väggarna ungefär med plan_fix add_wall och låt plan_audit fästa dem mot ritningen.` }
  done.push(`${plan.walls.length} väggar`)
  if (plan.openings.length === 0)
    return { done, next: `plan_trace {"plan_id":"${id}"} läser öppningar och dörrar mot väggarna som finns (rör inte väggarna).` }
  done.push(`${plan.openings.length} öppningar`)
  if (state.openIssues === undefined || state.openIssues > 0)
    return { done, next: `plan_audit {"plan_id":"${id}"} – jämför planen med ritningen och listar vad som avviker, sedan plan_fix.`, why: state.openIssues ? `${state.openIssues} anmärkningar återstår` : undefined }
  done.push('ingen avvikelse mot ritningen')
  if (plan.rooms.length === 0) {
    const sp = (spaceGrid(plan, 'fore')?.spaces ?? []).filter((s) => !s.open && s.area > 1.5e6)
    return { done, next: `Lägg in rummen med plan_fix add_room (namn som ritningen skriver). Utrymmen: ${sp.slice(0, 10).map((s) => `(${Math.round(s.at.x)},${Math.round(s.at.y)}) ${(s.area / 1e6).toFixed(1)} m²`).join('; ') || 'se plan_view'}.` }
  }
  done.push(`${plan.rooms.length} rum`)
  if (plan.dimensions.length === 0 || !plan.sheet.titleBlock.property.trim() || !plan.sheet.titleBlock.address.trim() || !plan.sheet.titleBlock.author.trim())
    return { done, next: `plan_finish {"plan_id":"${id}","printed_outer_mm":{…},"fit_outer":true} – sätter blad och mått och säger vad användaren ska fylla i (ställ frågan en gång).` }
  return { done, next: 'Klart. Sammanfatta för användaren: vad som är uppmätt från ritningen, vad som är uppskattat, vad som inte gick att läsa och vad som bör kontrolleras på plats.' }
}
