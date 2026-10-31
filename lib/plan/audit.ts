import { checkPlan } from './checks'
import { finishPlan } from './finish'
import { dist, wallLength } from './geometry'
import type { Op } from './ops'
import { reviewPlan } from './review'
import { readDoors } from './scan/doors'
import { showsWall } from './scan/openings'
import { loadGray, resolveSource } from './scan/raster'
import { snapWalls } from './scan/snap'
import type { Plan, Wall } from './types'

// plan_audit: the plan checked against the drawing it was traced from, by the server, so that
// whoever draws it (a small model, or a large one reviewing) reads a short list of numbered
// findings instead of looking for differences in pictures. Every finding that can be mended
// carries the exact operations; plan_fix applies the ones asked for.

export type AuditItem = {
  id: string // stable between calls: wall:<id>, door:<id>, opening:<id>, plan:<code>
  level: 'error' | 'warning' | 'info'
  text: string
  fix?: Op[]
  fixText?: string
}

const SHIFT_MM = 30
const THICKNESS_MM = 40
const MAX_REVIEW_ITEMS = 8

export function sourceIdOf(plan: Plan, id?: string): string | undefined {
  if (id) return id
  const list = (plan.sources ?? []).filter((s) => s.view !== 'elevation')
  return (list.find((s) => s.role === 'archive') ?? list[0])?.id ?? (plan.underlay ? 'underlay' : undefined)
}

export async function auditPlan(planId: string, plan: Plan, opts: { sourceId?: string; printed?: { width: number; length: number } } = {}): Promise<AuditItem[]> {
  const items: AuditItem[] = []
  const sid = sourceIdOf(plan, opts.sourceId)
  const src = sid ? (plan.sources ?? []).find((s) => s.id === sid) : undefined

  if (!sid) items.push({ id: 'plan:no-source', level: 'warning', text: 'Planen har ingen källritning – inget kan kontrolleras mot ritningen. Be användaren ladda upp den (plan_upload_link).' })
  else if (src && !src.calibration) items.push({ id: 'plan:not-calibrated', level: 'error', text: `Källan ${src.id} är inte kalibrerad mot tryckta mått – alla lägen kan vara fel. Kalibrera med plan_scan_dimension (apply) eller plan_trace.` })

  if (sid && plan.walls.length) {
    const r = resolveSource(plan, sid)
    const g = await loadGray(planId, r)
    const snapped = snapWalls(g, r, plan, { ids: plan.walls.map((w) => w.id), add: [] }, { keepThickness: false })
    const byId = new Map(snapped.walls.map((w) => [w.id, w]))
    for (const rep of snapped.reports) {
      const w = plan.walls.find((x) => x.id === rep.id)
      const s = byId.get(rep.id)
      if (!w) continue
      if (!rep.ok) {
        items.push({ id: `wall:${w.id}`, level: 'warning', text: `Väggen ${w.id} (${Math.round(wallLength(w))} mm) syns inte tydligt i ritningen (säkerhet ${rep.confidence})${rep.note ? `: ${rep.note}` : ''}. Finns den? Flytta den dit den ritats, eller ta bort den.` })
        continue
      }
      // Measured on the result, not on the fit: a wall drawn a little skew is squared by the
      // snapper, and then the plan's square wall is where it should be.
      const moved = s ? Math.round(Math.max(dist(w.a, s.a), dist(w.b, s.b))) : 0
      const dT = (s?.thickness ?? rep.thicknessMm) - w.thickness
      if (s && (moved > SHIFT_MM || Math.abs(dT) > THICKNESS_MM)) {
        const what = [moved > SHIFT_MM ? `ligger ${moved} mm från ritningen` : '', Math.abs(dT) > THICKNESS_MM ? `tjocklek ${w.thickness} mot ritningens ${s.thickness}` : ''].filter(Boolean).join(', ')
        items.push({
          id: `wall:${w.id}`,
          level: moved > 100 ? 'error' : 'warning',
          text: `Väggen ${w.id}: ${what}.`,
          fix: [{ op: 'update', kind: 'wall', id: w.id, patch: { a: s.a, b: s.b, thickness: s.thickness } }],
          fixText: `fäst mot ritningen: (${s.a.x},${s.a.y})→(${s.b.x},${s.b.y}) tj ${s.thickness}`,
        })
      }
    }
    // Openings against the drawing: a plain stretch of wall where an opening was put.
    for (const o of plan.openings) {
      if (o.kind === 'window' || o.through) continue
      const wall = plan.walls.find((w) => w.id === o.wallId)
      if (!wall) continue
      if (showsWall(g, r, plan, wall, o.offset, o.width) === true)
        items.push({ id: `opening:${o.id}`, level: 'warning', text: `${o.kind === 'door' ? 'Dörren' : 'Öppningen'} ${o.id} i ${wall.id} (offset ${o.offset}, bredd ${o.width}): ritningen visar hel vägg där. Flytta den, eller ta bort den om den inte finns.` })
    }
    const doors = readDoors(g, r, plan)
    for (const op of doors.ops) {
      if (op.op !== 'update') continue
      const rd = doors.readings.find((x) => x.id === op.id)
      items.push({ id: `door:${op.id}`, level: 'warning', text: `Dörren ${op.id}: slag eller gångjärn i planen stämmer inte med ritningen.`, fix: [op], fixText: `sätt gångjärn ${rd?.best?.hinge}, slag ${rd?.best?.swing} enligt ritningen` })
    }
  }

  // Outside size against the printed one, and what the review and the check flag.
  const fin = finishPlan(plan, { printedOuter: opts.printed })
  for (const f of fin.findings) {
    if (f.code === 'outer-size') items.push({ id: 'plan:outer-size', level: f.level, text: f.message })
  }
  const found = [...reviewPlan(plan).findings, ...checkPlan(plan)].filter((f) => f.code !== 'title-block' && f.level !== 'info')
  const errors = found.filter((f) => f.level === 'error')
  const warnings = found.filter((f) => f.level === 'warning')
  for (const f of errors.slice(0, MAX_REVIEW_ITEMS)) items.push({ id: `plan:${f.code}${f.ref ? `:${f.ref}` : ''}`, level: 'error', text: f.message })
  if (errors.length > MAX_REVIEW_ITEMS) items.push({ id: 'plan:more-errors', level: 'error', text: `… och ${errors.length - MAX_REVIEW_ITEMS} fel till (plan_check).` })
  if (warnings.length) items.push({ id: 'plan:warnings', level: 'info', text: `${warnings.length} varningar i granskningen (plan_review / plan_check), bland dem: ${warnings.slice(0, 3).map((f) => f.message).join(' | ')}` })

  const rank = { error: 0, warning: 1, info: 2 }
  return items.sort((a, b) => rank[a.level] - rank[b.level])
}

export function describeAudit(items: AuditItem[]): string {
  if (!items.length) return 'Inga avvikelser mot ritningen hittades.'
  const e = items.filter((i) => i.level === 'error').length
  const w = items.filter((i) => i.level === 'warning').length
  const fixable = items.filter((i) => i.fix)
  const lines = items.map((i) => `[${i.id}] ${i.level === 'error' ? 'FEL' : i.level === 'warning' ? 'varning' : 'info'}: ${i.text}${i.fix ? `\n    åtgärd: ${i.fixText ?? 'finns'}` : ''}`)
  const head = `${items.length} anmärkningar (${e} fel, ${w} varningar), ${fixable.length} kan rättas direkt.`
  const how = fixable.length ? `\n\nRätta med plan_fix: {"apply":[${fixable.slice(0, 3).map((i) => `"${i.id}"`).join(',')}${fixable.length > 3 ? ',…' : ''}]} eller {"apply":"alla"}. Resten rättas för hand (plan_fix set / plan_edit).` : ''
  return `${head}\n${lines.join('\n')}${how}`
}

export function wallOf(plan: Plan, id: string): Wall | undefined {
  return plan.walls.find((w) => w.id === id)
}
