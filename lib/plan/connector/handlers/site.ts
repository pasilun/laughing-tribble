import { cleanItems } from '../../../site/doc'
import { applySiteOps, describe, picture } from '../../../site/mcp'
import { createSite, editSite } from '../../../site/service'
import { getSite, listSites } from '../../../site/store'
import { answer, finding } from '../answer'
import { badArgument, invalidOperation, notFound, staleRevision } from '../findings'
import { SITE_OPERATIONS } from '../registries'
import { toToolResult, type ToolResult } from '../result'
import type { Finding } from '../types'
import type { Args } from './index'

// Site plans (a property seen from above) as documents of the connector. Their ids start with "site:".

export const SITE_PREFIX = 'site:'
export const isSite = (id: unknown): id is string => typeof id === 'string' && id.startsWith(SITE_PREFIX)
export const slugOf = (id: string) => id.slice(SITE_PREFIX.length)
export const siteId = (slug: string) => `${SITE_PREFIX}${slug}`

const fail = (findings: Finding[], id?: string, revision?: number): ToolResult =>
  toToolResult(answer({ ok: false, ...(id ? { id } : {}), ...(revision !== undefined ? { revision } : {}), findings }), { summary: findings[0].message })

// For the tools that only work on floor plans.
export const wrongKind = (id: string): ToolResult =>
  fail([finding({ code: 'wrong-kind', level: 'error', message: `${id} är en tomt. Verktyget gäller bara planritningar. Tomter hanteras med get, view, edit, list och manage (ämnet sites i guide).`, refs: [id] })], id)

async function load(id: string, revision?: number) {
  try {
    return await getSite(slugOf(id), revision)
  } catch {
    return null
  }
}

export async function siteGet(args: Args): Promise<ToolResult> {
  const id = args.id as string
  if (args.since !== undefined) return fail([badArgument('since', 'går inte för tomter')], id)
  const s = await load(id)
  if (!s) return fail([notFound(id)], id)
  const text = `Revision ${s.meta.n} (${s.meta.author}: ${s.meta.message})\n${describe(s.doc, args.parts !== undefined)}`
  return toToolResult(answer({ ok: true, id, revision: s.meta.n, ...(args.format === 'json' ? { data: { site: s.doc } } : {}) }), { summary: text })
}

export async function siteView(args: Args): Promise<ToolResult> {
  const id = args.id as string
  const s = await load(id)
  if (!s) return fail([notFound(id)], id)
  const options = (typeof args.options === 'object' && args.options !== null ? args.options : {}) as Record<string, unknown>
  const images = (await picture(s.doc, options.underlay)).flatMap((c) => (c.type === 'image' ? [c] : []))
  return toToolResult(answer({ ok: true, id, revision: s.meta.n }), { summary: `Tomten ${s.doc.designation}, revision ${s.meta.n}.`, images })
}

export async function siteEdit(args: Args): Promise<ToolResult> {
  const id = args.id as string
  const base = args.base_revision
  const ops = args.ops
  if (!Number.isInteger(base)) return fail([badArgument('base_revision', 'krävs, ett heltal')], id)
  if (!Array.isArray(ops)) return fail([badArgument('ops', 'krävs, en lista')], id)
  const list = ops as Array<Record<string, unknown>>
  const unknown: Finding[] = []
  list.forEach((op, i) => {
    if (typeof op !== 'object' || op === null || typeof op.op !== 'string') return void unknown.push(badArgument(`ops[${i}].op`, 'krävs'))
    const r = SITE_OPERATIONS.resolve(op.op)
    if ('finding' in r) unknown.push({ ...r.finding, message: `Operation ${i + 1}: ${r.finding.message}`, data: { ...r.finding.data, index: i } })
  })
  if (unknown.length) return fail(unknown, id)
  const cur = await load(id)
  if (!cur) return fail([notFound(id)], id)
  if (base !== cur.meta.n) return fail([staleRevision(base as number, cur.meta.n)], id, cur.meta.n)
  const { items, buildings, problems } = applySiteOps(cur.doc, list)
  if (problems.length) return fail(problems.map(invalidOperation), id, cur.meta.n)
  const clean = cleanItems(items)
  if (clean.errors.length) return fail(clean.errors.map(invalidOperation), id, cur.meta.n)
  if (args.dry_run === true) return toToolResult(answer({ ok: true, id, revision: cur.meta.n, data: { dry_run: true } }), { summary: `Provkörning: inget sparades. Revision ${cur.meta.n} är kvar.` })
  const res = await editSite(slugOf(id), { items, buildings }, base as number, 'claude', typeof args.message === 'string' ? args.message : 'Ändrat av Claude')
  if ('errors' in res) return fail(res.status === 409 ? [staleRevision(base as number, res.head ?? cur.meta.n)] : res.errors.map(invalidOperation), id, cur.meta.n)
  const images = args.image === true ? (await picture(res.stored.doc, undefined)).flatMap((c) => (c.type === 'image' ? [c] : [])) : []
  return toToolResult(answer({ ok: true, id, revision: res.stored.meta.n }), { summary: `Sparad som revision ${res.stored.meta.n}.\n${describe(res.stored.doc, false)}`, images })
}

export async function siteList(limit: number, offset: number, query?: string): Promise<ToolResult> {
  const all = (await listSites()).filter((s) => query === undefined || s.designation.toLowerCase().includes(query.toLowerCase()))
  const shown = all.slice(offset, offset + limit)
  const items = shown.map((s) => ({ id: siteId(s.slug), name: s.designation, revision: s.revision, ...(s.owner ? { owner: s.owner } : {}), ...(s.sharedWith?.length ? { sharedWith: s.sharedWith } : {}) }))
  const data: Record<string, unknown> = { items }
  if (offset + limit < all.length) data.next_cursor = String(offset + limit)
  return toToolResult(answer({ ok: true, data }), { summary: shown.length ? shown.map((s) => `${siteId(s.slug)}: ${s.designation} (rev ${s.revision})${s.owner ? ` – delad av ${s.owner}` : ''}`).join('\n') : 'Inga tomter.' })
}

export async function siteCreate(designation: unknown): Promise<ToolResult> {
  if (typeof designation !== 'string' || !designation.trim()) return fail([badArgument('args.designation', 'krävs')])
  const res = await createSite(designation, 'claude')
  if ('errors' in res) return fail(res.errors.map(invalidOperation))
  const id = siteId(res.stored.doc.slug)
  return toToolResult(answer({ ok: true, id, revision: res.stored.meta.n }), { summary: `Skapad: ${id}, revision ${res.stored.meta.n}.\n${describe(res.stored.doc, false)}` })
}
