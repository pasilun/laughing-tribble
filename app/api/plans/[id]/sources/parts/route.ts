import { secured } from '@/lib/plan/access'
import { loadPlan } from '@/lib/plan/service'
import { putAsset } from '@/lib/plan/store'
import { fail, type Ctx } from '../../../http'
import { PART_MAX, UPLOAD_ID, partName } from '../../../upload'

export const runtime = 'nodejs'

// One piece of a drawing too big for a single request (Vercel takes at most 4.5 MB of body).
// POST raw bytes, ?upload=<short id>&part=<0, 1, 2…>. The pieces are put together by the
// sources route (?upload=…&parts=n), which then removes them.
export const POST = secured(async (req: Request, { params }: Ctx): Promise<Response> => {
  const { id } = await params
  const q = new URL(req.url).searchParams
  const upload = q.get('upload') ?? ''
  const part = Number(q.get('part'))
  if (!UPLOAD_ID.test(upload) || !Number.isInteger(part) || part < 0 || part > 9) return Response.json({ errors: ['upload: gemener och siffror; part: 0–9'] }, { status: 400 })
  const data = Buffer.from(await req.arrayBuffer())
  if (data.length === 0) return Response.json({ errors: ['biten är tom'] }, { status: 400 })
  if (data.length > PART_MAX) return Response.json({ errors: ['biten är för stor (max 4,4 MB)'] }, { status: 413 })
  try {
    if (!(await loadPlan(id))) return Response.json({ errors: [`Planen ${id} finns inte`] }, { status: 404 })
    await putAsset(id, partName(upload, part), data, 'application/octet-stream')
    return Response.json({ part, bytes: data.length }, { status: 201 })
  } catch (e) {
    return fail(e)
  }
})
