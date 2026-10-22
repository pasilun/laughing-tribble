import { denied, hasAccess } from '@/lib/plan/access'
import { listRevisions } from '@/lib/plan/store'
import { fail, type Ctx } from '../../http'

export const runtime = 'nodejs'

export async function GET(req: Request, { params }: Ctx) {
  if (!hasAccess(req)) return denied()
  const { id } = await params
  try {
    return Response.json({ revisions: await listRevisions(id) })
  } catch (e) {
    return fail(e)
  }
}
