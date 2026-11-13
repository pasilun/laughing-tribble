import { applyOps, type Op } from '../../domain/ops'
import { capture } from '../../scan/kit'
import { handleScanTool } from '../../scan/tools'
import { loadPlan } from '../../service'
import { PLANS } from '../../storage/docs'
import { answer } from '../answer'
import { badArgument, invalidOperation, notFound } from '../findings'
import { SCAN_ACTIONS } from '../registries'
import { toToolResult, type ToolResult } from '../result'
import type { Finding, Next } from '../types'
import type { Args } from './index'
import { candidates } from './candidates'
import { passed, unpack } from './legacy'

const fail = (findings: Finding[], id?: string): ToolResult =>
  toToolResult(answer({ ok: false, ...(id ? { id } : {}), findings }), { summary: findings[0].message })

// Reads a source drawing without changing the plan. A reading that would change the plan comes back as a proposal: the operations
// for edit, worked out against the revision the plan has now.
export async function scan(args: Args): Promise<ToolResult> {
  const id = args.id
  if (typeof id !== 'string' || !id) return fail([badArgument('id', 'krävs')])
  if (!PLANS.id.test(id)) return fail([badArgument('id', 'ogiltigt id')])
  if (typeof args.action !== 'string' || !args.action) return fail([badArgument('action', 'krävs')], id)
  const given = passed(args.args)
  if (!given) return fail([badArgument('args', 'ska vara ett objekt')], id)
  const resolved = SCAN_ACTIONS.resolve(args.action)
  if ('finding' in resolved) return fail([resolved.finding], id)
  const entry = resolved.entry
  const rev = await loadPlan(id)
  if (!rev) return fail([notFound(id)], id)
  const n = rev.meta.n
  if (entry.name === 'candidates') return candidates(id, rev.plan, n, given, typeof args.max_tokens === 'number' ? args.max_tokens : undefined)

  const call = { ...given, plan_id: id, ...(entry.proposes ? { base_revision: n, apply: true } : {}) }
  const { result, taken } = await capture(rev.plan, n, async () => (await handleScanTool(entry.tool, call)) ?? { content: [], isError: true })
  const out = unpack(result)
  if (out.isError) return toToolResult(answer({ ok: false, id, revision: n, findings: [invalidOperation(out.text)] }), { summary: out.text, images: out.images })

  const text = out.text.replace(/Sparad som revision \d+\./g, 'Förslag, inget sparat.').replace(/Förhandsvisning \(inget sparat\)\./g, 'Förslag, inget sparat.')
  const ops: Op[] = taken.flatMap((t) => t.ops)
  const next: Next[] = []
  const data: Record<string, unknown> = { action: entry.name }
  if (ops.length > 0) {
    const message = taken.map((t) => t.message).join('; ')
    const checked = applyOps(rev.plan, ops)
    if (checked.errors.length) return fail([invalidOperation(checked.errors.join('\n'))], id)
    data.proposals = taken
    next.push({ tool: 'edit', arguments: { id, base_revision: n, ops, message }, why: 'Spara förslaget. Titta först på bilden.' })
  }
  return toToolResult(answer({ ok: true, id, revision: n, ...(next.length ? { next } : {}), data }), { summary: text, images: out.images })
}
