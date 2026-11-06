import { currentUser } from './user'
import { assertDocId, headKey as docHeadKey, listDocs, PLANS, userBackend, type Listed, type Trashed } from './docs'
import { ConflictError, PublicError, type Backend } from './storage'
import type { Plan, Revision } from './types'

// Append-only revision history per plan. Every save – from the editor or from Claude – writes a new immutable
// revision; nothing is overwritten except the small head pointer. Where the files live is storage.ts, who may see
// them (sharing, the trash, the list) docs.ts; this file is what is particular to a plan.

export type StoredRevision = { plan: Plan; meta: Revision }
// `tags` group plans in the list (a project, a proposal). They are list metadata, not drawing
// content: changing them makes no revision, and saving a revision keeps them.
export type Head = { revision: number; name: string; updatedAt: string; issued: string[]; tags?: string[] }

// Trimmed, no empty or duplicate (any case) tags, at most 10 of at most 30 characters.
function cleanTags(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  const out: string[] = []
  for (const t of input) {
    const s = String(t ?? '').trim().replace(/\s+/g, ' ').slice(0, 30)
    if (s && !out.some((o) => o.toLowerCase() === s.toLowerCase())) out.push(s)
  }
  return out.slice(0, 10)
}

const backend = userBackend
const headKey = (id: string) => docHeadKey(PLANS, id)
const assertId = (id: string) => assertDocId(PLANS, id)
const revKey = (id: string, n: number) => `plans/${id}/rev-${String(n).padStart(4, '0')}.json`

async function readJson<T>(b: Backend, key: string): Promise<T | null> {
  const buf = await b.read(key)
  return buf ? (JSON.parse(buf.toString('utf8')) as T) : null
}

export async function getHead(id: string): Promise<Head | null> {
  assertId(id)
  return readJson<Head>(backend(), headKey(id))
}

export async function getRevision(id: string, n?: number): Promise<StoredRevision | null> {
  assertId(id)
  const b = backend()
  const rev = n ?? (await readJson<Head>(b, headKey(id)))?.revision
  if (!rev) return null
  return readJson<StoredRevision>(b, revKey(id, rev))
}

export async function listRevisions(id: string): Promise<Revision[]> {
  assertId(id)
  const b = backend()
  const keys = (await b.keys(`plans/${id}`)).filter((k) => /rev-\d+\.json$/.test(k)).sort()
  const revs = await Promise.all(keys.map((k) => readJson<StoredRevision>(b, k)))
  return revs.filter((r): r is StoredRevision => !!r).map((r) => r.meta)
}

export type PlanListing = Listed<Head>
export type TrashedPlan = Trashed

// The person's own plans (not those they have deleted while others keep them), the plans shared with them
// and their trash, from one folder listing.
export async function listPlansAndTrash(opts: { shared?: boolean } = {}): Promise<{ plans: PlanListing[]; trash: TrashedPlan[] }> {
  const { docs, trash } = await listDocs<Head>(PLANS, (h) => h.name, opts)
  return { plans: docs, trash }
}

export async function listPlans(): Promise<PlanListing[]> {
  return (await listPlansAndTrash()).plans
}

// Saves a new revision. baseRevision guards against overwriting a change
// made in between (by the editor or by Claude).
export async function saveRevision(
  plan: Plan,
  meta: { author: Revision['author']; message: string; issued?: string },
  baseRevision: number | null,
): Promise<Revision> {
  assertId(plan.id)
  const b = backend()
  const head = await readJson<Head>(b, headKey(plan.id))
  const current = head?.revision ?? 0
  if (baseRevision !== null && baseRevision !== current) throw new ConflictError(current)
  const who = currentUser()
  const rev: Revision = { n: current + 1, author: meta.author, message: meta.message, createdAt: new Date().toISOString() }
  if (who && !who.legacy) rev.by = who.id
  if (meta.issued) rev.issued = meta.issued
  // Two saves can read the same head: only one may create the next revision.
  const created = await b.write(revKey(plan.id, rev.n), JSON.stringify({ plan, meta: rev }), 'application/json', { createOnly: true })
  if (!created) throw new ConflictError(rev.n)
  const next: Head = {
    revision: rev.n,
    name: plan.name,
    updatedAt: rev.createdAt,
    issued: [...(head?.issued ?? []), ...(meta.issued ? [meta.issued] : [])],
    ...(head?.tags?.length ? { tags: head.tags } : {}),
  }
  await b.write(headKey(plan.id), JSON.stringify(next), 'application/json')
  return rev
}

// Sets a plan's tags (replacing them). No revision: tags are not part of the drawing.
export async function setTags(id: string, tags: unknown): Promise<string[] | null> {
  assertId(id)
  const b = backend()
  const head = await readJson<Head>(b, headKey(id))
  if (!head) return null
  const clean = cleanTags(tags)
  const next: Head = { ...head }
  if (clean.length) next.tags = clean
  else delete next.tags
  await b.write(headKey(id), JSON.stringify(next), 'application/json')
  return clean
}

// Deleting, restoring and purging are the same for every kind of document (deleteDoc, restoreDoc and purgeDoc in
// docs.ts, with PLANS), so there is nothing to wrap. The trash of plans:
export const listTrash = async (): Promise<TrashedPlan[]> => (await listPlansAndTrash({ shared: false })).trash

// Scanned drawings used as underlay. Stored next to the plan, not inside
// each revision.
export async function putAsset(id: string, name: string, data: Buffer, contentType: string): Promise<string> {
  assertId(id)
  if (!/^[a-z0-9][a-z0-9._-]{0,80}$/i.test(name)) throw new PublicError('ogiltigt filnamn')
  await backend().write(`plans/${id}/assets/${name}`, data, contentType)
  return `/api/plans/${id}/assets/${encodeURIComponent(name)}`
}

export async function deleteAsset(id: string, name: string): Promise<void> {
  assertId(id)
  if (!/^[a-z0-9][a-z0-9._-]{0,80}$/i.test(name)) return
  await backend().remove([`plans/${id}/assets/${name}`])
}

export async function getAsset(id: string, name: string): Promise<Buffer | null> {
  assertId(id)
  if (!/^[a-z0-9][a-z0-9._-]{0,80}$/i.test(name)) return null
  return backend().read(`plans/${id}/assets/${name}`)
}

// Next revision letter: "" → A → B …
export function nextLetter(issued: string[]): string {
  const last = issued[issued.length - 1]
  if (!last) return 'A'
  return String.fromCharCode(last.charCodeAt(0) + 1)
}
