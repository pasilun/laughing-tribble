import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { ACCESS_COOKIE, accessMode, userFromCookie } from '@/lib/plan/access'

export async function requireAccess(next: string) {
  if (accessMode() === 'open') return
  const jar = await cookies()
  if (!userFromCookie(jar.get(ACCESS_COOKIE)?.value)) redirect(`/plans/login?next=${encodeURIComponent(next)}`)
}
