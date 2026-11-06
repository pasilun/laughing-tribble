import { inviteInfo } from '@/lib/plan/auth/people'
import { InviteForm } from '@/components/plan-editor/InviteForm'

export const metadata = { title: 'Inbjudan' }
export const dynamic = 'force-dynamic'

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const info = await inviteInfo(token)
  // The person's name when the invitation says who it is for; a new-key link has its
  // own wording ("Ny nyckel till …") and keeps the plain heading.
  const name = info && !info.forUser && info.label !== 'Inbjuden' ? info.label : undefined
  return (
    <main className="mx-auto w-full max-w-md px-4 py-16 sm:py-24">
      <h1 className="text-2xl font-bold tracking-tight">{name ? `Hej ${name}!` : 'Planstudio'}</h1>
      <p className="mt-1 text-sm text-zinc-600">{info?.forUser ? `Ny nyckel till ${info.forUser}.` : 'Rita planritningar. Och låt Claude göra det åt dig.'}</p>
      {info ? (
        <InviteForm token={token} label={info.label} expiresAt={info.expiresAt} forUser={info.forUser} />
      ) : (
        <div className="mt-6 space-y-3 text-sm" data-testid="invite-invalid">
          <p className="text-red-700">Inbjudan finns inte längre, har redan använts eller har gått ut. Be om en ny länk av den som bjöd in dig.</p>
          <p className="text-zinc-600">
            Har du redan ett konto? <a href="/plans/login" className="text-blue-700 underline">Logga in här</a>.
          </p>
        </div>
      )}
    </main>
  )
}
