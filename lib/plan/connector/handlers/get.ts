import { changedSince, links, summarisePlan, type Section } from '../../mcp/format'
import { PLANS } from '../../storage/docs'
import { loadPlan } from '../../service'
import { answer } from '../answer'
import { badArgument, notFound } from '../findings'
import { PARTS } from '../registries'
import { Registry, type Entry } from '../names'
import { toToolResult, type ToolResult } from '../result'
import type { Finding } from '../types'
import type { Args } from './index'

// Reads a document: its listing as text (whole, in parts, or what changed since a revision), or the whole plan as data.

const FORMATS = new Registry<Entry>('formats-of-get', 'format', [
  { name: 'text', summary: 'The listing as text' },
  { name: 'json', summary: 'The whole plan as data' },
])

// The first bad argument, or undefined when all of them are fine.
function argumentFinding(args: Args): Finding | undefined {
  const { id, parts, since, format } = args
  if (id === undefined || id === '') return badArgument('id', 'krävs')
  if (typeof id !== 'string') return badArgument('id', 'ska vara en text')
  if (!PLANS.id.test(id)) return badArgument('id', 'ogiltigt id')
  if (parts !== undefined && (!Array.isArray(parts) || !parts.every((p) => typeof p === 'string'))) return badArgument('parts', 'ska vara en lista av texter')
  if (since !== undefined && !Number.isInteger(since)) return badArgument('since', 'ska vara ett heltal')
  if (format !== undefined && typeof format !== 'string') return badArgument('format', 'ska vara en text')
  return undefined
}

export async function get(args: Args): Promise<ToolResult> {
  // 1. Arguments
  const bad = argumentFinding(args)
  if (bad) return toToolResult(answer({ ok: false, findings: [bad] }), { summary: bad.message })
  const id = args.id as string
  const parts = args.parts as string[] | undefined
  const since = args.since as number | undefined

  // 2. Format: 'text' by default; any other name is an unknown-name finding.
  const format = (args.format as string | undefined) ?? 'text'
  const f = FORMATS.resolve(format)
  if ('finding' in f) return toToolResult(answer({ ok: false, id, findings: [f.finding] }), { summary: f.finding.message })

  // 3. Parts: every unknown part is reported, nothing is read.
  const unknown: Finding[] = []
  const names: string[] = []
  for (let i = 0; i < (parts ?? []).length; i++) {
    const r = PARTS.resolve(parts![i])
    if ('finding' in r) unknown.push({ ...r.finding, data: { ...r.finding.data, index: i } })
    else names.push(r.entry.name)
  }
  if (unknown.length) return toToolResult(answer({ ok: false, id, findings: unknown }), { summary: unknown[0].message })

  // 4. Load
  const rev = await loadPlan(id).catch(() => null)
  if (!rev) {
    const nf = notFound(id)
    return toToolResult(answer({ ok: false, id, findings: [nf] }), { summary: nf.message })
  }

  // 5. Body
  let body: string
  if (since !== undefined) {
    const old = await loadPlan(id, since)
    if (!old) {
      const bf = badArgument('since', 'revisionen finns inte')
      return toToolResult(answer({ ok: false, id, revision: rev.meta.n, findings: [bf] }), { summary: bf.message })
    }
    body = `Ändrat sedan revision ${since}:\n${changedSince(old.plan, rev.plan) || 'Inget har ändrats sedan dess.'}`
  } else {
    body = summarisePlan(rev.plan, names.length ? (names as Section[]) : undefined)
  }

  // 6. Summary text
  const summary = `Revision ${rev.meta.n} (${rev.meta.message})\n${body}\n\n${links(rev.plan, rev.meta.n)}`

  // 7. Answer
  const plan = format === 'json' && rev.plan.underlay ? { ...rev.plan, underlay: { ...rev.plan.underlay, src: '…' } } : rev.plan
  return toToolResult(
    answer({
      ok: true,
      id,
      revision: rev.meta.n,
      data: format === 'json' ? { name: rev.plan.name, plan } : { name: rev.plan.name },
    }),
    { summary },
  )
}
