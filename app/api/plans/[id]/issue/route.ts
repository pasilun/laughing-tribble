import { issuePlan } from '@/lib/plan/service'
import { author, fail, readJson, type Ctx } from '../../http'

export const runtime = 'nodejs'

export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params
  const body = await readJson(req)
  try {
    const res = await issuePlan(id, author(body?.author))
    if (!res) return Response.json({ errors: ['planen finns inte'] }, { status: 404 })
    return Response.json(res)
  } catch (e) {
    return fail(e)
  }
}
