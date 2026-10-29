import { ACCESS_COOKIE, checkPassword, cookieValue } from '@/lib/plan/access'

export const runtime = 'nodejs'

// Form post from /plans/login. Sets an httpOnly cookie with a hash of the password.
export async function POST(req: Request) {
  const form = await req.formData()
  const next = String(form.get('next') ?? '/plans')
  const safeNext = next.startsWith('/plans') ? next : '/plans'
  if (!checkPassword(String(form.get('password') ?? ''))) {
    return Response.redirect(new URL(`/plans/login?fel=1&next=${encodeURIComponent(safeNext)}`, req.url), 303)
  }
  const res = Response.redirect(new URL(safeNext, req.url), 303)
  const headers = new Headers(res.headers)
  const secure = new URL(req.url).protocol === 'https:' ? '; Secure' : ''
  headers.append('Set-Cookie', `${ACCESS_COOKIE}=${cookieValue()}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 90}${secure}`)
  return new Response(null, { status: 303, headers })
}
