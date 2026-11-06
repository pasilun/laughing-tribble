import { secured } from '@/lib/plan/auth/access'
import { addSource } from '@/lib/plan/scan/add-source'
import { checkParts, dropParts, joinParts, SINGLE_MAX } from '@/lib/plan/uploads'
import { fail, type Ctx } from '../../http'

export const runtime = 'nodejs'
export const maxDuration = 60

const num = (v: string | null) => (v !== null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined)

// A drawing over 4.4 MB comes in pieces (POST …/sources/parts?upload=…&part=n for each) and is then
// added by an empty POST here with &upload=…&parts=n: the pieces are joined, used, and removed.
// POST raw bytes of a drawing (PNG, JPG, TIF or PDF) as a new source of the plan.
// ?id=short-id&filename=a.png&name=…&role=archive|before|after|other&scale=100&dpi=300
// &mm_per_px=…&x=…&y=…&year=…&view=plan|elevation&base_revision=n
export const POST = secured(async (req: Request, { params }: Ctx): Promise<Response> => {
  const { id } = await params
  const q = new URL(req.url).searchParams
  const upload = q.get('upload')
  const parts = Number(q.get('parts'))
  const piecewise = upload !== null
  const bad = piecewise ? checkParts(upload, parts) : null
  if (bad) return Response.json({ errors: bad.errors }, { status: bad.status })
  let data: Buffer
  if (piecewise) {
    const j = await joinParts(id, upload, parts)
    if (!Buffer.isBuffer(j)) return Response.json({ errors: j.errors }, { status: j.status })
    data = j
  } else data = Buffer.from(await req.arrayBuffer())
  try {
    return await handle(id, q, data, piecewise)
  } finally {
    if (piecewise) await dropParts(id, upload, parts)
  }
})

async function handle(id: string, q: URLSearchParams, data: Buffer, piecewise: boolean): Promise<Response> {
  if (!piecewise && data.length > SINGLE_MAX) return Response.json({ errors: ['filen är för stor för uppladdning (max 4,4 MB i en bit) – skicka den i delar'] }, { status: 413 })
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
}
