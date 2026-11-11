import { autoTrace } from '../../assist/trace'
import { host } from '../../mcp/format'
import { handleScanTool } from '../../scan/tools'
import { loadPlan } from '../../service'
import { PLANS } from '../../storage/docs'
import { answer } from '../answer'
import { changedList } from '../changes'
import { badArgument, invalidOperation, notFound, staleRevision } from '../findings'
import { SOURCE_ACTIONS } from '../registries'
import { modernWords } from '../wording'
import { toToolResult, type ImageBlock, type ToolResult } from '../result'
import type { Finding } from '../types'
import type { Args } from './index'
import { passed, unpack } from './legacy'

const fail = (findings: Finding[], id?: string, revision?: number): ToolResult =>
  toToolResult(answer({ ok: false, ...(id ? { id } : {}), ...(revision !== undefined ? { revision } : {}), findings }), { summary: findings[0].message })

// Getting a drawing in and placing it. Saves a new revision, except with dry_run.
export async function source(args: Args): Promise<ToolResult> {
  const id = args.id
  if (typeof id !== 'string' || !id) return fail([badArgument('id', 'krävs')])
  if (!PLANS.id.test(id)) return fail([badArgument('id', 'ogiltigt id')])
  if (typeof args.action !== 'string' || !args.action) return fail([badArgument('action', 'krävs')], id)
  if (args.base_revision !== undefined && !Number.isInteger(args.base_revision)) return fail([badArgument('base_revision', 'ska vara ett heltal')], id)
  if (args.dry_run !== undefined && typeof args.dry_run !== 'boolean') return fail([badArgument('dry_run', 'ska vara true eller false')], id)
  const given = passed(args.args)
  if (!given) return fail([badArgument('args', 'ska vara ett objekt')], id)
  const resolved = SOURCE_ACTIONS.resolve(args.action)
  if ('finding' in resolved) return fail([resolved.finding], id)
  const name = resolved.entry.name
  const before = await loadPlan(id)
  if (!before) return fail([notFound(id)], id)
  const n = before.meta.n
  const dry = args.dry_run === true

  if (name === 'upload_link') {
    const link = `${host()}/plans/${id}/upload`
    return toToolResult(
      answer({ ok: true, id, revision: n, data: { link } }),
      { summary: `Be användaren öppna länken och släppa ritningen där (logga in första gången):\n${link}\n\nBe om ritningens skala (t.ex. 1:100) och år. När användaren säger att den är uppladdad: läs planen med get (revisionen har ökat), titta på källan med view (vyn source) och kalibrera med source (action "trace" eller "calibrate").` },
    )
  }
  if (typeof args.base_revision !== 'number') return fail([badArgument('base_revision', 'krävs')], id, n)
  if (args.base_revision !== n) return fail([staleRevision(args.base_revision, n)], id, n)
  if (dry && (name === 'add' || name === 'trace')) return fail([badArgument('dry_run', `går inte för åtgärden ${name}`)], id, n)

  let text: string
  let images: ImageBlock[] = []
  let isError = false
  if (name === 'trace') {
    const po = given.printed_outer_mm as { width?: unknown; length?: unknown } | undefined
    const printed = po && typeof po.width === 'number' && typeof po.length === 'number' ? { width: po.width, length: po.length } : undefined
    const dims = Array.isArray(given.dimensions) ? (given.dimensions as Array<{ a: { x: number; y: number }; b: { x: number; y: number }; mm: number; label?: string }>) : undefined
    const out = await autoTrace(id, { sourceId: typeof given.source_id === 'string' ? given.source_id : undefined, printed, dimensions: dims })
    text = modernWords(out.text)
    isError = out.isError === true
    if (out.png) images = [{ type: 'image', data: out.png.toString('base64'), mimeType: 'image/png' }]
  } else {
    const res = await handleScanTool(resolved.entry.tool, { ...given, plan_id: id, base_revision: n, apply: !dry })
    const u = unpack(res ?? { content: [], isError: true })
    text = u.text
    images = u.images
    isError = u.isError
  }
  if (isError) return toToolResult(answer({ ok: false, id, revision: n, findings: [invalidOperation(text)] }), { summary: text, images })

  const after = await loadPlan(id)
  const revision = after?.meta.n ?? n
  const data = { action: name, ...(dry ? { dry_run: true } : {}) }
  return toToolResult(
    answer({ ok: true, id, revision, ...(after && after.meta.n !== n ? { changed: changedList(before.plan, after.plan) } : {}), data }),
    { summary: dry ? `Provkörning: inget sparades. Revision ${n} är kvar.\n${text}` : text, images },
  )
}
