import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { ACCESS_COOKIE, accessMode, resolveCookie } from '@/lib/plan/auth/access'
import type { User } from '@/lib/plan/auth/user'

// The signed-in person, or a redirect to the login page.
export async function requireAccess(next: string): Promise<User | null> {
  if (accessMode() === 'open') return null
  const jar = await cookies()
  const user = await resolveCookie(jar.get(ACCESS_COOKIE)?.value)
  if (!user) redirect(`/plans/login?next=${encodeURIComponent(next)}`)
  return user
}
