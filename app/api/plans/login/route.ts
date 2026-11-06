import { accessMode, cookieForAny, resolveKey } from '@/lib/plan/auth/access'
import { cookiesForNewLogin } from '@/lib/plan/auth/accounts'
import { allowed, fail, ok } from './limit'

export const runtime = 'nodejs'

// Form post from /plans/login. Sets an httpOnly cookie that identifies the
// person; it holds a hash derived from their stored key hash, never the key.
export async function POST(req: Request) {
  const ip = (req.headers.get('x-forwarded-for') ?? 'lokal').split(',')[0].trim()
  const form = await req.formData()
  const next = String(form.get('next') ?? '/plans')
  const safeNext = next.startsWith('/plans') || next.startsWith('/oauth/authorize?') ? next : '/plans'
  const back = (code: string, status = 303) => Response.redirect(new URL(`/plans/login?fel=${code}&next=${encodeURIComponent(safeNext)}`, req.url), status)
  if (accessMode() === 'open') return Response.redirect(new URL(safeNext, req.url), 303)
  if (!allowed(ip)) return back('for-manga')
  const user = await resolveKey(String(form.get('password') ?? '').trim())
  if (!user) {
    fail(ip)
    return back('1')
  }
  ok(ip)
  const headers = new Headers({ Location: new URL(safeNext, req.url).toString() })
  const secure = new URL(req.url).protocol === 'https:' ? '; Secure' : ''
  // Someone already signed in here stays signed in: they move to the account list (the menu switches between them).
  for (const c of await cookiesForNewLogin(req, await cookieForAny(user), !!secure)) headers.append('Set-Cookie', c)
  return new Response(null, { status: 303, headers })
}
