import { secured } from '@/lib/plan/auth/access'
import { loadPlan, renamePlan, replacePlan, tagPlan } from '@/lib/plan/service'
import { PLANS } from '@/lib/plan/storage/docs'
import type { Plan } from '@/lib/plan/domain/types'
import { deleteRoute } from '../doc-routes'
import { author, fail, readJson, revParam, type Ctx } from '../http'

export const runtime = 'nodejs'

export const GET = secured(async (req: Request, { params }: Ctx): Promise<Response> => {
  const { id } = await params
  try {
    const rev = await loadPlan(id, revParam(req))
    if (!rev) return Response.json({ errors: ['planen finns inte'] }, { status: 404 })
    return Response.json({ plan: rev.plan, revision: rev.meta })
  } catch (e) {
    return fail(e)
  }
})

// Saves the whole plan as a new revision (used by the editor).
export const PUT = secured(async (req: Request, { params }: Ctx): Promise<Response> => {
  const { id } = await params
  const body = await readJson(req)
  const plan = body?.plan as Plan | undefined
  if (!body || !plan || typeof body.baseRevision !== 'number') return Response.json({ errors: ['plan och baseRevision krävs'] }, { status: 400 })
  try {
    const res = await replacePlan(id, plan, body.baseRevision, author(body.author), String(body.message ?? 'Ändrad i editorn'))
    return 'errors' in res ? Response.json({ errors: res.errors }, { status: res.status }) : Response.json({ revision: res.revision })
  } catch (e) {
    return fail(e)
  }
})

// Sets the plan's tags ({ tags: ["Gnejsen", "förslag B"] }, not a revision) or renames it ({ name: "Källare" }, a revision).
export const PATCH = secured(async (req: Request, { params }: Ctx): Promise<Response> => {
  const { id } = await params
  const body = await readJson(req)
  try {
    if (typeof body?.name === 'string') {
      const res = await renamePlan(id, body.name)
      if (!res) return Response.json({ errors: ['planen finns inte'] }, { status: 404 })
      return res.status === 200 ? Response.json({ name: res.plan.name, revision: res.revision }) : Response.json({ errors: res.errors }, { status: res.status })
    }
    const res = await tagPlan(id, body?.tags)
    return 'errors' in res ? Response.json({ errors: res.errors }, { status: res.status }) : Response.json({ tags: res.tags })
  } catch (e) {
    return fail(e)
  }
})

// Deletes the plan for the one who asks: the owner's plan goes to the trash (restorable for 30 days),
// a member only leaves it. ?permanent=1 removes a plan that is in the trash for good (not while others have it).
export const DELETE = deleteRoute(PLANS)
