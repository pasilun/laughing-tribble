import { createHash, randomBytes } from 'crypto'
import { systemBackend } from './store'
import { USER_ID } from './user'

// People who joined through an invitation link. They live in the store, not in
// PLAN_USERS, so adding or removing one needs no redeploy.
//
//   system/keys/<hash of the key>.json      → { id }          looked up on every sign-in
//   system/users/<id>.json                  → { id, keyHash, createdAt, label }
//   system/invites/<hash of the token>.json → { label, createdBy, createdAt, expiresAt, forUser? }
//                                              (forUser: a link that gives that person a new key, for someone who lost theirs)
//   system/claims/<hash of the token>.json  → the first person to redeem an invitation
//
// Only hashes of keys and tokens are stored. Each fact is its own file, so two
// people joining at once never overwrite each other.

export type Person = { id: string; keyHash: string; createdAt: string; label?: string; sessionVersion?: number }
export type Invite = { id: string; label: string; createdBy: string; createdAt: string; expiresAt: string; forUser?: string }

const sha = (s: string) => createHash('sha256').update(s).digest('hex')
export const keyHashOf = (key: string) => createHash('sha256').update(`plan-key:${key}`).digest('hex')
const tokenHashOf = (token: string) => sha(`plan-invite:${token}`)

const RESERVED = new Set(['legacy', 'local', 'system'])
const MAX_DAYS = 30

export const store = () => systemBackend()
const kKey = (h: string) => `system/keys/${h}.json`
const kUser = (id: string) => `system/users/${id}.json`
const kInvite = (h: string) => `system/invites/${h}.json`
const kClaim = (h: string) => `system/claims/${h}.json`

export async function readJson<T>(key: string): Promise<T | null> {
  const buf = await store().read(key)
  if (!buf) return null
  try {
    return JSON.parse(buf.toString('utf8')) as T
  } catch {
    return null
  }
}
export const writeJson = (key: string, v: unknown, createOnly = false) => store().write(key, JSON.stringify(v), 'application/json', { createOnly })

// A sign-in reads the store, so the answer is remembered for a short while per
// instance. Removing a person therefore takes up to this long to bite.
const TTL_MS = 30_000
const cache = new Map<string, { v: unknown; until: number }>()
export async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key)
  if (hit && hit.until > Date.now()) return hit.v as T
  const v = await load()
  if (cache.size > 500) cache.clear()
  cache.set(key, { v, until: Date.now() + TTL_MS })
  return v
}
export function forgetPeople() {
  cache.clear()
}

export async function personByKey(key: string): Promise<Person | null> {
  const h = keyHashOf(key)
  const hit = await cached(`k:${h}`, async () => {
    const k = await readJson<{ id: string }>(kKey(h))
    return k ? readJson<Person>(kUser(k.id)) : null
  })
  return hit && hit.keyHash === h ? hit : null
}

export async function personById(id: string): Promise<Person | null> {
  if (!USER_ID.test(id)) return null
  return cached(`u:${id}`, () => readJson<Person>(kUser(id)))
}

export async function listPeople(): Promise<Person[]> {
  const keys = (await store().keys('system/users')).filter((k) => k.endsWith('.json'))
  const all = await Promise.all(keys.map((k) => readJson<Person>(k)))
  return all.filter((p): p is Person => !!p).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

export async function removePerson(id: string): Promise<boolean> {
  if (!USER_ID.test(id)) return false
  const p = await readJson<Person>(kUser(id))
  if (!p) return false
  await store().remove([kKey(p.keyHash), kUser(id)])
  forgetPeople()
  return true
}

// ── invitations ────────────────────────────────────────────────────────────

export async function createInvite(label: string, createdBy: string, days = 7, forUser?: string): Promise<{ token: string; invite: Invite }> {
  const token = `inv_${randomBytes(32).toString('base64url')}`
  const d = Math.min(MAX_DAYS, Math.max(1, Math.round(days) || 7))
  const now = new Date()
  const invite: Invite = {
    id: tokenHashOf(token),
    label: label.trim().slice(0, 60) || 'Inbjuden',
    createdBy,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + d * 86_400_000).toISOString(),
    ...(forUser ? { forUser } : {}),
  }
  const { id, ...body } = invite
  await writeJson(kInvite(id), body)
  return { token, invite }
}

async function liveInvite(token: string): Promise<Invite | null> {
  if (!/^inv_[A-Za-z0-9_-]{20,80}$/.test(token)) return null
  const id = tokenHashOf(token)
  const body = await readJson<Omit<Invite, 'id'>>(kInvite(id))
  if (!body || new Date(body.expiresAt).getTime() < Date.now()) return null
  return { id, ...body }
}

export async function inviteInfo(token: string): Promise<{ label: string; expiresAt: string; forUser?: string } | null> {
  const i = await liveInvite(token)
  return i ? { label: i.label, expiresAt: i.expiresAt, ...(i.forUser ? { forUser: i.forUser } : {}) } : null
}

export async function listInvites(): Promise<Invite[]> {
  const keys = (await store().keys('system/invites')).filter((k) => k.endsWith('.json'))
  const all = await Promise.all(
    keys.map(async (k) => {
      const id = k.split('/').pop()!.replace(/\.json$/, '')
      const body = await readJson<Omit<Invite, 'id'>>(k)
      return body ? { id, ...body } : null
    }),
  )
  return all.filter((i): i is Invite => !!i && new Date(i.expiresAt).getTime() >= Date.now()).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export async function revokeInvite(id: string): Promise<boolean> {
  if (!/^[0-9a-f]{64}$/.test(id)) return false
  if (!(await store().read(kInvite(id)))) return false
  await store().remove([kInvite(id)])
  return true
}

export type Redeemed = { ok: true; person: Person; key: string } | { ok: false; error: string }

// Turns an invitation into a person with a new key. The key is returned once
// and never stored. An invitation works once: the first to claim it wins.
export async function redeemInvite(token: string, wanted: string, takenByEnv: (id: string) => boolean): Promise<Redeemed> {
  const link = await liveInvite(token)
  if (link?.forUser) return rekey(link, link.forUser)
  const id = wanted.trim().toLowerCase()
  if (!USER_ID.test(id)) return { ok: false, error: 'Välj ett användarnamn med små bokstäver, siffror och bindestreck (högst 30 tecken).' }
  if (RESERVED.has(id) || takenByEnv(id)) return { ok: false, error: 'Det namnet är upptaget – välj ett annat.' }
  const invite = await liveInvite(token)
  if (!invite) return { ok: false, error: 'Inbjudan finns inte längre eller har gått ut. Be om en ny.' }

  const claimed = await writeJson(kClaim(invite.id), { at: new Date().toISOString() }, true)
  if (!claimed) return { ok: false, error: 'Inbjudan är redan använd.' }

  const key = `pk_${randomBytes(32).toString('base64url')}`
  const person: Person = { id, keyHash: keyHashOf(key), createdAt: new Date().toISOString(), label: invite.label }
  // The name is taken by creating its file; a name someone else holds sends the person back to choose again.
  if (!(await writeJson(kUser(id), person, true))) {
    await store().remove([kClaim(invite.id)])
    return { ok: false, error: 'Det namnet är upptaget – välj ett annat.' }
  }
  await writeJson(kKey(person.keyHash), { id })
  await store().remove([kInvite(invite.id)])
  forgetPeople()
  return { ok: true, person, key }
}

// A new key for a person who lost theirs: the link was made by an admin for that person. The old
// key stops working at once (up to the 30 s sign-in memory), the plans stay with the person.
// Every signed-in session ends too: the cookie is derived from the session version, which the
// bump changes (lib/plan/access.ts cookieValue).
async function rekey(invite: Invite, id: string): Promise<Redeemed> {
  const old = await readJson<Person>(kUser(id))
  if (!old) return { ok: false, error: 'Personen finns inte längre. Be om en ny inbjudan.' }
  const claimed = await writeJson(kClaim(invite.id), { at: new Date().toISOString() }, true)
  if (!claimed) return { ok: false, error: 'Inbjudan är redan använd.' }
  const key = `pk_${randomBytes(32).toString('base64url')}`
  const person: Person = { ...old, keyHash: keyHashOf(key), sessionVersion: (old.sessionVersion ?? 0) + 1 }
  await writeJson(kKey(person.keyHash), { id })
  await writeJson(kUser(id), person)
  await store().remove([kKey(old.keyHash), kInvite(invite.id)])
  forgetPeople()
  return { ok: true, person, key }
}

// Ends every signed-in session for a person without touching their key: the cookie holds the
// session version, so bumping it invalidates the cookies on all devices. Takes effect at once
// in this instance and within the 30 s sign-in memory in others. The key keeps working, and so
// do Claude connectors (OAuth tokens are checked against the person, not the cookie).
export async function bumpSessionVersion(id: string): Promise<number | null> {
  if (!USER_ID.test(id)) return null
  const p = await readJson<Person>(kUser(id))
  if (!p) return null
  const sessionVersion = (p.sessionVersion ?? 0) + 1
  await writeJson(kUser(id), { ...p, sessionVersion })
  forgetPeople()
  return sessionVersion
}
