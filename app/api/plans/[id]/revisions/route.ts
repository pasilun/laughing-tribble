import { secured } from '@/lib/plan/access'
import { listRevisions } from '@/lib/plan/store'
import { fail, type Ctx } from '../../http'

export const runtime = 'nodejs'

export const GET = secured(async (req: Request, { params }: Ctx): Promise<Response> => {
  const { id } = await params
  try {
    const revisions = await listRevisions(id)
    if (!revisions.length) return Response.json({ errors: ['planen finns inte'] }, { status: 404 })
    return Response.json({ revisions })
  } catch (e) {
    return fail(e)
  }
})
