import { createHash, timingSafeEqual } from 'crypto'
import { personById, personByKey } from './people'
import { runAs, USER_ID, type User } from './user'

// Plans hold private material (addresses, apartment numbers, drawings of
// someone's home), so every plan page and API call needs a personal access
// key. Each person has their own key and their own storage.
//
//   PLAN_USERS   "anna:<sha256>, bo:<sha256>" – person id and the hash of the
//                key (npm run user:add prints the pair; the key itself is
//                never stored).
//   PLAN_PASSWORD  older single-password mode: one shared key, everyone sees
//                the same plans. Used only when PLAN_USERS is not set.
//
//   PLAN_ADMINS  "anna": who may invite people (the page /plans/people).
//
// People who joined by an invitation link are kept in the store (lib/plan/people.ts)
// and checked after PLAN_USERS, so adding someone needs no redeploy.
//
// The key is accepted as a login cookie (browser), a bearer token, or ?key=
// (MCP connector URL). With neither variable set, access is open locally and
// closed on Vercel.

export const ACCESS_COOKIE = 'plan_access'

type Entry = { id: string; hash: string }
export type AccessMode = 'users' | 'legacy' | 'open' | 'locked'

export function hashKey(key: string): string {
  return createHash('sha256').update(`plan-key:${key}`).digest('hex')
}

function parseUsers(raw: string): Entry[] {
  const out: Entry[] = []
  for (const part of raw.split(/[\s,;]+/).filter(Boolean)) {
    const [id, hash] = part.split(':')
    if (id && USER_ID.test(id) && hash && /^[0-9a-f]{64}$/.test(hash) && !out.some((e) => e.id === id)) out.push({ id, hash })
  }
  return out
}

export function accessMode(): AccessMode {
  if (process.env.PLAN_USERS?.trim()) return 'users'
  if (process.env.PLAN_PASSWORD) return 'legacy'
  return process.env.VERCEL ? 'locked' : 'open'
}

function entries(): Entry[] {
  const mode = accessMode()
  if (mode === 'users') return parseUsers(process.env.PLAN_USERS ?? '')
  if (mode === 'legacy') return [{ id: 'legacy', hash: hashKey(process.env.PLAN_PASSWORD ?? '') }]
  return []
}

export function userCount(): number {
  return entries().length
}

function same(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

const userOf = (e: Entry): User => (e.id === 'legacy' ? { id: 'legacy', legacy: true } : { id: e.id })

// The cookie holds an id and a hash derived from the stored key hash, never
// the key. Removing a person from PLAN_USERS ends their sessions.
export function cookieValue(e: Entry): string {
  return `${e.id}.${createHash('sha256').update(`plan-access:${e.hash}`).digest('hex')}`
}

export function userFromKey(key: string): User | null {
  const h = hashKey(key)
  let found: Entry | undefined
  for (const e of entries()) if (same(e.hash, h)) found = e // compares all, no early exit
  return found ? userOf(found) : null
}

export function cookieFor(user: User): string {
  const e = entries().find((x) => x.id === user.id)
  return e ? cookieValue(e) : ''
}

export function userFromCookie(cookie: string | undefined): User | null {
  if (!cookie) return null
  const id = cookie.split('.')[0]
  const e = entries().find((x) => x.id === id)
  return e && same(cookie, cookieValue(e)) ? userOf(e) : null
}

export function authenticate(req: Request): User | null {
  const mode = accessMode()
  if (mode === 'open') return { id: 'local', legacy: true }
  if (mode === 'locked') return null
  const auth = req.headers.get('authorization') ?? ''
  if (auth.startsWith('Bearer ')) {
    const u = userFromKey(auth.slice(7))
    if (u) return u
  }
  const key = new URL(req.url).searchParams.get('key')
  if (key) {
    const u = userFromKey(key)
    if (u) return u
  }
  const cookie = (req.headers.get('cookie') ?? '')
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${ACCESS_COOKIE}=`))
    ?.slice(ACCESS_COOKIE.length + 1)
  return userFromCookie(cookie)
}

export function hasAccess(req: Request): boolean {
  return !!authenticate(req)
}

// ── PLAN_USERS first, then the people who joined by invitation ─────────────

const cookieOf = (req: Request) =>
  (req.headers.get('cookie') ?? '')
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${ACCESS_COOKIE}=`))
    ?.slice(ACCESS_COOKIE.length + 1)

export function takenByEnv(id: string): boolean {
  return entries().some((e) => e.id === id)
}

export async function resolveKey(key: string): Promise<User | null> {
  const u = userFromKey(key)
  if (u || accessMode() !== 'users') return u
  const p = await personByKey(key)
  return p ? { id: p.id } : null
}

export async function resolveCookie(cookie: string | undefined): Promise<User | null> {
  const u = userFromCookie(cookie)
  if (u || accessMode() !== 'users' || !cookie) return u
  const p = await personById(cookie.split('.')[0])
  return p && !takenByEnv(p.id) && same(cookie, cookieValue({ id: p.id, hash: p.keyHash })) ? { id: p.id } : null
}

// The login cookie for a person who joined by invitation (the key is not needed again).
export async function cookieForAny(user: User): Promise<string> {
  const c = cookieFor(user)
  if (c || accessMode() !== 'users') return c
  const p = await personById(user.id)
  return p ? cookieValue({ id: p.id, hash: p.keyHash }) : ''
}

export async function resolveRequest(req: Request): Promise<User | null> {
  const mode = accessMode()
  if (mode === 'open') return { id: 'local', legacy: true }
  if (mode === 'locked') return null
  const auth = req.headers.get('authorization') ?? ''
  if (auth.startsWith('Bearer ')) {
    const u = await resolveKey(auth.slice(7))
    if (u) return u
  }
  const key = new URL(req.url).searchParams.get('key')
  if (key) {
    const u = await resolveKey(key)
    if (u) return u
  }
  return resolveCookie(cookieOf(req))
}

export function isAdmin(user: User): boolean {
  if (accessMode() === 'open') return true
  return (process.env.PLAN_ADMINS ?? '').split(/[\s,;]+/).includes(user.id)
}

export function denied(): Response {
  const msg = accessMode() === 'locked' ? 'inloggning är inte konfigurerad (PLAN_USERS saknas)' : 'inloggning krävs'
  return Response.json({ errors: [msg] }, { status: accessMode() === 'locked' ? 503 : 401 })
}

// Wraps a route handler: checks the key, then runs it as that person.
export function secured<A extends unknown[]>(fn: (req: Request, ...rest: A) => Promise<Response>) {
  return async (req: Request, ...rest: A): Promise<Response> => {
    const user = await resolveRequest(req)
    if (!user) return denied()
    return runAs(user, () => fn(req, ...rest))
  }
}
