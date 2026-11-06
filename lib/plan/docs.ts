import { accessMode } from './access'
import { SLUG } from '../site/doc'
import { PublicError, Scoped, systemBackend, type Backend } from './storage'
import { currentUser, scopeOf, type User } from './user'

// Documents of any kind (plans, site plans) in a person's storage: who has access, sharing, the trash and the
// list. Everything here is the same for every kind; a kind says only where its files live (DocKind). A new
// kind of document gets sharing, the trash and the list by adding a DocKind and nothing else.
//
// A document's data stays where it was made: u/<owner>/<dir>/<id>/…. Sharing it with another person adds two
// small files:
//   u/<owner>/<dir>/<id>/shares.json     → { members: [ids], trashedAt?, ownerRemoved? }
//   u/<member>/<pointerDir>/<id>.json    → { owner, addedAt, addedBy }  (the member's pointer)
// Every read and write of <dir>/<id>/… is routed to the owner's folder for a member, so both work on the same
// revisions (and the same conflict check). "Delete" only removes the document for the person who deletes: a
// member leaves, the owner's goes to the trash; the data goes when the last person is gone.

export type DocKind = {
  dir: 'plans' | 'sites'
  pointerDir: string // where a member's pointers live (plans: shared/, sites: shared-sites/)
  indexFile: string // the member's index of those pointers
  id: RegExp
  noun: string // "planen" – for the messages
  one: string // "plan"
}

export const PLANS: DocKind = { dir: 'plans', pointerDir: 'shared', indexFile: 'shared.json', id: /^[a-z0-9][a-z0-9-]{0,80}$/, noun: 'planen', one: 'plan' }
export const SITES: DocKind = { dir: 'sites', pointerDir: 'shared-sites', indexFile: 'shared-sites.json', id: SLUG, noun: 'tomten', one: 'tomt' }
const KINDS = [PLANS, SITES]

export function assertDocId(kind: DocKind, id: string) {
  if (!kind.id.test(id)) throw new PublicError(`ogiltigt ${kind.one}-id "${id}"`)
}

export type Shares = { members: string[]; ownerRemoved?: boolean; trashedAt?: string }
// In the trash for the owner: hidden from them, kept for TRASH_DAYS, then removed (only while nobody else has it).
export const TRASH_DAYS = 30
export const isTrashed = (sh: Shares | null | undefined) => !!(sh && (sh.trashedAt || sh.ownerRemoved))
const DAY_MS = 86_400_000
const trashedAtMs = (sh: Shares) => (sh.trashedAt ? new Date(sh.trashedAt).getTime() : 0)
const expired = (sh: Shares) => isTrashed(sh) && !sh.members.length && Date.now() - trashedAtMs(sh) > TRASH_DAYS * DAY_MS
type SharePointer = { owner: string; addedAt: string; addedBy: string }
export type Access = { scope: string; owner: string; role: 'owner' | 'member' | 'none' }

export const headKey = (kind: DocKind, id: string) => `${kind.dir}/${id}/head.json`
export const sharesKey = (kind: DocKind, id: string) => `${kind.dir}/${id}/shares.json`
export const pointerKey = (kind: DocKind, id: string) => `${kind.pointerDir}/${id}.json`

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

export const readShares = (ownerScope: string, kind: DocKind, id: string) => readJsonFrom<Shares>(scopedBackend(ownerScope), sharesKey(kind, id))

// Which folder holds this document for this person, and in what role.
export async function accessFor(user: User, kind: DocKind, id: string): Promise<Access> {
  // Local development has one shared folder and no sharing.
  if (user.legacy) return isTrashed(await readShares('', kind, id)) ? NONE : { scope: '', owner: user.id, role: 'owner' }
  const ck = `${user.id}:${kind.dir}:${id}`
  const hit = accessCache.get(ck)
  if (hit && hit.until > Date.now()) return hit.v
  const own = scopeOf(user)
  const mine = scopedBackend(own)
  let v: Access
  const ptr = await readJsonFrom<SharePointer>(mine, pointerKey(kind, id))
  if (ptr) {
    const ownerScope = `u/${ptr.owner}/`
    const sh = await readShares(ownerScope, kind, id)
    v = sh?.members.includes(user.id) ? { scope: ownerScope, owner: ptr.owner, role: 'member' } : NONE
  } else {
    const sh = await readShares(own, kind, id)
    v = isTrashed(sh) ? NONE : { scope: own, owner: user.id, role: 'owner' }
  }
  if (accessCache.size > 500) accessCache.clear()
  accessCache.set(ck, { v, until: Date.now() + ACCESS_TTL_MS })
  return v
}

const DOC_KEY = new RegExp(`^(${KINDS.map((k) => k.dir).join('|')})/([^/]+)(?:/|$)`)

// The person's own storage, except that documents shared with them are read and written where they live.
class Routed implements Backend {
  constructor(private user: User | undefined) {}
  private async where(key: string): Promise<string | null> {
    const own = this.user ? scopeOf(this.user) : ''
    const m = DOC_KEY.exec(key)
    if (!m || !this.user) return own
    const kind = KINDS.find((k) => k.dir === m[1])!
    const a = await accessFor(this.user, kind, m[2])
    return a.role === 'none' ? null : a.scope
  }
  async read(key: string) {
    const scope = await this.where(key)
    return scope === null ? null : new Scoped(systemBackend(), scope).read(key)
  }
  async write(key: string, data: Buffer | string, contentType: string, opts?: { createOnly?: boolean }) {
    const scope = await this.where(key)
    if (scope === null) throw new PublicError(`${KINDS.find((k) => k.dir === DOC_KEY.exec(key)?.[1])?.noun ?? 'dokumentet'} finns inte`, 404)
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

function requireUser(): User | undefined {
  const user = currentUser()
  if (!user && accessMode() !== 'open') throw new Error('ingen användare för anropet – lagring nekas')
  return user
}

// The storage of the person making the current request, with shared documents routed to where they live. With
// sign-in configured a request without a person is a bug, never "everyone's data".
export function userBackend(): Backend {
  return new Routed(requireUser())
}

// The person's own folder only (no routing): the lists, the trash, the sharing bookkeeping and the backup.
export function ownBackend(): Backend {
  const user = requireUser()
  return new Scoped(systemBackend(), user ? scopeOf(user) : '')
}

async function readJson<T>(b: Backend, key: string): Promise<T | null> {
  const buf = await b.read(key)
  return buf ? (JSON.parse(buf.toString('utf8')) as T) : null
}

// ── The list ───────────────────────────────────────────────────────────────

export type Listed<H> = { id: string } & H & { owner?: string; sharedWith?: string[] }
export type Trashed = { id: string; name: string; deletedAt: string; daysLeft: number; sharedWith?: string[] }

// Pointers to the documents shared with a person are kept as <pointerDir>/<id>.json, and an index of their ids,
// so the list does not have to list the folder (a list is a billed "advanced operation" on Vercel Blob, 2 000 a
// month on Hobby). The index is rebuilt from the pointers when it is missing or a day old, and kept up to date
// when a document is shared or left.
type SharedIndex = { ids: string[]; checkedAt: string }

async function sharedIds(b: Backend, kind: DocKind): Promise<string[]> {
  const idx = await readJson<SharedIndex>(b, kind.indexFile)
  if (idx && Date.now() - new Date(idx.checkedAt).getTime() < DAY_MS) return idx.ids
  const ids = (await b.keys(kind.pointerDir))
    .filter((k) => k.endsWith('.json'))
    .map((k) => k.split('/').pop()!.replace(/\.json$/, ''))
    .filter((id) => kind.id.test(id))
  await b.write(kind.indexFile, JSON.stringify({ ids, checkedAt: new Date().toISOString() } satisfies SharedIndex), 'application/json')
  return ids
}

// Keeps the index in step with a pointer that was written or removed (a missing index is built by the next list).
export async function noteShared(scope: string, kind: DocKind, id: string, on: boolean): Promise<void> {
  const b = scopedBackend(scope)
  const idx = await readJson<SharedIndex>(b, kind.indexFile)
  if (!idx) return
  const ids = new Set(idx.ids)
  if (on) ids.add(id)
  else ids.delete(id)
  await b.write(kind.indexFile, JSON.stringify({ ...idx, ids: [...ids] } satisfies SharedIndex), 'application/json')
}

async function deleteAll(b: Backend, kind: DocKind, id: string): Promise<boolean> {
  const keys = await b.keys(`${kind.dir}/${id}`)
  if (!keys.length) return false
  await b.remove(keys)
  return true
}

// The person's own documents (not those they have deleted while others keep them), the ones shared with them
// and their trash, from one folder listing. `owner` is set on shared-in documents, `sharedWith` on the ones the
// person owns and shares. `title` is what the trash shows for a document.
export async function listDocs<H extends { updatedAt: string }>(
  kind: DocKind,
  title: (h: H) => string,
  opts: { shared?: boolean } = {},
): Promise<{ docs: Listed<H>[]; trash: Trashed[] }> {
  const b = ownBackend()
  const user = currentUser()
  const keys = await b.keys(kind.dir)
  const heads = keys.filter((k) => k.endsWith('/head.json'))
  const shareFiles = new Set(keys.filter((k) => k.endsWith('/shares.json')))
  const docs: Listed<H>[] = []
  const trash: Trashed[] = []
  await Promise.all(
    heads.map(async (k) => {
      const id = k.split('/')[1]
      const h = await readJson<H>(b, k)
      if (!h) return
      const sk = sharesKey(kind, id)
      const sh = shareFiles.has(sk) ? await readJson<Shares>(b, sk) : null
      if (sh && isTrashed(sh)) {
        if (expired(sh)) return void (await deleteAll(b, kind, id))
        const at = trashedAtMs(sh)
        trash.push({
          id,
          name: title(h),
          deletedAt: at ? new Date(at).toISOString() : h.updatedAt,
          daysLeft: Math.max(0, Math.ceil((at + TRASH_DAYS * DAY_MS - Date.now()) / DAY_MS)),
          ...(sh.members.length ? { sharedWith: sh.members } : {}),
        })
        return
      }
      docs.push({ id, ...h, ...(sh?.members.length ? { sharedWith: sh.members } : {}) })
    }),
  )
  if (opts.shared !== false && user && !user.legacy) {
    await Promise.all(
      (await sharedIds(b, kind)).map(async (id) => {
        const ptr = await readJson<SharePointer>(b, pointerKey(kind, id))
        if (!ptr) return
        const ownerScope = `u/${ptr.owner}/`
        const sh = await readShares(ownerScope, kind, id)
        if (!sh?.members.includes(user.id)) return
        const h = await readJsonFrom<H>(scopedBackend(ownerScope), headKey(kind, id))
        if (h) docs.push({ id, ...h, owner: ptr.owner })
      }),
    )
  }
  return { docs: docs.sort((p, q) => q.updatedAt.localeCompare(p.updatedAt)), trash: trash.sort((p, q) => q.deletedAt.localeCompare(p.deletedAt)) }
}

// ── Delete, restore, purge ─────────────────────────────────────────────────

// Deletes a document for the person who asks, never for anyone else. The owner's goes to the trash (hidden for
// them, kept for TRASH_DAYS, restorable); a member leaves, and the others keep working on it.
// Returns 'trashed' or 'left', or false when the person has no such document.
export async function deleteDoc(kind: DocKind, id: string): Promise<'trashed' | 'left' | false> {
  assertDocId(kind, id)
  const user = currentUser()
  const a: Access = user ? await accessFor(user, kind, id) : { scope: '', owner: '', role: 'owner' }
  if (a.role === 'none') return false
  const holder = scopedBackend(a.scope)
  const sh = await readShares(a.scope, kind, id)
  try {
    if (a.role === 'member' && user) {
      await scopedBackend(scopeOf(user)).remove([pointerKey(kind, id)])
      await noteShared(scopeOf(user), kind, id, false)
      if (sh) await holder.write(sharesKey(kind, id), JSON.stringify({ ...sh, members: sh.members.filter((m) => m !== user.id) }), 'application/json')
      return 'left'
    }
    if (!(await holder.keys(`${kind.dir}/${id}`)).length) return false
    await holder.write(sharesKey(kind, id), JSON.stringify({ ...(sh ?? { members: [] }), trashedAt: new Date().toISOString() }), 'application/json')
    return 'trashed'
  } finally {
    forgetAccess()
  }
}

// Takes a document out of the trash. False when it is not there.
export async function restoreDoc(kind: DocKind, id: string): Promise<boolean> {
  assertDocId(kind, id)
  const b = ownBackend()
  const sh = await readJson<Shares>(b, sharesKey(kind, id))
  if (!sh || !isTrashed(sh)) return false
  const next: Shares = { members: sh.members }
  if (next.members.length) await b.write(sharesKey(kind, id), JSON.stringify(next), 'application/json')
  else await b.remove([sharesKey(kind, id)])
  forgetAccess()
  return true
}

// Removes a document in the trash for good. 'shared' while others still have it (it stays in the owner's trash).
export async function purgeDoc(kind: DocKind, id: string): Promise<'ok' | 'notfound' | 'nottrashed' | 'shared'> {
  assertDocId(kind, id)
  const b = ownBackend()
  const sh = await readJson<Shares>(b, sharesKey(kind, id))
  if (!(await b.keys(`${kind.dir}/${id}`)).length) return 'notfound'
  if (!isTrashed(sh)) return 'nottrashed'
  if (sh?.members.length) return 'shared'
  await deleteAll(b, kind, id)
  forgetAccess()
  return 'ok'
}
