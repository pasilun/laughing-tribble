import { secured } from '@/lib/plan/auth/access'
import { storePart } from '@/lib/plan/uploads'
import { fail, type Ctx } from '../../../http'

export const runtime = 'nodejs'

// One piece of a drawing too big for a single request (Vercel takes at most 4.5 MB of body).
// POST raw bytes, ?upload=<short id>&part=<0, 1, 2…>. The pieces are put together by the
// sources route (?upload=…&parts=n), which then removes them.
export const POST = secured(async (req: Request, { params }: Ctx): Promise<Response> => {
  const { id } = await params
  const q = new URL(req.url).searchParams
  try {
    const res = await storePart(id, q.get('upload') ?? '', Number(q.get('part')), Buffer.from(await req.arrayBuffer()))
    return 'errors' in res ? Response.json({ errors: res.errors }, { status: res.status }) : Response.json(res, { status: 201 })
  } catch (e) {
    return fail(e)
  }
})
