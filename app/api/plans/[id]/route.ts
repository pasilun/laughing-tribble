import { denied, hasAccess } from '@/lib/plan/access'
import { validatePlan } from '@/lib/plan/ops'
import { loadPlan } from '@/lib/plan/service'
import { saveRevision } from '@/lib/plan/store'
import type { Plan } from '@/lib/plan/types'
import { author, fail, readJson, revParam, type Ctx } from '../http'

export const runtime = 'nodejs'

export async function GET(req: Request, { params }: Ctx) {
  if (!hasAccess(req)) return denied()
  const { id } = await params
  try {
    const rev = await loadPlan(id, revParam(req))
    if (!rev) return Response.json({ errors: ['planen finns inte'] }, { status: 404 })
    return Response.json({ plan: rev.plan, revision: rev.meta })
  } catch (e) {
    return fail(e)
  }
}

// Saves the whole plan as a new revision (used by the editor).
export async function PUT(req: Request, { params }: Ctx) {
  if (!hasAccess(req)) return denied()
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
}
