import { secured } from '@/lib/plan/access'
import { addShare, participants, removeShare } from '@/lib/plan/shares'
import { fail, readJson, type Ctx } from '../../http'

export const runtime = 'nodejs'

// Who has the plan: { owner, members, me, role }.
export const GET = secured(async (_req: Request, { params }: Ctx): Promise<Response> => {
  const { id } = await params
  try {
    const p = await participants(id)
    return p ? Response.json(p) : Response.json({ errors: ['planen finns inte'] }, { status: 404 })
  } catch (e) {
    return fail(e)
  }
})

// Shares the plan with another person: { user: "emil" }. They then make revisions of it too.
export const POST = secured(async (req: Request, { params }: Ctx): Promise<Response> => {
  const { id } = await params
  const body = await readJson(req)
  if (typeof body?.user !== 'string' || !body.user.trim()) return Response.json({ errors: ['user krävs'] }, { status: 400 })
  try {
    const err = await addShare(id, body.user)
    if (err) return Response.json({ errors: [err] }, { status: err === 'planen finns inte' ? 404 : 400 })
    return Response.json(await participants(id), { status: 201 })
  } catch (e) {
    return fail(e)
  }
})

// ?user=<id> takes a person out of it (yourself, or as owner anyone).
export const DELETE = secured(async (req: Request, { params }: Ctx): Promise<Response> => {
  const { id } = await params
  const who = new URL(req.url).searchParams.get('user')
  if (!who) return Response.json({ errors: ['user krävs'] }, { status: 400 })
  try {
    const err = await removeShare(id, who)
    if (err) return Response.json({ errors: [err] }, { status: err === 'planen finns inte' ? 404 : 400 })
    return Response.json({ removed: who })
  } catch (e) {
    return fail(e)
  }
})
