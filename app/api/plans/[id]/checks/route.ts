import { secured } from '@/lib/plan/access'
import { checkPlan } from '@/lib/plan/checks'
import { loadPlan } from '@/lib/plan/service'
import { fail, revParam, type Ctx } from '../../http'

export const runtime = 'nodejs'

export const GET = secured(async (req: Request, { params }: Ctx): Promise<Response> => {
  const { id } = await params
  try {
    const rev = await loadPlan(id, revParam(req))
    if (!rev) return Response.json({ errors: ['planen finns inte'] }, { status: 404 })
    return Response.json({ revision: rev.meta.n, findings: checkPlan(rev.plan) })
  } catch (e) {
    return fail(e)
  }
})
