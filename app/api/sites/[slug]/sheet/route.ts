import { secured } from '@/lib/plan/access'
import { exportDoc } from '@/lib/site/service'
import { getSite } from '@/lib/site/store'
import { fail, revParam } from '../../../plans/http'

export const runtime = 'nodejs'
export const maxDuration = 60

// GET ?format=svg|png|pdf&underlay=none|karta|flyg&grid=10&paper=A3|A4&scale=500&rev=n: the situation plan sheet.
export const GET = secured(async (req: Request, { params }: { params: Promise<{ slug: string }> }): Promise<Response> => {
  const { slug } = await params
  const q = new URL(req.url).searchParams
  const format = q.get('format') === 'pdf' ? 'pdf' : q.get('format') === 'png' ? 'png' : 'svg'
  const u = q.get('underlay')
  const underlay = u === 'karta' || u === 'flyg' ? u : 'none'
  const grid = Number(q.get('grid')) > 0 ? Number(q.get('grid')) : undefined
  const scale = Number(q.get('scale')) > 0 ? Number(q.get('scale')) : undefined
  try {
    const s = await getSite(slug, revParam(req))
    if (!s) return Response.json({ errors: ['tomten finns inte'] }, { status: 404 })
    const out = await exportDoc(s.doc, format, { underlay, grid, scale, paper: q.get('paper') === 'A4' ? 'A4' : 'A3' })
    const headers: Record<string, string> = { 'Content-Type': out.type }
    if (format !== 'svg' || q.get('download')) headers['Content-Disposition'] = `attachment; filename="situationsplan-${slug}.${format}"`
    return new Response(new Uint8Array(out.data), { headers })
  } catch (e) {
    return fail(e)
  }
})
