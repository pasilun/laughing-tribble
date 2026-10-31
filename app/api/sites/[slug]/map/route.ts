import { secured } from '@/lib/plan/access'
import { underlayImage } from '@/lib/site/service'
import { getSite } from '@/lib/site/store'
import { fail } from '../../../plans/http'

export const runtime = 'nodejs'
export const maxDuration = 60

// GET ?layer=karta|flyg: the base map or the aerial photo under the page's drawing, with its extent in local
// metres in the X-Extent header (minX,minY,maxX,maxY).
export const GET = secured(async (req: Request, { params }: { params: Promise<{ slug: string }> }): Promise<Response> => {
  const { slug } = await params
  const layer = new URL(req.url).searchParams.get('layer') === 'flyg' ? 'flyg' : 'karta'
  try {
    const s = await getSite(slug)
    if (!s) return Response.json({ errors: ['tomten finns inte'] }, { status: 404 })
    const img = await underlayImage(s.doc, layer)
    const e = img.extent
    return new Response(new Uint8Array(img.data), { headers: { 'Content-Type': img.type, 'X-Extent': `${e.minX},${e.minY},${e.maxX},${e.maxY}`, 'Cache-Control': 'private, max-age=3600', 'Access-Control-Expose-Headers': 'X-Extent' } })
  } catch (e) {
    return fail(e)
  }
})
