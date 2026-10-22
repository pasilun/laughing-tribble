import { get, list, put } from '@vercel/blob'
import { promises as fs } from 'fs'
import path from 'path'
import type { Plan, Revision } from './types'

// Append-only revision history per plan. Every save — from the editor or
// from Claude — writes a new immutable revision; nothing is overwritten
// except the small head pointer.
//
// Storage: Vercel Blob (private) when a blob token is configured, otherwise
// the local filesystem under .data/plans (development).

export type StoredRevision = { plan: Plan; meta: Revision }
export type Head = { revision: number; name: string; updatedAt: string; issued: string[] }

export class ConflictError extends Error {
  constructor(public head: number) {
    super(`Planen har ändrats (senaste revision ${head}) – läs in den igen innan du sparar`)
  }
}

interface Backend {
  read(key: string): Promise<Buffer | null>
  write(key: string, data: Buffer | string, contentType: string): Promise<void>
  keys(prefix: string): Promise<string[]>
}

class FsBackend implements Backend {
  constructor(private root: string) {}
  private file(key: string) {
    const p = path.join(this.root, key)
    if (!p.startsWith(this.root)) throw new Error('ogiltig sökväg')
    return p
  }
  async read(key: string) {
    try {
      return await fs.readFile(this.file(key))
    } catch {
      return null
    }
  }
  async write(key: string, data: Buffer | string) {
    const p = this.file(key)
    await fs.mkdir(path.dirname(p), { recursive: true })
    await fs.writeFile(p, data)
  }
  async keys(prefix: string) {
    const dir = this.file(prefix)
    try {
      const entries = await fs.readdir(dir, { recursive: true, withFileTypes: true })
      return entries.filter((e) => e.isFile()).map((e) => path.relative(this.root, path.join(e.parentPath, e.name)))
    } catch {
      return []
    }
  }
}

class BlobBackend implements Backend {
  constructor(private token: string) {}
  async read(key: string) {
    const res = await get(key, { access: 'private', token: this.token })
    if (!res || res.statusCode !== 200) return null
    return Buffer.from(await new Response(res.stream).arrayBuffer())
  }
  async write(key: string, data: Buffer | string, contentType: string) {
    await put(key, data, { access: 'private', token: this.token, allowOverwrite: true, contentType, addRandomSuffix: false })
  }
  async keys(prefix: string) {
    const out: string[] = []
    let cursor: string | undefined
    do {
      const page = await list({ prefix: `${prefix}/`, token: this.token, cursor })
      out.push(...page.blobs.map((b) => b.pathname))
      cursor = page.hasMore ? page.cursor : undefined
    } while (cursor)
    return out
  }
}

function backend(): Backend {
  const token = process.env.public_READ_WRITE_TOKEN ?? process.env.BLOB_READ_WRITE_TOKEN
  if (token && process.env.PLAN_STORE !== 'fs') return new BlobBackend(token)
  return new FsBackend(path.resolve(process.env.PLAN_DATA_DIR ?? '.data'))
}

const ID = /^[a-z0-9][a-z0-9-]{0,80}$/

export function assertId(id: string) {
  if (!ID.test(id)) throw new Error(`ogiltigt plan-id "${id}"`)
}

const revKey = (id: string, n: number) => `plans/${id}/rev-${String(n).padStart(4, '0')}.json`
const headKey = (id: string) => `plans/${id}/head.json`

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

export async function listPlans(): Promise<Array<{ id: string } & Head>> {
  const b = backend()
  const heads = (await b.keys('plans')).filter((k) => k.endsWith('/head.json'))
  const out = await Promise.all(
    heads.map(async (k) => {
      const h = await readJson<Head>(b, k)
      return h ? { id: k.split('/')[1], ...h } : null
    }),
  )
  return out.filter((x): x is { id: string } & Head => !!x).sort((p, q) => q.updatedAt.localeCompare(p.updatedAt))
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
  const rev: Revision = { n: current + 1, author: meta.author, message: meta.message, createdAt: new Date().toISOString() }
  if (meta.issued) rev.issued = meta.issued
  await b.write(revKey(plan.id, rev.n), JSON.stringify({ plan, meta: rev }), 'application/json')
  const next: Head = {
    revision: rev.n,
    name: plan.name,
    updatedAt: rev.createdAt,
    issued: [...(head?.issued ?? []), ...(meta.issued ? [meta.issued] : [])],
  }
  await b.write(headKey(plan.id), JSON.stringify(next), 'application/json')
  return rev
}

// Scanned drawings used as underlay. Stored next to the plan, not inside
// each revision.
export async function putAsset(id: string, name: string, data: Buffer, contentType: string): Promise<string> {
  assertId(id)
  if (!/^[a-z0-9][a-z0-9._-]{0,80}$/i.test(name)) throw new Error('ogiltigt filnamn')
  await backend().write(`plans/${id}/assets/${name}`, data, contentType)
  return `/api/plans/${id}/assets/${encodeURIComponent(name)}`
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
