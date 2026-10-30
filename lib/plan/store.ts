import { del, get, list, put } from '@vercel/blob'
import { promises as fs } from 'fs'
import path from 'path'
import { accessMode } from './access'
import type { Plan, Revision } from './types'
import { currentUser, scopeOf } from './user'

// Append-only revision history per plan. Every save — from the editor or
// from Claude — writes a new immutable revision; nothing is overwritten
// except the small head pointer.
//
// Storage: Vercel Blob (private) when a blob token is configured, otherwise
// the local filesystem under .data (development). Each signed-in person has
// their own prefix (u/<id>/…); see backend().

export type StoredRevision = { plan: Plan; meta: Revision }
export type Head = { revision: number; name: string; updatedAt: string; issued: string[] }

export class ConflictError extends Error {
  constructor(public head: number) {
    super(`Planen har ändrats (senaste revision ${head}) – läs in den igen innan du sparar`)
  }
}

export interface Backend {
  read(key: string): Promise<Buffer | null>
  remove(keys: string[]): Promise<void>
  // createOnly: fails (returns false) instead of replacing an existing file.
  write(key: string, data: Buffer | string, contentType: string, opts?: { createOnly?: boolean }): Promise<boolean>
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
  async write(key: string, data: Buffer | string, _contentType: string, opts?: { createOnly?: boolean }) {
    const p = this.file(key)
    await fs.mkdir(path.dirname(p), { recursive: true })
    // Written beside the target, then linked or renamed into place: a read never
    // sees half a file, and a link fails if the file already exists.
    const tmp = `${p}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`
    await fs.writeFile(tmp, data)
    try {
      if (opts?.createOnly) await fs.link(tmp, p)
      else await fs.rename(tmp, p)
      return true
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EEXIST') return false
      throw e
    } finally {
      await fs.unlink(tmp).catch(() => undefined)
    }
  }
  async remove(keys: string[]) {
    for (const k of keys) {
      const p = this.file(k)
      await fs.unlink(p).catch(() => undefined)
      // Leave no empty folders behind (rmdir refuses while one has files).
      for (let d = path.dirname(p); d.length > this.root.length; d = path.dirname(d)) if (!(await fs.rmdir(d).then(() => true, () => false))) break
    }
  }
  async keys(prefix: string) {
    const dir = this.file(prefix)
    try {
      const entries = await fs.readdir(dir, { recursive: true, withFileTypes: true })
      return entries.filter((e) => e.isFile() && !e.name.endsWith('.tmp')).map((e) => path.relative(this.root, path.join(e.parentPath, e.name)))
    } catch {
      return []
    }
  }
}

// A project can carry tokens from several Blob stores (one per connection, each
// with its own prefix). The app only works with a private store, so it tries the
// tokens in turn, skips a public store, and keeps the first one that works.
const TOKEN_VARS = ['PLANS_READ_WRITE_TOKEN', 'BLOB_READ_WRITE_TOKEN', 'public_READ_WRITE_TOKEN']
const tokens = () => TOKEN_VARS.map((k) => process.env[k]).filter((t): t is string => !!t)
let working: string | undefined
const isPublicStore = (e: unknown) => /private access on a public store/i.test((e as Error)?.message ?? '')

async function withToken<T>(fn: (token: string) => Promise<T>): Promise<T> {
  const all = tokens()
  const order = working && all.includes(working) ? [working, ...all.filter((t) => t !== working)] : all
  let last: unknown
  for (const t of order) {
    try {
      const out = await fn(t)
      working = t
      return out
    } catch (e) {
      if (!isPublicStore(e)) throw e
      last = e
    }
  }
  throw last ?? new Error('ingen Blob-nyckel')
}

// Reads go to the origin, not the CDN: a "not found" seen while a plan was being
// created, or the old head.json after an edit, would otherwise be served for a while.
class BlobBackend implements Backend {
  async read(key: string) {
    const res = await withToken((token) => get(key, { access: 'private', token, useCache: false }))
    if (!res || res.statusCode !== 200) return null
    return Buffer.from(await new Response(res.stream).arrayBuffer())
  }
  async write(key: string, data: Buffer | string, contentType: string, opts?: { createOnly?: boolean }) {
    try {
      await withToken((token) => put(key, data, { access: 'private', token, allowOverwrite: !opts?.createOnly, contentType, addRandomSuffix: false }))
      return true
    } catch (e) {
      if (opts?.createOnly && (await this.read(key))) return false
      throw e
    }
  }
  async remove(keys: string[]) {
    for (let i = 0; i < keys.length; i += 100) await withToken((token) => del(keys.slice(i, i + 100), { token }))
  }
  async keys(prefix: string) {
    const out: string[] = []
    let cursor: string | undefined
    do {
      const page = await withToken((token) => list({ prefix: `${prefix}/`, token, cursor }))
      out.push(...page.blobs.map((b) => b.pathname))
      cursor = page.hasMore ? page.cursor : undefined
    } while (cursor)
    return out
  }
}

// Names only, never values: which store tokens the deploy has and which one is used.
function tokenNames(): { found: string[]; using: string | null } {
  const found = Object.keys(process.env).filter((k) => /READ_WRITE_TOKEN$/.test(k)).sort()
  const using = TOKEN_VARS.find((k) => process.env[k] && process.env[k] === working) ?? null
  return { found, using }
}

// The whole store, every person's data. Only for migration and the health probe.
export function systemBackend(): Backend {
  if (tokens().length && process.env.PLAN_STORE !== 'fs') return new BlobBackend()
  return new FsBackend(path.resolve(process.env.PLAN_DATA_DIR ?? '.data'))
}

export function storageKind(): 'blob' | 'fs' {
  return tokens().length && process.env.PLAN_STORE !== 'fs' ? 'blob' : 'fs'
}

// One person's view of the store: every key is under their prefix, and what
// comes back has it removed.
class Scoped implements Backend {
  constructor(
    private inner: Backend,
    private prefix: string,
  ) {}
  read(key: string) {
    return this.inner.read(this.prefix + key)
  }
  write(key: string, data: Buffer | string, contentType: string, opts?: { createOnly?: boolean }) {
    return this.inner.write(this.prefix + key, data, contentType, opts)
  }
  remove(keys: string[]) {
    return this.inner.remove(keys.map((k) => this.prefix + k))
  }
  async keys(prefix: string) {
    return (await this.inner.keys(this.prefix + prefix)).map((k) => k.slice(this.prefix.length))
  }
}

// The storage of the person making the current request. With sign-in
// configured a request without a person is a bug, never "everyone's data".
function backend(): Backend {
  const user = currentUser()
  if (!user && accessMode() !== 'open') throw new Error('ingen användare för anropet – lagring nekas')
  return new Scoped(systemBackend(), user ? scopeOf(user) : '')
}

// Writes, reads back and removes a small file outside any person's prefix.
export async function storageProbe(): Promise<{ kind: 'blob' | 'fs'; ok: boolean; ms: number; tokens?: { found: string[]; using: string | null }; error?: string }> {
  const t = Date.now()
  const b = systemBackend()
  const key = `_health/${Math.random().toString(36).slice(2)}.txt`
  const report = () => (storageKind() === 'blob' ? { tokens: tokenNames() } : {})
  try {
    await b.write(key, 'ok', 'text/plain')
    const back = await b.read(key)
    await b.remove([key])
    return { kind: storageKind(), ok: back?.toString() === 'ok', ms: Date.now() - t, ...report() }
  } catch (e) {
    return { kind: storageKind(), ok: false, ms: Date.now() - t, ...report(), error: (e as Error).message }
  }
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
  // Two saves can read the same head: only one may create the next revision.
  const created = await b.write(revKey(plan.id, rev.n), JSON.stringify({ plan, meta: rev }), 'application/json', { createOnly: true })
  if (!created) throw new ConflictError(rev.n)
  const next: Head = {
    revision: rev.n,
    name: plan.name,
    updatedAt: rev.createdAt,
    issued: [...(head?.issued ?? []), ...(meta.issued ? [meta.issued] : [])],
  }
  await b.write(headKey(plan.id), JSON.stringify(next), 'application/json')
  return rev
}

// Deletes a plan with all its revisions and assets. Returns false if it doesn't exist.
export async function deletePlan(id: string): Promise<boolean> {
  assertId(id)
  const b = backend()
  const keys = await b.keys(`plans/${id}`)
  if (!keys.length) return false
  await b.remove(keys)
  return true
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
