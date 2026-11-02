import { ACCESS_COOKIE, cookieForAny, takenByEnv } from '@/lib/plan/access'
import { redeemInvite } from '@/lib/plan/people'
import { allowed, fail, ok } from '../login/limit'
import { readJson } from '../http'

export const runtime = 'nodejs'

// Turns an invitation link into a person: { token, id }. Public (the link is the credential).
// Returns the new key once (for signing in elsewhere; it is not stored) and the plain connector address:
// Claude signs the person in with OAuth, so the address carries no key. The person is signed in here at once.
export async function POST(req: Request) {
  const ip = (req.headers.get('x-forwarded-for') ?? 'lokal').split(',')[0].trim()
  if (!allowed(ip)) return Response.json({ errors: ['För många försök – vänta tio minuter.'] }, { status: 429 })
  const body = await readJson(req)
  const token = String(body?.token ?? '')
  const res = await redeemInvite(token, String(body?.id ?? ''), takenByEnv)
  if (!res.ok) {
    // A name that is taken is not a guessed token: only count the bad invitations.
    if (/Inbjudan/.test(res.error)) fail(ip)
    return Response.json({ errors: [res.error] }, { status: 400 })
  }
  ok(ip)
  const headers = new Headers({ 'content-type': 'application/json' })
  const secure = new URL(req.url).protocol === 'https:' ? '; Secure' : ''
  headers.append('Set-Cookie', `${ACCESS_COOKIE}=${await cookieForAny({ id: res.person.id })}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 90}${secure}`)
  return new Response(JSON.stringify({ id: res.person.id, key: res.key, connector: `${new URL(req.url).origin}/api/mcp` }), { status: 201, headers })
}
