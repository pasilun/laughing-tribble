import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { ACCESS_COOKIE, hasAccessCookie } from '@/lib/plan/access'

export async function requireAccess(next: string) {
  const jar = await cookies()
  if (!hasAccessCookie(jar.get(ACCESS_COOKIE)?.value)) redirect(`/plans/login?next=${encodeURIComponent(next)}`)
}
