import { listRevisions } from '@/lib/plan/store'
import { fail, type Ctx } from '../../http'

export const runtime = 'nodejs'

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params
  try {
    return Response.json({ revisions: await listRevisions(id) })
  } catch (e) {
    return fail(e)
  }
}
