import { ACCESS_COOKIE, secured, takenByEnv } from '@/lib/plan/access'
import { bumpSessionVersion } from '@/lib/plan/people'
import { currentUser } from '@/lib/plan/user'

export const runtime = 'nodejs'

// POST /api/plans/sessions/revoke – "Logga ut alla enheter". Ends every signed-in
// browser session for the caller by bumping their session version (the cookie holds
// it; see lib/plan/access.ts cookieValue). The key keeps working, and so do Claude
// connectors: OAuth tokens are checked against the person, not the cookie. The
// calling device is signed out too, so the answer clears the cookie.
//
// People in PLAN_USERS have no person record; their "logout everywhere" is rotating
// the key there, which ends their sessions because the cookie is derived from the
// key hash. Single-password mode has no per-person sessions at all.
export const POST = secured(async (req: Request): Promise<Response> => {
  const me = currentUser()!
  if (me.legacy) return Response.json({ errors: ['utloggning för alla enheter gäller bara med personliga nycklar'] }, { status: 400 })
  if (takenByEnv(me.id)) return Response.json({ errors: ['Du står i PLAN_USERS; byt nyckeln där för att logga ut alla enheter.'] }, { status: 400 })
  const sv = await bumpSessionVersion(me.id)
  if (!sv) return Response.json({ errors: ['personen finns inte'] }, { status: 404 })
  const secure = new URL(req.url).protocol === 'https:' ? '; Secure' : ''
  return Response.json({ revoked: sv }, { headers: { 'Set-Cookie': `${ACCESS_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}` } })
})
