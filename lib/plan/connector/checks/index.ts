import { comparePlans } from '../../assist/compare'
import { loadPlan } from '../../service'
import { auditPlan } from '../../assist/audit'
import { hasChanges } from '../../domain/sheet'
import { describeReview, reviewPlan } from '../../assist/review'
import { finishPlan } from '../../assist/finish'
import { finding } from '../answer'
import { checkPlan } from '../../domain/checks'
import type { Plan } from '../../domain/types'
import type { Entry } from '../names'
import type { Finding } from '../types'
import { badArgument, fromCheck, notFound } from '../findings'

export type CheckContext = { id: string; plan: Plan; revision: number; against: Record<string, unknown> }
export type CheckOutput = { findings: Finding[]; text?: string }
export type CheckEntry = Entry & { run: (c: CheckContext) => Promise<CheckOutput> }

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

export const permit: CheckEntry = { name: 'permit', summary: 'What an application for interior work needs to show (title block, scale, load-bearing, fire, ventilation)',
  run: async (c) => ({ findings: checkPlan(c.plan).map(fromCheck) }) }

export const review: CheckEntry = { name: 'review', summary: 'An architect walking the plan: access, doors, rooms, one entrance per flat',
  run: async (c) => {
    const r = reviewPlan(c.plan, hasChanges(c.plan) ? 'efter' : 'fore')
    return { findings: r.findings.map(fromCheck), text: describeReview(r, c.plan.rooms).split('\n').filter((l) => !l.startsWith('- [')).join('\n') } } }

export const finish: CheckEntry = { name: 'finish', summary: 'The last mechanical steps: sheet scale, overall dimensions, title block; fix carries the operations',
  run: async (c) => {
    const po = c.against.printed_outer_mm as { width?: unknown; length?: unknown } | undefined
    const printedOuter = po && num(po.width) !== undefined && num(po.length) !== undefined ? { width: po.width as number, length: po.length as number } : undefined
    const fin = finishPlan(c.plan, { markExteriorLoadBearing: c.against.mark_exterior_load_bearing === true, printedOuter, fitOuter: c.against.fit_outer === true })
    const out: Finding[] = fin.findings.map(fromCheck)
    if (fin.ops.length) out.unshift(finding({ code: 'finish-ops', level: 'info', message: `Kan göras direkt: ${fin.done.join('; ')}`, fix: fin.ops as Array<Record<string, unknown>> }))
    if (fin.ask.length) out.push(finding({ code: 'finish-ask-user', level: 'warning', message: `Fråga användaren (ett meddelande): ${fin.ask.join('; ')}. Sätt fälten med setTitleBlock. Skriv inte in egna gissningar.`, data: { ask: fin.ask } }))
    return { findings: out }
  } }

export const compare: CheckEntry = { name: 'compare', summary: 'The plan against a reference plan of the same floor (against: {id})',
  run: async (c) => {
    const refId = c.against.id
    if (typeof refId !== 'string' || !refId) return { findings: [badArgument('against', 'id på referensplanen krävs')] }
    const ref = await loadPlan(refId)
    if (!ref) return { findings: [notFound(refId)] }
    const cmp = comparePlans(c.plan, ref.plan, { matchMm: num(c.against.match_mm) })
    const out: Finding[] = []
    for (const w of cmp.walls) {
      if (Math.abs(w.diffMm) > 30) out.push(finding({ code: 'compare-wall-position', level: 'warning', refs: [w.id], message: `Väggen ${w.id} ligger ${w.diffMm >= 0 ? '+' : ''}${w.diffMm} mm från referensen (${w.axis}).`, data: { diff_mm: w.diffMm, axis: w.axis } }))
      if (Math.abs(w.thicknessDiffMm) > 40) out.push(finding({ code: 'compare-wall-thickness', level: 'warning', refs: [w.id], message: `Väggen ${w.id} är ${w.thickness} mm tjock mot ${w.refThickness} i referensen.`, data: { thickness: w.thickness, reference: w.refThickness } }))
    }
    for (const m of cmp.openings.missed) out.push(finding({ code: 'compare-opening-missing', level: 'warning', refs: [m.refId], message: `Referensen har ${m.kind} ${m.refId} i ${m.wallId}; planen saknar den.` }))
    for (const m of cmp.openings.extra) out.push(finding({ code: 'compare-opening-extra', level: 'info', refs: [m.id], message: `Planen har ${m.kind} ${m.id} i ${m.wallId} som referensen saknar.` }))
    for (const id of cmp.wallsOnlyInRef) out.push(finding({ code: 'compare-wall-missing', level: 'warning', refs: [id], message: `Väggen ${id} finns bara i referensen.` }))
    for (const id of cmp.wallsOnlyInPlan) out.push(finding({ code: 'compare-wall-extra', level: 'info', refs: [id], message: `Väggen ${id} finns bara i planen.` }))
    const fit = (f: { scale: number; rmsMm: number; n: number }) => `skala ${f.scale.toFixed(4)}, ${f.n} väggar, spridning ${f.rmsMm} mm`
    return { findings: out, text: `Jämförelse med ${refId}. Inpassning x: ${fit(cmp.fit.x)}; y: ${fit(cmp.fit.y)}. ${cmp.walls.length} gemensamma väggar, ${cmp.openings.matched.length} öppningar matchade.` }
  } }

export const audit: CheckEntry = { name: 'audit', summary: 'The plan against the drawing it was traced from; findings carry the fix',
  run: async (c) => {
    const po = c.against.printed_outer_mm as { width?: unknown; length?: unknown } | undefined
    const printed = po && num(po.width) !== undefined && num(po.length) !== undefined ? { width: po.width as number, length: po.length as number } : undefined
    const items = await auditPlan(c.id, c.plan, { sourceId: typeof c.against.source === 'string' ? c.against.source : undefined, printed })
    return { findings: items.map((i) => finding({ id: i.id, code: `audit-${i.id.split(':')[0]}`, level: i.level, message: i.text, refs: [i.id], ...(i.fix ? { fix: i.fix as Array<Record<string, unknown>> } : {}), ...(i.fixText ? { data: { fix_text: i.fixText } } : {}) })) }
  } }
