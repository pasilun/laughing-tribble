import { auditPlan, sourceIdOf } from '../../assist/audit'
import { PLANS } from '../../storage/docs'
import { loadPlan } from '../../service'
import { answer } from '../answer'
import { badArgument, notFound } from '../findings'
import { CHECKS } from '../registries'
import type { CheckEntry } from '../checks'
import { nextCalls } from '../next'
import { toToolResult, type ToolResult } from '../result'
import type { Finding, Next } from '../types'
import type { Args } from './index'

const fail = (findings: Finding[]) => toToolResult(answer({ ok: false, findings }), { summary: findings[0].message })

export async function check(args: Args): Promise<ToolResult> {
  const id = args.id
  if (id === undefined || id === '') return fail([badArgument('id', 'krävs')])
  if (typeof id !== 'string') return fail([badArgument('id', 'ska vara en sträng')])
  if (!PLANS.id.test(id)) return fail([badArgument('id', 'ogiltigt id')])
  if (args.scope !== undefined && (!Array.isArray(args.scope) || args.scope.some((s) => typeof s !== 'string'))) return fail([badArgument('scope', 'ska vara en lista av strängar')])
  if (args.against !== undefined && (typeof args.against !== 'object' || args.against === null || Array.isArray(args.against))) return fail([badArgument('against', 'ska vara ett objekt')])
  const scopes = (args.scope as string[] | undefined)?.length ? (args.scope as string[]) : ['permit']
  const entries: CheckEntry[] = []
  const unknown: Finding[] = []
  for (const s of scopes) {
    const r = CHECKS.resolve(s)
    if ('finding' in r) unknown.push(r.finding)
    else entries.push(r.entry as CheckEntry)
  }
  if (unknown.length) return fail(unknown)
  const rev = await loadPlan(id)
  if (!rev) return fail([notFound(id)])
  const against = (args.against ?? {}) as Record<string, unknown>
  const findings: Finding[] = []
  const texts: string[] = []
  for (const e of entries) {
    const out = await e.run({ id, plan: rev.plan, revision: rev.meta.n, against })
    findings.push(...out.findings)
    if (out.text) texts.push(out.text)
  }
  // Where the plan stands: the audit count decides whether to compare with the drawing again.
  const p = rev.plan
  const sources = (p.sources ?? []).filter((x) => x.view !== 'elevation')
  let open: number | undefined
  if (scopes.includes('audit')) open = findings.filter((f) => f.code.startsWith('audit-') && f.level !== 'info').length
  else if (p.walls.length && p.openings.length && sources.some((x) => x.calibration) && sourceIdOf(p)) open = (await auditPlan(id, p)).filter((i) => i.level !== 'info').length
  const steps = nextCalls(p, rev.meta.n, { openIssues: open })
  const next: Next[] = []
  const fixes = findings.filter((f) => f.fix?.length)
  if (fixes.length) next.push({ tool: 'edit', arguments: { id, base_revision: rev.meta.n, ops: fixes.flatMap((f) => f.fix!) }, why: `Rätta ${fixes.length} anmärkningar direkt (${fixes.slice(0, 3).map((f) => f.id).join(', ')}${fixes.length > 3 ? ', …' : ''}).` })
  next.push(...steps.next)
  const summary = [`Revision ${rev.meta.n}. Klart hittills: ${steps.done.join(', ') || 'inget'}.`, ...texts, steps.note ?? ''].filter(Boolean).join('\n')
  return toToolResult(answer({ ok: true, id, revision: rev.meta.n, findings, next, data: { scopes, done: steps.done } }), { summary })
}
