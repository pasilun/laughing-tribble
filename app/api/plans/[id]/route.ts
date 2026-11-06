import { secured } from '@/lib/plan/access'
import { validatePlan } from '@/lib/plan/ops'
import { loadPlan } from '@/lib/plan/service'
import { deletePlan, purgePlan, saveRevision, setTags } from '@/lib/plan/store'
import type { Plan } from '@/lib/plan/types'
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
  if (plan.id !== id) return Response.json({ errors: ['plan.id stämmer inte'] }, { status: 400 })
  const errors = validatePlan(plan)
  if (errors.length) return Response.json({ errors }, { status: 422 })
  try {
    const revision = await saveRevision(plan, { author: author(body.author), message: String(body.message ?? 'Ändrad i editorn') }, body.baseRevision)
    return Response.json({ revision })
  } catch (e) {
    return fail(e)
  }
})

// Sets the plan's tags: { tags: ["Gnejsen", "förslag B"] }. Not a revision.
export const PATCH = secured(async (req: Request, { params }: Ctx): Promise<Response> => {
  const { id } = await params
  const body = await readJson(req)
  if (!body || !Array.isArray(body.tags)) return Response.json({ errors: ['tags (lista) krävs'] }, { status: 400 })
  try {
    const tags = await setTags(id, body.tags)
    if (!tags) return Response.json({ errors: ['planen finns inte'] }, { status: 404 })
    return Response.json({ tags })
  } catch (e) {
    return fail(e)
  }
})

// Deletes the plan for the one who asks: the owner's plan goes to the trash (restorable for 30 days),
// a member only leaves it. ?permanent=1 removes a plan that is in the trash for good (not while others have it).
export const DELETE = secured(async (req: Request, { params }: Ctx): Promise<Response> => {
  const { id } = await params
  try {
    if (new URL(req.url).searchParams.get('permanent')) {
      const r = await purgePlan(id)
      if (r === 'notfound') return Response.json({ errors: ['planen finns inte'] }, { status: 404 })
      if (r === 'nottrashed') return Response.json({ errors: ['Flytta planen till papperskorgen först.'] }, { status: 400 })
      if (r === 'shared') return Response.json({ errors: ['Planen delas fortfarande med någon och kan inte raderas för alltid.'] }, { status: 400 })
      return Response.json({ purged: id })
    }
    const how = await deletePlan(id)
    if (!how) return Response.json({ errors: ['planen finns inte'] }, { status: 404 })
    return Response.json({ deleted: id, how })
  } catch (e) {
    return fail(e)
  }
})
