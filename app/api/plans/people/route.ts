import { isAdmin, secured, takenByEnv } from '@/lib/plan/access'
import { createInvite, listInvites, listPeople, removePerson, revokeInvite } from '@/lib/plan/people'
import { currentUser } from '@/lib/plan/user'
import { readJson } from '../http'

export const runtime = 'nodejs'

// People and invitations. Only for the people named in PLAN_ADMINS.
function gate(): Response | null {
  const me = currentUser()
  if (me && isAdmin(me)) return null
  return Response.json({ errors: [`Bara administratörer får bjuda in. Lägg till ditt användarnamn (${me?.id ?? '?'}) i PLAN_ADMINS i Vercel och deploya om.`], me: me?.id }, { status: 403 })
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
  const { token, invite } = await createInvite(String(body?.label ?? ''), currentUser()!.id, Number(body?.days ?? 7))
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
