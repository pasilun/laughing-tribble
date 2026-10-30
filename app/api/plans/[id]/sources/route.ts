import { secured } from '@/lib/plan/access'
import { addSource } from '@/lib/plan/scan/add-source'
import { fail, type Ctx } from '../../http'

export const runtime = 'nodejs'
export const maxDuration = 60

// Vercel functions take at most 4.5 MB of request body.
const MAX = 4_400_000
const num = (v: string | null) => (v !== null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined)

// POST raw bytes of a drawing (PNG, JPG, TIF or PDF) as a new source of the plan.
// ?id=short-id&filename=a.png&name=…&role=archive|before|after|other&scale=100&dpi=300
// &mm_per_px=…&x=…&y=…&year=…&view=plan|elevation&base_revision=n
export const POST = secured(async (req: Request, { params }: Ctx): Promise<Response> => {
  const { id } = await params
  const q = new URL(req.url).searchParams
  const data = Buffer.from(await req.arrayBuffer())
  if (data.length > MAX) return Response.json({ errors: ['filen är för stor för uppladdning (max 4,4 MB) – förminska bilden eller lägg in den med plan_source_add'] }, { status: 413 })
  const filename = q.get('filename') ?? ''
  if (!/\.(png|jpe?g|tiff?|pdf)$/i.test(filename)) return Response.json({ errors: ['filename måste sluta på .png, .jpg, .tif eller .pdf'] }, { status: 400 })
  try {
    const added = await addSource(
      id,
      {
        id: q.get('id') ?? '',
        name: q.get('name') ?? undefined,
        role: q.get('role') ?? undefined,
        filename,
        scale: num(q.get('scale')),
        dpi: num(q.get('dpi')),
        mm_per_px: num(q.get('mm_per_px')),
        x: num(q.get('x')),
        y: num(q.get('y')),
        year: num(q.get('year')),
        view: q.get('view') ?? undefined,
        base_revision: num(q.get('base_revision')),
        author: 'user',
      },
      data,
    )
    if ('errors' in added) return Response.json({ errors: added.errors }, { status: added.status })
    const { source } = added
    return Response.json(
      {
        revision: added.n,
        source: { id: source.id, name: source.name, role: source.role, widthPx: added.widthPx, heightPx: added.heightPx, dpi: added.dpi ?? null, mmPerPx: added.mmPerPx },
        note: added.note.trim() || undefined,
      },
      { status: 201 },
    )
  } catch (e) {
    return fail(e)
  }
})
