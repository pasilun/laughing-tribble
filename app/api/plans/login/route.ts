import { ACCESS_COOKIE, accessMode, cookieFor, userFromKey } from '@/lib/plan/access'
import { allowed, fail, ok } from './limit'

export const runtime = 'nodejs'

// Form post from /plans/login. Sets an httpOnly cookie that identifies the
// person; it holds a hash derived from their stored key hash, never the key.
export async function POST(req: Request) {
  const ip = (req.headers.get('x-forwarded-for') ?? 'lokal').split(',')[0].trim()
  const form = await req.formData()
  const next = String(form.get('next') ?? '/plans')
  const safeNext = next.startsWith('/plans') ? next : '/plans'
  const back = (code: string, status = 303) => Response.redirect(new URL(`/plans/login?fel=${code}&next=${encodeURIComponent(safeNext)}`, req.url), status)
  if (accessMode() === 'open') return Response.redirect(new URL(safeNext, req.url), 303)
  if (!allowed(ip)) return back('for-manga')
  const user = userFromKey(String(form.get('password') ?? '').trim())
  if (!user) {
    fail(ip)
    return back('1')
  }
  ok(ip)
  const headers = new Headers({ Location: new URL(safeNext, req.url).toString() })
  const secure = new URL(req.url).protocol === 'https:' ? '; Secure' : ''
  headers.append('Set-Cookie', `${ACCESS_COOKIE}=${cookieFor(user)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 90}${secure}`)
  return new Response(null, { status: 303, headers })
}
