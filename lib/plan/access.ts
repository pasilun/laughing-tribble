import { createHash, timingSafeEqual } from 'crypto'

// Plans hold private material (addresses, apartment numbers, drawings of
// someone's home). When PLAN_PASSWORD is set, every plan page and API call
// needs it: as a login cookie (browser), a bearer token, or ?key= (MCP
// connector URL). Without PLAN_PASSWORD (local development) access is open.

export const ACCESS_COOKIE = 'plan_access'

function password(): string | undefined {
  return process.env.PLAN_PASSWORD || undefined
}

export function accessEnabled(): boolean {
  return !!password()
}

// The cookie holds a hash, never the password itself.
export function cookieValue(pw = password() ?? ''): string {
  return createHash('sha256').update(`plan-access:${pw}`).digest('hex')
}

function same(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

export function checkPassword(candidate: string): boolean {
  const pw = password()
  return !pw || same(candidate, pw)
}

export function hasAccessCookie(cookie: string | undefined): boolean {
  if (!accessEnabled()) return true
  return !!cookie && same(cookie, cookieValue())
}

export function hasAccess(req: Request): boolean {
  const pw = password()
  if (!pw) return true
  const auth = req.headers.get('authorization') ?? ''
  if (auth.startsWith('Bearer ') && same(auth.slice(7), pw)) return true
  const key = new URL(req.url).searchParams.get('key')
  if (key && same(key, pw)) return true
  const cookie = (req.headers.get('cookie') ?? '')
    .split(';')
    .map((c) => c.trim().split('='))
    .find(([k]) => k === ACCESS_COOKIE)?.[1]
  return hasAccessCookie(cookie)
}

export function denied(): Response {
  return Response.json({ errors: ['inloggning krävs'] }, { status: 401 })
}
