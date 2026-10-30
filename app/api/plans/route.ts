import { secured } from '@/lib/plan/access'
import { createPlan } from '@/lib/plan/service'
import { listPlans } from '@/lib/plan/store'
import type { Plan } from '@/lib/plan/types'
import { author, fail, readJson } from './http'

export const runtime = 'nodejs'

export const GET = secured(async (): Promise<Response> => {
  try {
    return Response.json({ plans: await listPlans() })
  } catch (e) {
    return fail(e)
  }
})

export const POST = secured(async (req: Request): Promise<Response> => {
  const body = await readJson(req)
  const name = typeof body?.name === 'string' && body.name.trim() ? body.name.trim() : null
  if (!body || !name) return Response.json({ errors: ['name krävs'] }, { status: 400 })
  try {
    const res = await createPlan({
      name,
      template: body.template === 'demo' ? 'demo' : 'empty',
      plan: body.plan as Plan | undefined,
      author: author(body.author),
    })
    if ('errors' in res) return Response.json(res, { status: 422 })
    return Response.json(res, { status: 201 })
  } catch (e) {
    return fail(e)
  }
})
