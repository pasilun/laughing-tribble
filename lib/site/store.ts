import { assertDocId, deleteDoc, headKey as docHeadKey, listDocs, purgeDoc, restoreDoc, SITES, userBackend, type Listed, type Trashed } from '../plan/docs'
import { ConflictError } from '../plan/storage'
import type { SiteDoc, SiteRevision } from './doc'

// Site documents beside the plans, in the same private per-person storage and with the same sharing and trash
// (lib/plan/docs.ts): every save is an immutable revision (sites/<slug>/rev-0001.json …) and a small head
// pointer; a save against an old revision is refused.

type Head = { revision: number; designation: string; updatedAt: string }
export type StoredSite = { doc: SiteDoc; meta: SiteRevision }

const revKey = (slug: string, n: number) => `sites/${slug}/rev-${String(n).padStart(4, '0')}.json`
const headKey = (slug: string) => docHeadKey(SITES, slug)
const assertSlug = (slug: string) => assertDocId(SITES, slug)

async function readJson<T>(key: string): Promise<T | null> {
  const buf = await userBackend().read(key)
  return buf ? (JSON.parse(buf.toString('utf8')) as T) : null
}

export async function getSite(slug: string, n?: number): Promise<StoredSite | null> {
  assertSlug(slug)
  const rev = n ?? (await readJson<Head>(headKey(slug)))?.revision
  if (!rev) return null
  return readJson<StoredSite>(revKey(slug, rev))
}

export type SiteListing = { slug: string } & Listed<Head>

// The person's sites (their own and those shared with them) and their trash.
export async function listSitesAndTrash(opts: { shared?: boolean } = {}): Promise<{ sites: SiteListing[]; trash: Trashed[] }> {
  const { docs, trash } = await listDocs<Head>(SITES, (h) => h.designation, opts)
  return { sites: docs.map((d) => ({ ...d, slug: d.id })), trash }
}

export async function listSites(): Promise<SiteListing[]> {
  return (await listSitesAndTrash()).sites
}

export async function saveSite(doc: SiteDoc, meta: { author: SiteRevision['author']; message: string }, baseRevision: number | null): Promise<SiteRevision> {
  assertSlug(doc.slug)
  const b = userBackend()
  const head = await readJson<Head>(headKey(doc.slug))
  const current = head?.revision ?? 0
  if (baseRevision !== null && baseRevision !== current) throw new ConflictError(current)
  const rev: SiteRevision = { n: current + 1, author: meta.author, message: meta.message, createdAt: new Date().toISOString() }
  const created = await b.write(revKey(doc.slug, rev.n), JSON.stringify({ doc, meta: rev }), 'application/json', { createOnly: true })
  if (!created) throw new ConflictError(rev.n)
  await b.write(headKey(doc.slug), JSON.stringify({ revision: rev.n, designation: doc.designation, updatedAt: rev.createdAt } satisfies Head), 'application/json')
  return rev
}

// Deleting, restoring and purging are the same for every kind of document: see docs.ts.
export const deleteSite = (slug: string) => deleteDoc(SITES, slug)
export const restoreSite = (slug: string) => restoreDoc(SITES, slug)
export const purgeSite = (slug: string) => purgeDoc(SITES, slug)
