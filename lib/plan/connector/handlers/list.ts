import type { Revision } from '../../domain/types'
import { listPlans, listRevisions } from '../../storage/store'
import { answer } from '../answer'
import { badArgument, notFound } from '../findings'
import { LIST_KINDS } from '../registries'
import { toToolResult, type ToolResult } from '../result'
import type { Finding } from '../types'
import type { Args } from './index'

// Lists the person's documents, or the revisions of one: a page at a time, with a cursor for the next page.

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

// The first bad argument, or undefined when all of them are fine.
function argumentFinding(args: Args): Finding | undefined {
  const { what, id, query, limit, cursor } = args
  if (what !== undefined && typeof what !== 'string') return badArgument('what', 'ska vara en text')
  if (id !== undefined && typeof id !== 'string') return badArgument('id', 'ska vara en text')
  if (query !== undefined && typeof query !== 'string') return badArgument('query', 'ska vara en text')
  if (limit !== undefined && !Number.isInteger(limit)) return badArgument('limit', 'ska vara ett heltal')
  if (cursor !== undefined && (typeof cursor !== 'string' || !/^\d+$/.test(cursor))) return badArgument('cursor', 'ska vara ett heltal som text')
  return undefined
}

// Leaves out the keys whose value is undefined.
function present(o: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined))
}

// The page `[offset, offset + limit)` of `all`, and the data for it: `next_cursor` when more items remain.
function paged<T>(all: T[], offset: number, limit: number, items: T[]): Record<string, unknown> {
  const data: Record<string, unknown> = { items }
  if (offset + limit < all.length) data.next_cursor = String(offset + limit)
  return data
}

export async function list(args: Args): Promise<ToolResult> {
  // 1. Arguments
  const bad = argumentFinding(args)
  if (bad) return toToolResult(answer({ ok: false, findings: [bad] }), { summary: bad.message })
  const limit = Math.min(MAX_LIMIT, Math.max(1, (args.limit as number | undefined) ?? DEFAULT_LIMIT))
  const offset = Number((args.cursor as string | undefined) ?? '0')

  // 2. What: 'plans' by default; any other name is an unknown-name finding.
  const kind = LIST_KINDS.resolve((args.what as string | undefined) ?? 'plans')
  if ('finding' in kind) return toToolResult(answer({ ok: false, findings: [kind.finding] }), { summary: kind.finding.message })

  // 3. Plans, or the revisions of one plan.
  if (kind.entry.name === 'revisions') return revisions(args, limit, offset)
  return plans(args, limit, offset)
}

async function plans(args: Args, limit: number, offset: number): Promise<ToolResult> {
  const query = (args.query as string | undefined)?.toLowerCase()
  const all = await listPlans()
  const matching = query === undefined
    ? all
    : all.filter((p) => [p.name, ...(p.tags ?? [])].some((s) => s.toLowerCase().includes(query)))
  const shown = matching.slice(offset, offset + limit)
  const items = shown.map((p) =>
    present({ id: p.id, name: p.name, revision: p.revision, issued: p.issued, tags: p.tags, owner: p.owner, sharedWith: p.sharedWith }),
  )
  const line = (p: (typeof shown)[number]) =>
    `${p.id}: ${p.name} (rev ${p.revision}${p.issued.length ? `, utfärdad ${p.issued.at(-1)}` : ''})${p.tags?.length ? ` [${p.tags.join(', ')}]` : ''}${p.owner ? ` – delad av ${p.owner}` : ''}${p.sharedWith?.length ? ` – delad med ${p.sharedWith.join(', ')}` : ''}`
  return toToolResult(
    answer({ ok: true, data: paged(matching, offset, limit, items) }),
    { summary: shown.length ? shown.map(line).join('\n') : 'Inga dokument.' },
  )
}

async function revisions(args: Args, limit: number, offset: number): Promise<ToolResult> {
  // The id is needed here, and only here.
  const id = args.id as string | undefined
  if (id === undefined || id === '') {
    const f = badArgument('id', 'krävs')
    return toToolResult(answer({ ok: false, findings: [f] }), { summary: f.message })
  }
  const all = (await listRevisions(id)).sort((p, q) => q.n - p.n)
  if (!all.length) {
    const nf = notFound(id)
    return toToolResult(answer({ ok: false, findings: [nf] }), { summary: nf.message })
  }
  const shown = all.slice(offset, offset + limit)
  const items = shown.map((r: Revision) =>
    present({ n: r.n, author: r.author, message: r.message, createdAt: r.createdAt, issued: r.issued, by: r.by }),
  )
  const line = (r: Revision) => `rev ${r.n} ${r.createdAt} ${r.author}${r.by ? ` (${r.by})` : ''}: ${r.message}`
  return toToolResult(
    answer({ ok: true, id, data: paged(all, offset, limit, items) }),
    { summary: shown.map(line).join('\n') },
  )
}
