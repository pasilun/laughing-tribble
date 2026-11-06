import { secured } from '@/lib/plan/access'
import { restorePlan } from '@/lib/plan/store'
import { fail, type Ctx } from '../../http'

export const runtime = 'nodejs'

// Takes a plan out of the trash.
export const POST = secured(async (_req: Request, { params }: Ctx): Promise<Response> => {
  const { id } = await params
  try {
    if (!(await restorePlan(id))) return Response.json({ errors: ['planen ligger inte i papperskorgen'] }, { status: 404 })
    return Response.json({ restored: id })
  } catch (e) {
    return fail(e)
  }
})
