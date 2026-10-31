import { secured } from '@/lib/plan/access'
import { editItems } from '@/lib/site/service'
import { deleteSite, getSite } from '@/lib/site/store'
import { author, fail, readJson, revParam } from '../../plans/http'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ slug: string }> }

export const GET = secured(async (req: Request, { params }: Ctx): Promise<Response> => {
  const { slug } = await params
  try {
    const s = await getSite(slug, revParam(req))
    if (!s) return Response.json({ errors: ['tomten finns inte'] }, { status: 404 })
    return Response.json({ doc: s.doc, revision: s.meta })
  } catch (e) {
    return fail(e)
  }
})

// Saves the items (what the person drew) as a new revision against the revision they started from.
export const PUT = secured(async (req: Request, { params }: Ctx): Promise<Response> => {
  const { slug } = await params
  const body = await readJson(req)
  if (!body || typeof body.baseRevision !== 'number') return Response.json({ errors: ['items och baseRevision krävs'] }, { status: 400 })
  try {
    const res = await editItems(slug, body.items, body.baseRevision, author(body.author), String(body.message ?? 'Ändrad på sidan'))
    if ('errors' in res) return Response.json({ errors: res.errors, head: res.head }, { status: res.status })
    return Response.json({ doc: res.stored.doc, revision: res.stored.meta })
  } catch (e) {
    return fail(e)
  }
})

export const DELETE = secured(async (_req: Request, { params }: Ctx): Promise<Response> => {
  const { slug } = await params
  try {
    if (!(await deleteSite(slug))) return Response.json({ errors: ['tomten finns inte'] }, { status: 404 })
    return Response.json({ deleted: slug })
  } catch (e) {
    return fail(e)
  }
})
