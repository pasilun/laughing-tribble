import { ConflictError, userBackend } from '../plan/store'
import { SLUG, type SiteDoc, type SiteRevision } from './doc'

// Site documents beside the plans, in the same private per-person storage: every save is an immutable
// revision (sites/<slug>/rev-0001.json …) and a small head pointer; a save against an old revision is refused.

type Head = { revision: number; designation: string; updatedAt: string }
export type StoredSite = { doc: SiteDoc; meta: SiteRevision }

const revKey = (slug: string, n: number) => `sites/${slug}/rev-${String(n).padStart(4, '0')}.json`
const headKey = (slug: string) => `sites/${slug}/head.json`

export function assertSlug(slug: string) {
  if (!SLUG.test(slug)) throw new Error(`ogiltigt tomt-id "${slug}"`)
}

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

export async function listSites(): Promise<Array<{ slug: string } & Head>> {
  const b = userBackend()
  const heads = (await b.keys('sites')).filter((k) => k.endsWith('/head.json'))
  const out = await Promise.all(heads.map(async (k) => ({ slug: k.split('/')[1], h: await readJson<Head>(k) })))
  return out.flatMap((x) => (x.h ? [{ slug: x.slug, ...x.h }] : [])).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
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

export async function deleteSite(slug: string): Promise<boolean> {
  assertSlug(slug)
  const b = userBackend()
  const keys = await b.keys(`sites/${slug}`)
  if (!keys.length) return false
  await b.remove(keys)
  return true
}
