import { auditPlan } from '../../assist/audit'
import { hasChanges } from '../../domain/sheet'
import { describeReview, reviewPlan } from '../../assist/review'
import { finishPlan } from '../../assist/finish'
import { finding } from '../answer'
import { checkPlan } from '../../domain/checks'
import type { Plan } from '../../domain/types'
import type { Entry } from '../names'
import type { Finding } from '../types'
import { fromCheck } from '../findings'

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

export const audit: CheckEntry = { name: 'audit', summary: 'The plan against the drawing it was traced from; findings carry the fix',
  run: async (c) => {
    const po = c.against.printed_outer_mm as { width?: unknown; length?: unknown } | undefined
    const printed = po && num(po.width) !== undefined && num(po.length) !== undefined ? { width: po.width as number, length: po.length as number } : undefined
    const items = await auditPlan(c.id, c.plan, { sourceId: typeof c.against.source === 'string' ? c.against.source : undefined, printed })
    return { findings: items.map((i) => finding({ id: i.id, code: `audit-${i.id.split(':')[0]}`, level: i.level, message: i.text, refs: [i.id], ...(i.fix ? { fix: i.fix as Array<Record<string, unknown>> } : {}), ...(i.fixText ? { data: { fix_text: i.fixText } } : {}) })) }
  } }
