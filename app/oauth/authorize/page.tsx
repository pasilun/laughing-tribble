import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { ACCESS_COOKIE, accessMode, resolveCookie } from '@/lib/plan/auth/access'
import { checkAuthRequest } from '@/lib/plan/auth/oauth'

export const metadata = { title: 'Godkänn anslutning' }
export const dynamic = 'force-dynamic'

// The consent screen: Claude asks to act as the signed-in person.
export default async function AuthorizePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams
  const query = new URLSearchParams(Object.entries(sp).filter((e): e is [string, string] => typeof e[1] === 'string'))
  const shell = (children: React.ReactNode) => (
    <main className="mx-auto w-full max-w-md px-4 py-16">
      <h1 className="text-xl font-bold">Planritningar</h1>
      {children}
    </main>
  )
  if (accessMode() !== 'users') return shell(<p className="mt-6 text-sm text-red-700">Anslutning med inloggning kräver att personliga nycklar används (PLAN_USERS).</p>)

  const check = await checkAuthRequest(query)
  if (!check.ok && check.fatal)
    return shell(
      <p className="mt-6 text-sm text-red-700" data-testid="oauth-error">
        {check.message}
      </p>,
    )

  const jar = await cookies()
  const user = await resolveCookie(jar.get(ACCESS_COOKIE)?.value)
  if (!user) redirect(`/plans/login?next=${encodeURIComponent(`/oauth/authorize?${query.toString()}`)}`)

  if (!check.ok)
    return shell(
      <p className="mt-6 text-sm text-red-700" data-testid="oauth-error">
        {check.message}
      </p>,
    )

  const { client, redirectUri } = check.req
  const host = new URL(redirectUri).host
  const fields = ['client_id', 'redirect_uri', 'state', 'code_challenge', 'code_challenge_method', 'response_type', 'resource', 'scope']
  return shell(
    <form method="post" action="/oauth/authorize/decision" className="mt-6 space-y-4 text-sm" data-testid="oauth-consent">
      {fields.map((f) => (sp[f] ? <input key={f} type="hidden" name={f} value={sp[f]} /> : null))}
      <p>
        <strong>{client.name}</strong> vill ansluta till dina planritningar som <strong data-testid="oauth-user">{user!.id}</strong>.
      </p>
      <p className="text-zinc-700">Det ger tillgång att läsa, ändra och radera alla dina planer och tomter. Du kan ta bort kopplingen i Claude när som helst.</p>
      <p className="text-xs text-zinc-600">
        Svaret skickas till <span className="font-mono">{host}</span>.
      </p>
      <div className="flex gap-2">
        <button name="decision" value="approve" data-testid="oauth-approve" className="rounded bg-blue-600 px-4 py-1.5 text-white">
          Godkänn
        </button>
        <button name="decision" value="deny" data-testid="oauth-deny" className="rounded border px-4 py-1.5">
          Avbryt
        </button>
      </div>
    </form>,
  )
}
