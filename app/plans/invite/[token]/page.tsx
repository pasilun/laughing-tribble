import { inviteInfo } from '@/lib/plan/people'
import { InviteForm } from '@/components/plan-editor/InviteForm'

export const metadata = { title: 'Inbjudan' }
export const dynamic = 'force-dynamic'

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const info = await inviteInfo(token)
  return (
    <main className="mx-auto w-full max-w-md px-4 py-16">
      <h1 className="text-xl font-bold">Planritningar</h1>
      {info ? (
        <InviteForm token={token} label={info.label} expiresAt={info.expiresAt} />
      ) : (
        <p className="mt-6 text-sm text-red-700" data-testid="invite-invalid">
          Inbjudan finns inte längre, har redan använts eller har gått ut. Be om en ny länk.
        </p>
      )}
    </main>
  )
}
