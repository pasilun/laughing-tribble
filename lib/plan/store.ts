import { del, get, list, put } from '@vercel/blob'
import { promises as fs } from 'fs'
import path from 'path'
import { accessMode } from './access'
import type { Plan, Revision } from './types'
import { currentUser, scopeOf, type User } from './user'

// Append-only revision history per plan. Every save — from the editor or
// from Claude — writes a new immutable revision; nothing is overwritten
// except the small head pointer.
//
// Storage: Vercel Blob (private) when a blob token is configured, otherwise
// the local filesystem under .data (development). Each signed-in person has
// their own prefix (u/<id>/…); see backend().

export type StoredRevision = { plan: Plan; meta: Revision }
// `tags` group plans in the list (a project, a proposal). They are list metadata, not drawing
// content: changing them makes no revision, and saving a revision keeps them.
export type Head = { revision: number; name: string; updatedAt: string; issued: string[]; tags?: string[] }

// Trimmed, no empty or duplicate (any case) tags, at most 10 of at most 30 characters.
export function cleanTags(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  const out: string[] = []
  for (const t of input) {
    const s = String(t ?? '').trim().replace(/\s+/g, ' ').slice(0, 30)
    if (s && !out.some((o) => o.toLowerCase() === s.toLowerCase())) out.push(s)
  }
  return out.slice(0, 10)
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

// ── Sharing ────────────────────────────────────────────────────────────────
// A plan's data stays where it was made: u/<owner>/plans/<id>/…. Sharing it with
// another person adds two small files:
//   u/<owner>/plans/<id>/shares.json  → { members: [ids], ownerRemoved? }
//   u/<member>/shared/<id>.json       → { owner, addedAt, addedBy }  (the member's pointer)
// Every read and write of plans/<id>/… is routed to the owner's folder for a member,
// so both work on the same revisions (and the same conflict check). "Delete" only
// removes the plan for the person who deletes: a member leaves, the owner is marked
// as removed; the data goes when the last person is gone.

export type Shares = { members: string[]; ownerRemoved?: boolean; trashedAt?: string }
// In the trash for the owner: hidden from them, kept for TRASH_DAYS, then removed (only while nobody else has it).
export const TRASH_DAYS = 30
export const isTrashed = (sh: Shares | null | undefined) => !!(sh && (sh.trashedAt || sh.ownerRemoved))
const DAY_MS = 86_400_000
const trashedAtMs = (sh: Shares) => (sh.trashedAt ? new Date(sh.trashedAt).getTime() : 0)
const expired = (sh: Shares) => isTrashed(sh) && !sh.members.length && Date.now() - trashedAtMs(sh) > TRASH_DAYS * DAY_MS
export type SharePointer = { owner: string; addedAt: string; addedBy: string }
export type Access = { scope: string; owner: string; role: 'owner' | 'member' | 'none' }

const NONE: Access = { scope: '', owner: '', role: 'none' }
const ACCESS_TTL_MS = 10_000
const accessCache = new Map<string, { v: Access; until: number }>()

// Sharing changes bite at once in this instance and within the TTL in others.
export function forgetAccess() {
  accessCache.clear()
}

export function scopedBackend(scope: string): Backend {
  return new Scoped(systemBackend(), scope)
}

async function readJsonFrom<T>(b: Backend, key: string): Promise<T | null> {
  const buf = await b.read(key)
  if (!buf) return null
  try {
    return JSON.parse(buf.toString('utf8')) as T
  } catch {
    return null
  }
}

export const sharesKey = (id: string) => `plans/${id}/shares.json`
export const pointerKey = (id: string) => `shared/${id}.json`

export async function readShares(ownerScope: string, id: string): Promise<Shares | null> {
  return readJsonFrom<Shares>(scopedBackend(ownerScope), sharesKey(id))
}

// Which folder holds this plan for this person, and in what role.
export async function accessFor(user: User, id: string): Promise<Access> {
  // Local development has one shared folder and no sharing.
  if (user.legacy) return { scope: '', owner: user.id, role: 'owner' }
  const ck = `${user.id}:${id}`
  const hit = accessCache.get(ck)
  if (hit && hit.until > Date.now()) return hit.v
  const own = scopeOf(user)
  const mine = scopedBackend(own)
  let v: Access
  const ptr = await readJsonFrom<SharePointer>(mine, pointerKey(id))
  if (ptr) {
    const ownerScope = `u/${ptr.owner}/`
    const sh = await readShares(ownerScope, id)
    v = sh?.members.includes(user.id) ? { scope: ownerScope, owner: ptr.owner, role: 'member' } : NONE
  } else {
    const sh = await readShares(own, id)
    v = isTrashed(sh) ? NONE : { scope: own, owner: user.id, role: 'owner' }
  }
  if (accessCache.size > 500) accessCache.clear()
  accessCache.set(ck, { v, until: Date.now() + ACCESS_TTL_MS })
  return v
}

const PLAN_KEY = /^plans\/([^/]+)(?:\/|$)/

// The person's own storage, except that plans shared with them are read and written where they live.
class Routed implements Backend {
  constructor(private user: User | undefined) {}
  private async where(key: string): Promise<string | null> {
    const own = this.user ? scopeOf(this.user) : ''
    const m = PLAN_KEY.exec(key)
    if (!m || !this.user) return own
    const a = await accessFor(this.user, m[1])
    return a.role === 'none' ? null : a.scope
  }
  async read(key: string) {
    const scope = await this.where(key)
    return scope === null ? null : new Scoped(systemBackend(), scope).read(key)
  }
  async write(key: string, data: Buffer | string, contentType: string, opts?: { createOnly?: boolean }) {
    const scope = await this.where(key)
    if (scope === null) throw new Error('planen finns inte')
    return new Scoped(systemBackend(), scope).write(key, data, contentType, opts)
  }
  async remove(keys: string[]) {
    for (const k of keys) {
      const scope = await this.where(k)
      if (scope !== null) await new Scoped(systemBackend(), scope).remove([k])
    }
  }
  async keys(prefix: string) {
    const scope = await this.where(prefix)
    return scope === null ? [] : new Scoped(systemBackend(), scope).keys(prefix)
  }
}

// The storage of the person making the current request. With sign-in
// configured a request without a person is a bug, never "everyone's data".
function backend(): Backend {
  const user = currentUser()
  if (!user && accessMode() !== 'open') throw new Error('ingen användare för anropet – lagring nekas')
  return new Routed(user)
}

// The person's own folder only (no routing): the plan list, the trash, the sharing bookkeeping and the backup.
export function ownBackend(): Backend {
  const user = currentUser()
  if (!user && accessMode() !== 'open') throw new Error('ingen användare för anropet – lagring nekas')
  return new Scoped(systemBackend(), user ? scopeOf(user) : '')
}

// The signed-in person's storage, for other kinds of documents kept beside the plans (site plans).
export function userBackend(): Backend {
  return backend()
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

export type PlanListing = { id: string } & Head & { owner?: string; sharedWith?: string[] }

// Pointers to the plans shared with a person are kept as shared/<id>.json, and an index of their ids as
// shared.json, so the plan list does not have to list the folder (a list is a billed "advanced operation"
// on Vercel Blob, 2 000 a month on Hobby). The index is rebuilt from the pointers when it is missing or a
// day old, and kept up to date when a plan is shared or left.
type SharedIndex = { ids: string[]; checkedAt: string }
const SHARED_INDEX = 'shared.json'

async function sharedIds(b: Backend): Promise<string[]> {
  const idx = await readJson<SharedIndex>(b, SHARED_INDEX)
  if (idx && Date.now() - new Date(idx.checkedAt).getTime() < DAY_MS) return idx.ids
  const ids = (await b.keys('shared'))
    .filter((k) => k.endsWith('.json'))
    .map((k) => k.split('/').pop()!.replace(/\.json$/, ''))
    .filter((id) => ID.test(id))
  await b.write(SHARED_INDEX, JSON.stringify({ ids, checkedAt: new Date().toISOString() } satisfies SharedIndex), 'application/json')
  return ids
}

// Keeps the index in step with a pointer that was written or removed (a missing index is built by the next list).
export async function noteShared(scope: string, id: string, on: boolean): Promise<void> {
  const b = scopedBackend(scope)
  const idx = await readJson<SharedIndex>(b, SHARED_INDEX)
  if (!idx) return
  const ids = new Set(idx.ids)
  if (on) ids.add(id)
  else ids.delete(id)
  await b.write(SHARED_INDEX, JSON.stringify({ ...idx, ids: [...ids] } satisfies SharedIndex), 'application/json')
}

// The person's own plans (not those they have deleted while others keep them), the plans shared with them
// and their trash, from one folder listing. `owner` is set on shared-in plans, `sharedWith` on plans the
// person owns and shares.
export async function listPlansAndTrash(opts: { shared?: boolean } = {}): Promise<{ plans: PlanListing[]; trash: TrashedPlan[] }> {
  const b = ownBackend()
  const user = currentUser()
  const keys = await b.keys('plans')
  const heads = keys.filter((k) => k.endsWith('/head.json'))
  const shareFiles = new Set(keys.filter((k) => k.endsWith('/shares.json')))
  const plans: PlanListing[] = []
  const trash: TrashedPlan[] = []
  await Promise.all(
    heads.map(async (k) => {
      const id = k.split('/')[1]
      const h = await readJson<Head>(b, k)
      if (!h) return
      const sk = sharesKey(id)
      const sh = shareFiles.has(sk) ? await readJson<Shares>(b, sk) : null
      if (sh && isTrashed(sh)) {
        if (expired(sh)) return void (await deleteAll(b, id))
        const at = trashedAtMs(sh)
        trash.push({
          id,
          name: h.name,
          deletedAt: at ? new Date(at).toISOString() : h.updatedAt,
          daysLeft: Math.max(0, Math.ceil((at + TRASH_DAYS * DAY_MS - Date.now()) / DAY_MS)),
          ...(sh.members.length ? { sharedWith: sh.members } : {}),
        })
        return
      }
      plans.push({ id, ...h, ...(sh?.members.length ? { sharedWith: sh.members } : {}) })
    }),
  )
  if (opts.shared !== false && user && !user.legacy) {
    await Promise.all(
      (await sharedIds(b)).map(async (id) => {
        const ptr = await readJson<SharePointer>(b, pointerKey(id))
        if (!ptr) return
        const ownerScope = `u/${ptr.owner}/`
        const sh = await readShares(ownerScope, id)
        if (!sh?.members.includes(user.id)) return
        const h = await readJsonFrom<Head>(scopedBackend(ownerScope), headKey(id))
        if (h) plans.push({ id, ...h, owner: ptr.owner })
      }),
    )
  }
  return { plans: plans.sort((p, q) => q.updatedAt.localeCompare(p.updatedAt)), trash: trash.sort((p, q) => q.deletedAt.localeCompare(p.deletedAt)) }
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

// Deletes a plan for the person who asks, never for anyone else. The owner's plan goes to the trash
// (hidden for them, kept for TRASH_DAYS, restorable); a member leaves, and the others keep working on it.
// Returns 'trashed' or 'left', or false when the person has no such plan.
export async function deletePlan(id: string): Promise<'trashed' | 'left' | false> {
  assertId(id)
  const user = currentUser()
  const a: Access = user ? await accessFor(user, id) : { scope: '', owner: '', role: 'owner' }
  if (a.role === 'none') return false
  const holder = scopedBackend(a.scope)
  const sh = await readShares(a.scope, id)
  try {
    if (a.role === 'member' && user) {
      await scopedBackend(scopeOf(user)).remove([pointerKey(id)])
      await noteShared(scopeOf(user), id, false)
      if (sh) await holder.write(sharesKey(id), JSON.stringify({ ...sh, members: sh.members.filter((m) => m !== user.id) }), 'application/json')
      return 'left'
    }
    if (!(await holder.keys(`plans/${id}`)).length) return false
    await holder.write(sharesKey(id), JSON.stringify({ ...(sh ?? { members: [] }), trashedAt: new Date().toISOString() }), 'application/json')
    return 'trashed'
  } finally {
    forgetAccess()
  }
}

export type TrashedPlan = { id: string; name: string; deletedAt: string; daysLeft: number; sharedWith?: string[] }

// The person's trash. Plans past their time are removed here (and in the plan list) when seen.
export async function listTrash(): Promise<TrashedPlan[]> {
  return (await listPlansAndTrash({ shared: false })).trash
}

// Takes a plan out of the trash. False when it is not there.
export async function restorePlan(id: string): Promise<boolean> {
  assertId(id)
  const b = ownBackend()
  const sh = await readJson<Shares>(b, sharesKey(id))
  if (!sh || !isTrashed(sh)) return false
  const next: Shares = { members: sh.members }
  if (next.members.length) await b.write(sharesKey(id), JSON.stringify(next), 'application/json')
  else await b.remove([sharesKey(id)])
  forgetAccess()
  return true
}

// Removes a plan in the trash for good. 'shared' while others still have it (it goes to the trash for the owner only).
export async function purgePlan(id: string): Promise<'ok' | 'notfound' | 'nottrashed' | 'shared'> {
  assertId(id)
  const b = ownBackend()
  const sh = await readJson<Shares>(b, sharesKey(id))
  if (!(await b.keys(`plans/${id}`)).length) return 'notfound'
  if (!isTrashed(sh)) return 'nottrashed'
  if (sh?.members.length) return 'shared'
  await deleteAll(b, id)
  forgetAccess()
  return 'ok'
}

async function deleteAll(b: Backend, id: string): Promise<boolean> {
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
