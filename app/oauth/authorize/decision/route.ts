import { ACCESS_COOKIE, accessMode, resolveCookie } from '@/lib/plan/auth/access'
import { checkAuthRequest, issueCode } from '@/lib/plan/auth/oauth'

export const runtime = 'nodejs'

const back = (redirectUri: string, params: Record<string, string>) => {
  const u = new URL(redirectUri)
  for (const [k, v] of Object.entries(params)) if (v) u.searchParams.set(k, v)
  // 303: the browser follows with a GET to Claude, whatever it was before.
  return new Response(null, { status: 303, headers: { Location: u.toString(), 'Cache-Control': 'no-store' } })
}

// The answer from the consent screen. Only the signed-in person's own browser can post it.
export async function POST(req: Request) {
  const origin = req.headers.get('origin')
  if (origin && new URL(origin).host !== new URL(req.url).host) return new Response('Fel avsändare', { status: 403 })
  if (accessMode() !== 'users') return new Response('Inte tillgängligt', { status: 403 })
  const form = await req.formData()
  const check = await checkAuthRequest(form)
  if (!check.ok && check.fatal) return new Response(check.message, { status: 400 })
  if (!check.ok) return back(check.redirectUri, { error: check.error, error_description: check.message, state: check.state })

  const cookie = (req.headers.get('cookie') ?? '')
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${ACCESS_COOKIE}=`))
    ?.slice(ACCESS_COOKIE.length + 1)
  const user = await resolveCookie(cookie)
  if (!user) return new Response('Inloggning krävs', { status: 401 })

  const { redirectUri, state } = check.req
  if (form.get('decision') !== 'approve') return back(redirectUri, { error: 'access_denied', error_description: 'Personen avböjde', state })
  return back(redirectUri, { code: await issueCode(user.id, check.req), state })
}
