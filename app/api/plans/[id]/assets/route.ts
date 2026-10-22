import { putAsset } from '@/lib/plan/store'
import { fail, type Ctx } from '../../http'

export const runtime = 'nodejs'

const TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' }
const MAX = 15 * 1024 * 1024

// POST raw image bytes, ?name=file.png. TIF/PDF are converted to PNG in the browser first.
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params
  const name = new URL(req.url).searchParams.get('name') ?? ''
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (!TYPES[ext]) return Response.json({ errors: ['endast png/jpg'] }, { status: 400 })
  const data = Buffer.from(await req.arrayBuffer())
  if (data.length === 0 || data.length > MAX) return Response.json({ errors: ['filen är tom eller för stor (max 15 MB)'] }, { status: 400 })
  try {
    const url = await putAsset(id, name, data, TYPES[ext])
    return Response.json({ url }, { status: 201 })
  } catch (e) {
    return fail(e)
  }
}
