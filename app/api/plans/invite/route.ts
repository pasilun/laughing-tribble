import { cookieForAny, reservedByEnv } from '@/lib/plan/auth/access'
import { cookiesForNewLogin } from '@/lib/plan/auth/accounts'
import { inviteInfo, redeemInvite } from '@/lib/plan/auth/people'
import { allowed, fail, ok } from '../login/limit'
import { readJson } from '../http'

export const runtime = 'nodejs'

// GET ?token=… says whether an invitation is still live: { label, expiresAt, forUser? }.
// No claim, no cookie: the login page uses it to check a pasted link before sending the
// person on to /plans/invite/<token>. The token is the credential, so this tells a
// holder nothing the invite page would not.
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get('token') ?? ''
  const info = await inviteInfo(token)
  if (!info) return Response.json({ errors: ['Inbjudan finns inte längre, har redan använts eller har gått ut.'] }, { status: 404 })
  return Response.json(info)
}

// Turns an invitation link into a person: { token, id }. Public (the link is the credential).
// Returns the new key once (for signing in elsewhere; it is not stored) and the plain connector address:
// Claude signs the person in with OAuth, so the address carries no key. The person is signed in here at once.
export async function POST(req: Request) {
  const ip = (req.headers.get('x-forwarded-for') ?? 'lokal').split(',')[0].trim()
  if (!allowed(ip)) return Response.json({ errors: ['För många försök – vänta tio minuter.'] }, { status: 429 })
  const body = await readJson(req)
  const token = String(body?.token ?? '')
  const res = await redeemInvite(token, String(body?.id ?? ''), reservedByEnv)
  if (!res.ok) {
    // A name that is taken is not a guessed token: only count the bad invitations.
    if (/Inbjudan/.test(res.error)) fail(ip)
    return Response.json({ errors: [res.error] }, { status: 400 })
  }
  ok(ip)
  const headers = new Headers({ 'content-type': 'application/json' })
  const secure = new URL(req.url).protocol === 'https:' ? '; Secure' : ''
  // The person who opened the link was perhaps signed in as someone else (an administrator trying it out): that account is kept for switching.
  for (const c of await cookiesForNewLogin(req, await cookieForAny({ id: res.person.id }), !!secure)) headers.append('Set-Cookie', c)
  return new Response(JSON.stringify({ id: res.person.id, key: res.key, connector: `${new URL(req.url).origin}/api/mcp` }), { status: 201, headers })
}
