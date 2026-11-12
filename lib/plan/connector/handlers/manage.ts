import { currentUser } from '../../auth/user'
import { links } from '../../mcp/format'
import { createPlan, importPlan, renamePlan, tagPlan } from '../../service'
import { deleteDoc, PLANS, restoreDoc, TRASH_DAYS } from '../../storage/docs'
import { addShare, participants, removeShare } from '../../storage/shares'
import { listPlansAndTrash } from '../../storage/store'
import type { Plan } from '../../domain/types'
import { answer, finding } from '../answer'
import { badArgument, invalidOperation, notFound } from '../findings'
import type { Entry } from '../names'
import { MANAGE_ACTIONS, TEMPLATES } from '../registries'
import { toToolResult, type ToolResult } from '../result'
import type { Finding, Next } from '../types'
import type { Args } from './index'
import { isSite, siteCreate, slugOf } from './site'
import { SITES, type DocKind } from '../../storage/docs'

const fail = (findings: Finding[]) => toToolResult(answer({ ok: false, findings }), { summary: findings[0].message })
export type ManageEntry = Entry & { needsId: boolean }

export async function manage(args: Args): Promise<ToolResult> {
  if (typeof args.action !== 'string' || !args.action) return fail([badArgument('action', 'krävs')])
  if (args.id !== undefined && typeof args.id !== 'string') return fail([badArgument('id', 'ska vara en sträng')])
  if (args.args !== undefined && (typeof args.args !== 'object' || args.args === null || Array.isArray(args.args))) return fail([badArgument('args', 'ska vara ett objekt')])
  const r = MANAGE_ACTIONS.resolve(args.action)
  if ('finding' in r) return fail([r.finding])
  const a = (args.args ?? {}) as Record<string, unknown>
  const name = r.entry.name
  const id = typeof args.id === 'string' ? args.id : ''
  // A site plan: its id starts with "site:"; only sharing, the trash and listing apply to it.
  const site = isSite(id)
  if (site && !['share', 'delete', 'restore'].includes(name)) return fail([finding({ code: 'wrong-kind', level: 'error', message: `Åtgärden ${name} gäller bara planritningar, inte tomten ${id}.`, refs: [id] })])
  const kind: DocKind = site ? SITES : PLANS
  const docId = site ? slugOf(id) : id
  const noun = site ? 'tomten' : 'planen'
  if ((r.entry as ManageEntry).needsId && !id) return fail([badArgument('id', `krävs för åtgärden ${name}`)])
  try {
    if (name === 'create_site') return siteCreate(a.designation)
    if (name === 'create') {
      let template: 'empty' | 'demo' = 'empty'
      if (a.template !== undefined) {
        const t = TEMPLATES.resolve(String(a.template))
        if ('finding' in t) return fail([t.finding])
        template = t.entry.name as 'empty' | 'demo'
      }
      const res = await createPlan({ name: String(a.name ?? 'Planritning'), template, author: 'claude' })
      if ('errors' in res) return fail(res.errors!.map(invalidOperation))
      const next: Next[] = [{ tool: 'source', arguments: { id: res.plan.id, action: 'upload_link' }, why: 'Har användaren en ritning eller bild att rita av? Ge länken.' }]
      return toToolResult(answer({ ok: true, id: res.plan.id, revision: res.revision.n, next, data: { links: links(res.plan, res.revision.n) } }), { summary: `Skapad: ${res.plan.id}, revision ${res.revision.n}\n${links(res.plan, res.revision.n)}` })
    }
    if (name === 'import') {
      const res = await importPlan(a.plan as Partial<Plan> | undefined, String(a.name ?? ''), typeof a.copy_sources_from === 'string' ? a.copy_sources_from : undefined)
      if ('errors' in res) return fail(res.errors.map(invalidOperation))
      return toToolResult(answer({ ok: true, id: res.plan.id, revision: res.revision.n, data: { copied_sources: res.copied } }), { summary: `Importerad: ${res.plan.id}, revision ${res.revision.n}${res.copied !== null ? ` (${res.copied} källritningar kopierade)` : ''}\n${links(res.plan, res.revision.n)}` })
    }
    if (name === 'rename') {
      if (typeof a.name !== 'string' || !a.name.trim()) return fail([badArgument('args.name', 'krävs')])
      const res = await renamePlan(id, a.name)
      if (!res) return fail([notFound(id)])
      if (res.status !== 200) return fail(res.errors.map(invalidOperation))
      return toToolResult(answer({ ok: true, id, revision: res.revision.n }), { summary: `Bytte namn till "${a.name}", revision ${res.revision.n}.` })
    }
    if (name === 'tags') {
      if (!Array.isArray(a.tags)) return fail([badArgument('args.tags', 'ska vara en lista')])
      const res = await tagPlan(id, a.tags)
      if (res.status === 404) return fail([notFound(id)])
      if (res.status !== 200) return fail(res.errors.map(invalidOperation))
      return toToolResult(answer({ ok: true, id, data: { tags: res.tags } }), { summary: res.tags.length ? `Taggar: ${res.tags.join(', ')}` : 'Taggarna är borttagna.' })
    }
    if (name === 'share') {
      const who = typeof a.with === 'string' ? a.with : ''
      const out = typeof a.remove === 'string' ? a.remove : ''
      const err = who ? await addShare(kind, docId, who) : out ? await removeShare(kind, docId, out) : null
      if (err) return fail([invalidOperation(err)])
      if (out && out === currentUser()?.id) return toToolResult(answer({ ok: true, id }), { summary: `Du har tagit bort ${noun} ${id} för dig. De andra har kvar den.` })
      const p = await participants(kind, docId)
      if (!p) return fail([notFound(id)])
      const people = [p.ownerRemoved ? `${p.owner} (har tagit bort den för sig)` : `${p.owner} (ägare)`, ...p.members]
      return toToolResult(answer({ ok: true, id, data: { owner: p.owner, members: p.members, me: p.me } }), { summary: `${noun[0].toUpperCase()}${noun.slice(1)} delas av: ${people.join(', ')}. Du är ${p.me}.` })
    }
    if (name === 'delete') {
      const how = await deleteDoc(kind, docId)
      if (!how) return fail([notFound(id)])
      return toToolResult(answer({ ok: true, id, data: { result: how } }), { summary: how === 'trashed' ? `${noun[0].toUpperCase()}${noun.slice(1)} ${id} ligger nu i papperskorgen och kan återställas i ${TRASH_DAYS} dagar.` : `Du har tagit bort ${noun} ${id} för dig. De andra har kvar den.` })
    }
    if (name === 'restore') {
      if (!(await restoreDoc(kind, docId))) return fail([notFound(id)])
      return toToolResult(answer({ ok: true, id }), { summary: `${noun[0].toUpperCase()}${noun.slice(1)} ${id} är tillbaka i listan.` })
    }
    if (name === 'trash') {
      const trash = (await listPlansAndTrash({ shared: false })).trash
      return toToolResult(answer({ ok: true, data: { items: trash.map((t) => ({ id: t.id, name: t.name, days_left: t.daysLeft, ...(t.sharedWith?.length ? { shared_with: t.sharedWith } : {}) })) } }), { summary: trash.length ? trash.map((t) => `${t.id}: ${t.name} – ${t.daysLeft} dagar kvar${t.sharedWith?.length ? `, delas med ${t.sharedWith.join(', ')}` : ''}`).join('\n') : 'Papperskorgen är tom.' })
    }
    return fail([finding({ code: 'not-implemented', level: 'error', message: `Åtgärden ${name} är inte klar än.` })])
  } catch (e) {
    return fail([invalidOperation((e as Error).message)])
  }
}
