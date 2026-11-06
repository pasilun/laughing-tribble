import { isAdmin, secured, takenByEnv } from '@/lib/plan/auth/access'
import { createInvite, listInvites, listPeople, personById, removePerson, revokeInvite } from '@/lib/plan/auth/people'
import { currentUser } from '@/lib/plan/auth/user'
import { readJson } from '../http'

export const runtime = 'nodejs'

// People and invitations. Only for the people named in PLAN_ADMINS.
function gate(): Response | null {
  const me = currentUser()
  if (me && isAdmin(me)) return null
  return Response.json({ errors: ['Bara administratörer får bjuda in nya personer. Be den som driver tjänsten om en inbjudan till den du vill ha med.'], me: me?.id }, { status: 403 })
}

export const GET = secured(async (): Promise<Response> => {
  const no = gate()
  if (no) return no
  const [people, invites] = await Promise.all([listPeople(), listInvites()])
  return Response.json({ me: currentUser()?.id, people: people.map((p) => ({ id: p.id, label: p.label, createdAt: p.createdAt })), invites })
})

// Makes an invitation link, shown once: { label, days }.
export const POST = secured(async (req: Request): Promise<Response> => {
  const no = gate()
  if (no) return no
  const body = await readJson(req)
  // resetFor: a link that gives a person who lost their key a new one (they keep their plans).
  const resetFor = typeof body?.resetFor === 'string' ? body.resetFor : ''
  if (resetFor) {
    if (takenByEnv(resetFor)) return Response.json({ errors: ['Den personen står i PLAN_USERS i Vercel; nyckeln byts där.'] }, { status: 400 })
    if (!(await personById(resetFor))) return Response.json({ errors: ['personen finns inte'] }, { status: 404 })
  }
  const { token, invite } = await createInvite(resetFor ? `Ny nyckel till ${resetFor}` : String(body?.label ?? ''), currentUser()!.id, Number(body?.days ?? 7), resetFor || undefined)
  return Response.json({ link: `${new URL(req.url).origin}/plans/invite/${token}`, invite }, { status: 201 })
})

// ?invite=<id> withdraws an invitation, ?user=<id> removes a person who joined by invitation.
export const DELETE = secured(async (req: Request): Promise<Response> => {
  const no = gate()
  if (no) return no
  const url = new URL(req.url)
  const invite = url.searchParams.get('invite')
  const user = url.searchParams.get('user')
  if (invite) return (await revokeInvite(invite)) ? Response.json({ removed: invite }) : Response.json({ errors: ['inbjudan finns inte'] }, { status: 404 })
  if (user) {
    if (takenByEnv(user)) return Response.json({ errors: ['Den personen står i PLAN_USERS i Vercel och tas bort där.'] }, { status: 400 })
    if (user === currentUser()?.id) return Response.json({ errors: ['Du kan inte ta bort dig själv.'] }, { status: 400 })
    return (await removePerson(user)) ? Response.json({ removed: user }) : Response.json({ errors: ['personen finns inte'] }, { status: 404 })
  }
  return Response.json({ errors: ['invite eller user krävs'] }, { status: 400 })
})
