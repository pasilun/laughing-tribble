import { secured } from '@/lib/plan/access'
import { planDxf, sheetPdf, sheetPng, sheetSvg } from '@/lib/plan/export'
import { hasChanges } from '@/lib/plan/sheet'
import { loadPlan } from '@/lib/plan/service'
import type { View } from '@/lib/plan/types'
import { fail, revParam, type Ctx } from '../../http'

export const runtime = 'nodejs'
export const maxDuration = 60

// GET ?view=fore|efter|both&format=svg|pdf|png|dxf&rev=n
export const GET = secured(async (req: Request, { params }: Ctx): Promise<Response> => {
  const { id } = await params
  const q = new URL(req.url).searchParams
  const view = q.get('view') ?? 'efter'
  const format = q.get('format') ?? 'svg'
  if (!['fore', 'efter', 'both'].includes(view)) return Response.json({ errors: ['view måste vara fore, efter eller both'] }, { status: 400 })
  try {
    const rev = await loadPlan(id, revParam(req))
    if (!rev) return Response.json({ errors: ['planen finns inte'] }, { status: 404 })
    const { plan } = rev
    const tb = plan.sheet.titleBlock
    const base = `${tb.drawingNumber || plan.id}${tb.revision ? `-rev${tb.revision}` : ''}`
    const single: View = view === 'fore' ? 'fore' : 'efter'
    const suffix = view === 'both' || !hasChanges(plan) ? '' : single === 'fore' ? '-fore' : '-efter'
    const disposition = (ext: string) => `attachment; filename="${base}${suffix}.${ext}"`
    if (format === 'pdf') {
      const pdf = await sheetPdf(plan, view === 'both' ? ['fore', 'efter'] : [single])
      return new Response(new Uint8Array(pdf), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': disposition('pdf') } })
    }
    if (format === 'png') {
      const width = Math.min(4000, Math.max(400, Number(q.get('width') ?? 2000)))
      return new Response(new Uint8Array(sheetPng(plan, single, width)), { headers: { 'Content-Type': 'image/png' } })
    }
    if (format === 'dxf') {
      return new Response(new Uint8Array(planDxf(plan, single)), { headers: { 'Content-Type': 'application/dxf', 'Content-Disposition': disposition('dxf') } })
    }
    const headers: Record<string, string> = { 'Content-Type': 'image/svg+xml; charset=utf-8' }
    if (q.get('download')) headers['Content-Disposition'] = disposition('svg')
    return new Response(sheetSvg(plan, single), { headers })
  } catch (e) {
    return fail(e)
  }
})
