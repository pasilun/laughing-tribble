import { secured } from '@/lib/plan/auth/access'
import { storeImage } from '@/lib/plan/uploads'
import { fail, type Ctx } from '../../http'

export const runtime = 'nodejs'

// POST raw image bytes, ?name=file.png. TIF/PDF are converted to PNG in the browser first.
export const POST = secured(async (req: Request, { params }: Ctx): Promise<Response> => {
  const { id } = await params
  const name = new URL(req.url).searchParams.get('name') ?? ''
  try {
    const res = await storeImage(id, name, Buffer.from(await req.arrayBuffer()))
    return 'errors' in res ? Response.json({ errors: res.errors }, { status: res.status }) : Response.json(res, { status: 201 })
  } catch (e) {
    return fail(e)
  }
})
