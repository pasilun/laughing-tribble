import { secured } from '@/lib/plan/access'
import type { Op } from '@/lib/plan/ops'
import { editPlan } from '@/lib/plan/service'
import { author, fail, readJson, type Ctx } from '../../http'

export const runtime = 'nodejs'

export const POST = secured(async (req: Request, { params }: Ctx): Promise<Response> => {
  const { id } = await params
  const body = await readJson(req)
  if (!body || !Array.isArray(body.ops) || typeof body.baseRevision !== 'number')
    return Response.json({ errors: ['ops och baseRevision krävs'] }, { status: 400 })
  try {
    const res = await editPlan(id, body.ops as Op[], body.baseRevision, author(body.author), String(body.message ?? 'Ändring'))
    return Response.json(res, { status: res.status })
  } catch (e) {
    return fail(e)
  }
})
