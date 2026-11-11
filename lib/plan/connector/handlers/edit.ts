import { checkPlan } from '../../domain/checks'
import { applyOps, type Op } from '../../domain/ops'
import { preview } from '../../mcp/format'
import { PLANS } from '../../storage/docs'
import { editPlan, loadPlan } from '../../service'
import { answer } from '../answer'
import { changedList } from '../changes'
import { badArgument, freshFindings, invalidOperation, notFound, staleRevision } from '../findings'
import { OPERATIONS } from '../registries/operations'
import { toToolResult, type ImageBlock, type ToolResult } from '../result'
import type { Finding, Next } from '../types'
import type { Args } from './index'

// Changes a document's content by operations and saves them as a new revision (or only checks them, with dry_run).

// Answers a refused call: nothing was saved, the summary names the first finding.
const refuse = (findings: Finding[], next?: Next[]): ToolResult =>
  toToolResult(answer({ ok: false, findings, next }), { summary: `Ingen ändring sparades: ${findings[0].message}` })

// The first bad argument, or undefined when all of them are fine.
function argumentFinding(args: Args): Finding | undefined {
  const { id, base_revision: base, ops, dry_run: dryRun, image, message } = args
  if (id === undefined || id === '') return badArgument('id', 'krävs')
  if (typeof id !== 'string') return badArgument('id', 'ska vara en text')
  if (!PLANS.id.test(id)) return badArgument('id', 'ogiltigt id')
  if (base === undefined) return badArgument('base_revision', 'krävs')
  if (!Number.isInteger(base)) return badArgument('base_revision', 'ska vara ett heltal')
  if (ops === undefined) return badArgument('ops', 'krävs')
  if (!Array.isArray(ops)) return badArgument('ops', 'ska vara en lista')
  const list: unknown[] = ops
  for (let i = 0; i < list.length; i++) {
    const op = list[i]
    if (typeof op !== 'object' || op === null || Array.isArray(op)) return badArgument(`ops[${i}]`, 'ska vara ett objekt')
    if (typeof (op as Record<string, unknown>).op !== 'string') return badArgument(`ops[${i}].op`, 'krävs')
  }
  if (dryRun !== undefined && typeof dryRun !== 'boolean') return badArgument('dry_run', 'ska vara true eller false')
  if (image !== undefined && typeof image !== 'boolean') return badArgument('image', 'ska vara true eller false')
  if (message !== undefined && typeof message !== 'string') return badArgument('message', 'ska vara en text')
  return undefined
}

export async function edit(args: Args): Promise<ToolResult> {
  // 1. Arguments
  const bad = argumentFinding(args)
  if (bad) return refuse([bad])
  const id = args.id as string
  const base = args.base_revision as number
  const ops = args.ops as Op[]

  // 2. Names: every unknown operation is reported, nothing is read or saved.
  const named = args.ops as Array<{ op: string }>
  const unknown: Finding[] = []
  for (let i = 0; i < named.length; i++) {
    const r = OPERATIONS.resolve(named[i].op)
    if ('finding' in r) unknown.push({ ...r.finding, data: { ...r.finding.data, index: i } })
  }
  if (unknown.length) return refuse(unknown)

  // 3. Load
  let loaded: Awaited<ReturnType<typeof loadPlan>>
  try {
    loaded = await loadPlan(id)
  } catch (e) {
    return refuse([invalidOperation(e instanceof Error ? e.message : String(e))])
  }
  if (!loaded) return refuse([notFound(id)])
  const before = loaded.plan
  const current = loaded.meta.n

  // 4. Stale
  if (base !== current) {
    return refuse([staleRevision(base, current)], [{ tool: 'get', arguments: { id, since: base }, why: 'Läs vad som ändrats och gör om ändringen' }])
  }

  // 5. Dry run
  if (args.dry_run === true) {
    const res = applyOps(before, ops)
    if (res.errors.length) return refuse(res.errors.map((m) => invalidOperation(m)))
    return toToolResult(
      answer({
        ok: true,
        id,
        revision: current,
        changed: changedList(before, res.plan),
        findings: freshFindings(checkPlan(before), checkPlan(res.plan)).fresh,
        data: { dry_run: true },
      }),
      { summary: `Provkörning: inget sparades. Revision ${current} är kvar.` },
    )
  }

  // 6. Save
  let res: Awaited<ReturnType<typeof editPlan>>
  try {
    res = await editPlan(id, ops, base, 'claude', (args.message as string | undefined) ?? 'Ändring av Claude')
  } catch (e) {
    return refuse([invalidOperation(e instanceof Error ? e.message : String(e))])
  }
  if (res.status === 404) return refuse([notFound(id)])
  if (res.status === 409) return refuse([staleRevision(base, res.head)])
  if (res.status !== 200) return refuse(res.errors.map((m) => invalidOperation(m)))

  const n = res.revision.n
  const { fresh, gone } = freshFindings(checkPlan(before), checkPlan(res.plan))
  const open = fresh.some((f) => f.level === 'error' || f.level === 'warning')
  const next: Next[] = open ? [{ tool: 'check', arguments: { id }, why: 'Se vad som återstår' }] : []
  const summary = `Sparad som revision ${n}.${gone > 0 ? ` ${gone} anmärkningar är åtgärdade.` : ''}`

  // 7. Picture
  const images: ImageBlock[] = []
  if (args.image === true) images.push(await preview(res.plan, 'efter', false))

  return toToolResult(
    answer({
      ok: true,
      id,
      revision: n,
      changed: changedList(before, res.plan),
      findings: fresh,
      next,
    }),
    { summary, images },
  )
}
