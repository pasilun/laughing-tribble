import { secured } from '@/lib/plan/access'
import { getAsset } from '@/lib/plan/store'
import { fail } from '../../../http'

export const runtime = 'nodejs'

export const GET = secured(async (req: Request, { params }: { params: Promise<{ id: string; name: string }> }): Promise<Response> => {
  const { id, name } = await params
  try {
    const data = await getAsset(id, decodeURIComponent(name))
    if (!data) return new Response('Not found', { status: 404 })
    const type = /\.png$/i.test(name) ? 'image/png' : 'image/jpeg'
    return new Response(new Uint8Array(data), { headers: { 'Content-Type': type, 'Cache-Control': 'private, max-age=3600' } })
  } catch (e) {
    return fail(e)
  }
})
