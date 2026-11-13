import { del, get, list, put } from '@vercel/blob'
import { promises as fs } from 'fs'
import path from 'path'
import { tursoFromEnv, type TursoBackend } from './turso'

// Where the bytes live: the Backend interface and its three implementations (local files, Vercel Blob, Turso),
// the choice between them, and one person's prefixed view of a backend. Nothing here knows about plans or sites;
// docs.ts builds documents, sharing and the trash on top, and store.ts the plan revisions.
//
// Storage: Turso when PLAN_STORE=turso, Vercel Blob when a blob token is configured, otherwise the local filesystem
// under .data (development). Each signed-in person has their own prefix (u/<id>/…); see docs.ts.

// A message meant for the person using the app, with the HTTP status it goes with. Any other error that reaches an
// API route is logged on the server and answered with a plain "something went wrong" (see app/api/plans/http.ts).
export class PublicError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message)
  }
}

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
    // A folder deleted while it is being walked makes the walk fail halfway; walk again rather than
    // report an empty store (a plan list that suddenly shows nothing).
    for (let attempt = 0; ; attempt++) {
      try {
        const entries = await fs.readdir(dir, { recursive: true, withFileTypes: true })
        return entries.filter((e) => e.isFile() && !e.name.endsWith('.tmp')).map((e) => path.relative(this.root, path.join(e.parentPath, e.name)))
      } catch (e) {
        const gone = (e as NodeJS.ErrnoException).code === 'ENOENT'
        if (!gone || attempt >= 3 || !(await fs.stat(dir).then(() => true, () => false))) return []
      }
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

// "fetch failed" is all Node says when a connection breaks; the reason is in `cause`.
export function describeError(e: unknown): string {
  const err = e as { message?: string; cause?: unknown }
  const cause = err?.cause as { code?: string; message?: string } | undefined
  const why = cause ? [cause.code, cause.message].filter(Boolean).join(': ') : ''
  return `${err?.message ?? String(e)}${why ? ` (${why})` : ''}`
}
export function isNetworkError(e: unknown): boolean {
  // Libraries wrap the fetch error: look through the chain of causes.
  for (let x: unknown = e, i = 0; x && i < 5; x = (x as { cause?: unknown }).cause, i++) {
    const err = x as { message?: string; code?: string }
    if (err.message === 'fetch failed' || /other side closed|socket hang up/i.test(err.message ?? '')) return true
    if (/^(ECONNRESET|ETIMEDOUT|EPIPE|UND_ERR_)/.test(String(err.code ?? ''))) return true
  }
  return false
}

// Reads repeated when the connection breaks (twice, after 200 and 400 ms), for any store. Writes are not repeated:
// a write whose answer was lost may have happened.
export class Retrying implements Backend {
  constructor(private inner: Backend) {}
  private async again<T>(what: string, fn: () => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await fn()
      } catch (e) {
        if (attempt >= 3 || !isNetworkError(e)) throw e
        console.warn(`${what} misslyckades (försök ${attempt}): ${describeError(e)}`)
        await new Promise((r) => setTimeout(r, 200 * attempt))
      }
    }
  }
  read(key: string) {
    return this.again(`Läsning av ${key}`, () => this.inner.read(key))
  }
  write(key: string, data: Buffer | string, contentType: string, opts?: { createOnly?: boolean }) {
    return this.inner.write(key, data, contentType, opts)
  }
  remove(keys: string[]) {
    return this.inner.remove(keys)
  }
  keys(prefix: string) {
    return this.again(`Listning av ${prefix}`, () => this.inner.keys(prefix))
  }
}

// Reads go to the origin, not the CDN: a "not found" seen while a plan was being
// created, or the old head.json after an edit, would otherwise be served for a while.
class BlobBackend implements Backend {
  async read(key: string) {
    // A read can be repeated: a dropped connection to the store is retried, twice, before it is reported.
    for (let attempt = 1; ; attempt++) {
      try {
        const res = await withToken((token) => get(key, { access: 'private', token, useCache: false }))
        if (!res || res.statusCode !== 200) return null
        return Buffer.from(await new Response(res.stream).arrayBuffer())
      } catch (e) {
        if (attempt >= 3 || !isNetworkError(e)) throw e
        console.warn(`Blob-läsning av ${key} misslyckades (försök ${attempt}): ${describeError(e)}`)
        await new Promise((r) => setTimeout(r, 200 * attempt))
      }
    }
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
  // One page of every key in the store (for the migration): a page is one billed listing.
  async page(cursor?: string, limit = 100) {
    const p = await withToken((token) => list({ token, cursor, limit }))
    return { keys: p.blobs.map((b) => b.pathname), cursor: p.hasMore ? p.cursor : undefined }
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
// Where the data lives: PLAN_STORE=turso (a Turso database, TURSO_DATABASE_URL and TURSO_AUTH_TOKEN), PLAN_STORE=fs
// (files under .data), otherwise Vercel Blob when it has a token and files when it has not. Turso is only used
// when it is asked for, so a store can be filled (see migrate-store.ts) while the app keeps using Blob.
export function storageKind(): 'blob' | 'fs' | 'turso' {
  if (process.env.PLAN_STORE === 'turso') return 'turso'
  if (process.env.PLAN_STORE === 'fs') return 'fs'
  return tokens().length ? 'blob' : 'fs'
}

let turso: TursoBackend | undefined
let tursoOverride: TursoBackend | undefined
// The tests hand in a local database; null puts the real client back.
export function useTursoForTests(b: TursoBackend | null) {
  tursoOverride = b ?? undefined
  turso = undefined
}
export function tursoBackend(): TursoBackend {
  return tursoOverride ?? (turso ??= tursoFromEnv())
}
export const tursoConfigured = () => !!(process.env.TURSO_DATABASE_URL && process.env.TURSO_AUTH_TOKEN)
export const blobConfigured = () => tokens().length > 0

// The Blob store itself, whatever PLAN_STORE says (the migration reads from it).
export function blobBackend(): Backend & { page(cursor?: string, limit?: number): Promise<{ keys: string[]; cursor?: string }> } {
  return new BlobBackend()
}

export function systemBackend(): Backend {
  const kind = storageKind()
  if (kind === 'turso') return new Retrying(tursoBackend())
  if (kind === 'blob') return new BlobBackend()
  return new FsBackend(path.resolve(process.env.PLAN_DATA_DIR ?? '.data'))
}

// One person's view of the store: every key is under their prefix, and what
// comes back has it removed.
export class Scoped implements Backend {
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

// Writes, reads back and removes a small file outside any person's prefix.
export async function storageProbe(): Promise<{ kind: 'blob' | 'fs' | 'turso'; ok: boolean; ms: number; tokens?: { found: string[]; using: string | null }; error?: string }> {
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
