import { ACCESS_COOKIE, cookieOf, resolveCookie } from './access'

// Several people signed in on one browser (an administrator who tries an invitation, someone with two
// accounts). `plan_access` is the one in use; `plan_accounts` holds the login cookies of the others, so
// switching needs no key. Both are httpOnly. A cookie in the list is only as good as it was when saved:
// it is checked again whenever the list is read, and a dead one is dropped.

const ACCOUNTS_COOKIE = 'plan_accounts'
const MAX_OTHERS = 4
const MAX_AGE = 60 * 60 * 24 * 90

const idOfCookie = (c: string) => c.split('.')[0]

function readCookie(req: Request, name: string): string | undefined {
  return (req.headers.get('cookie') ?? '')
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${name}=`))
    ?.slice(name.length + 1)
}

// The login cookies of the other signed-in people (not checked).
function savedAccounts(req: Request): string[] {
  return (readCookie(req, ACCOUNTS_COOKIE) ?? '').split('|').filter(Boolean)
}

// The login cookie in use, if it is valid.
export async function activeAccount(req: Request): Promise<{ id: string; cookie: string } | null> {
  const cookie = cookieOf(req)
  const user = await resolveCookie(cookie)
  return user && cookie ? { id: user.id, cookie } : null
}

// Valid cookies, one per person, not the person `skip`, from `extra` first and then the saved list.
async function collect(req: Request, extra: string[], skip: string | undefined): Promise<Array<{ id: string; cookie: string }>> {
  const seen = new Set<string>(skip ? [skip] : [])
  const out: Array<{ id: string; cookie: string }> = []
  for (const cookie of [...extra, ...savedAccounts(req)]) {
    const user = await resolveCookie(cookie)
    if (!user || seen.has(user.id) || idOfCookie(cookie) !== user.id) continue
    seen.add(user.id)
    out.push({ id: user.id, cookie })
  }
  return out.slice(0, MAX_OTHERS)
}

// Who else is signed in here: valid, one cookie per person, not the person in use.
export async function otherAccounts(req: Request): Promise<Array<{ id: string; cookie: string }>> {
  return collect(req, [], (await activeAccount(req))?.id)
}

const attrs = (secure: boolean, maxAge: number) => `; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`

// The Set-Cookie headers that make `active` the person in use and keep `others` for switching.
export function sessionCookies(secure: boolean, active: string | null, others: Array<{ cookie: string }>): string[] {
  const out = [active ? `${ACCESS_COOKIE}=${active}${attrs(secure, MAX_AGE)}` : `${ACCESS_COOKIE}=${attrs(secure, 0)}`]
  out.push(others.length ? `${ACCOUNTS_COOKIE}=${others.map((o) => o.cookie).join('|')}${attrs(secure, MAX_AGE)}` : `${ACCOUNTS_COOKIE}=${attrs(secure, 0)}`)
  return out
}

// Signing in as `cookie` while someone else is signed in: the one in use moves to the list.
export async function cookiesForNewLogin(req: Request, cookie: string, secure: boolean): Promise<string[]> {
  const active = await activeAccount(req)
  return sessionCookies(secure, cookie, await collect(req, active ? [active.cookie] : [], idOfCookie(cookie)))
}
