import { area, bbox, type P } from './geometry'
import { cleanItems, itemArea, itemLength, STATUSES, KINDS, type SiteDoc, type SiteItem } from './doc'
import { svgToPng } from './export'
import { createSite, editItems, renderDoc } from './service'
import { getSite, listSites } from './store'

// Claude's tools for a site (a property seen from above): read what the person drew on the page, in the same
// local metres the page shows, and draw ideas onto it.

type Content = Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }>
type Result = { content: Content; isError?: boolean }

const text = (t: string) => ({ type: 'text' as const, text: t })
const err = (t: string): Result => ({ content: [text(t)], isError: true })
const m = (n: number) => String(Math.round(n * 10) / 10).replace('.', ',')
const pt = (p: P) => `(${m(p.x)}, ${m(p.y)})`

export const SITE_TOOLS = [
  {
    name: 'site_list',
    description: 'Lists the sites (properties seen from above: boundary, buildings, what has been drawn on them) with their latest revision.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'site_create',
    description: 'Makes a site from a property designation ("Strängnäs Lövinge 3:2"): the boundary from Lantmäteriet\'s Min karta and the buildings read from its map (about ±1 m). Then the person draws on it at /plans/site/<slug>.',
    inputSchema: { type: 'object', properties: { designation: { type: 'string' } }, required: ['designation'] },
  },
  {
    name: 'site_get',
    description: `Reads a site: the property, the buildings and everything drawn on it (areas, lines, points) with name, kind, status and coordinates in LOCAL metres (x east, y north of the south-west corner of the property, the same numbers as the grid on the page), and a picture of the situation plan. Use it to see what the person has marked. Default picture: the plan without underlay; underlay "flyg" shows the aerial photo, "karta" the map.`,
    inputSchema: {
      type: 'object',
      properties: {
        slug: { type: 'string' },
        revision: { type: 'number', description: 'An older revision (default latest)' },
        with_points: { type: 'boolean', description: 'List every point of every item (default: the first and last few)' },
        underlay: { type: 'string', enum: ['none', 'flyg', 'karta'] },
        image: { type: 'boolean', description: 'Default yes' },
      },
      required: ['slug'],
    },
  },
  {
    name: 'site_edit',
    description: `Draws on a site: adds, changes or removes items and saves one revision (against base_revision from site_get; a refused save means the person has saved since: read again). Items: area (a ring of 3+ points), line (2+), point (1). Coordinates in local metres. For a rectangle (a shed, a terrace) give rect {x,y,w,d,angle?}: south-west corner, width east, depth north, angle in degrees counter-clockwise. status: ${STATUSES.join(', ')}; kind: ${KINDS.join(', ')}; color "#rrggbb" (default red).
ops: {"op":"add","item":{"type":"area","name":"Växthus","kind":"byggnad","status":"idé","rect":{"x":30,"y":112,"w":6,"d":4}}} · {"op":"update","id":"i1","patch":{"name":"…","status":"planerad","points":[…]}} · {"op":"delete","id":"i1"}. All ops succeed together or none.`,
    inputSchema: {
      type: 'object',
      properties: {
        slug: { type: 'string' },
        base_revision: { type: 'number' },
        message: { type: 'string', description: 'What changed, in Swedish' },
        ops: { type: 'array', items: { type: 'object' } },
        underlay: { type: 'string', enum: ['none', 'flyg', 'karta'] },
        image: { type: 'boolean', description: 'Also a picture of the result (default no)' },
      },
      required: ['slug', 'base_revision', 'ops'],
    },
  },
]

function describe(doc: SiteDoc, full: boolean): string {
  const prop = doc.property.reduce((t, poly) => t + area(poly[0]), 0)
  const lines = [
    `Tomt ${doc.designation} (${doc.slug}). Fastighetsarea ca ${Math.round(prop)} m². Lokala koordinater i meter: x öster, y norr om fastighetens sydvästra hörn; fastigheten är ${m(bbox(doc.property.flatMap((p) => p[0])).maxX - bbox(doc.property.flatMap((p) => p[0])).minX)} m bred och ${m(bbox(doc.property.flatMap((p) => p[0])).maxY - bbox(doc.property.flatMap((p) => p[0])).minY)} m lång.`,
    `Gräns: ${doc.property[0][0].map(pt).join(' ')}`,
    `Byggnader (avlästa ur kartan, ±1 m):`,
    ...doc.buildings.map((b) => {
      const c = { x: b.corners.reduce((t, p) => t + p.x, 0) / b.corners.length, y: b.corners.reduce((t, p) => t + p.y, 0) / b.corners.length }
      return `- ${b.id} ${b.kind} ${m(b.width)} × ${m(b.depth)} m (ca ${b.area} m²), mitt ${pt(c)}`
    }),
    `Objekt (${doc.items.length}):`,
  ]
  const short = (it: SiteItem) => (full || it.points.length <= 8 ? it.points.map(pt).join(' ') : `${it.points.slice(0, 4).map(pt).join(' ')} … ${it.points.slice(-2).map(pt).join(' ')} (${it.points.length} punkter, with_points för alla)`)
  const n = { area: 0, line: 0, point: 0 }
  for (const it of doc.items) {
    const tag = `${it.type === 'area' ? 'A' : it.type === 'line' ? 'L' : 'P'}${++n[it.type]}`
    const size = it.type === 'area' ? `yta ca ${Math.round(itemArea(it))} m²` : it.type === 'line' ? `längd ca ${Math.round(itemLength(it))} m` : 'punkt'
    lines.push(`- ${tag} [${it.id}] ${it.name} (${it.kind}, ${it.status}${it.color !== '#d40000' ? `, ${it.color}` : ''}): ${size}${it.note ? ` – ${it.note}` : ''}\n    ${short(it)}`)
  }
  if (!doc.items.length) lines.push('- inga ännu')
  return lines.join('\n')
}

async function picture(doc: SiteDoc, underlay: unknown): Promise<Content[number][]> {
  const u = underlay === 'flyg' || underlay === 'karta' ? underlay : 'none'
  const { svg } = await renderDoc(doc, { underlay: u })
  return [{ type: 'image', data: svgToPng(svg, 1500).toString('base64'), mimeType: 'image/png' }]
}

function rectPoints(r: { x: number; y: number; w: number; d: number; angle?: number }): P[] {
  const a = ((r.angle ?? 0) * Math.PI) / 180
  const c = Math.cos(a)
  const s = Math.sin(a)
  return [[0, 0], [r.w, 0], [r.w, r.d], [0, r.d]].map(([x, y]) => ({ x: r.x + x * c - y * s, y: r.y + x * s + y * c }))
}

export async function handleSiteTool(name: string, args: Record<string, unknown>): Promise<Result | null> {
  if (!SITE_TOOLS.some((t) => t.name === name)) return null
  try {
    if (name === 'site_list') {
      const sites = await listSites()
      return { content: [text(sites.length ? sites.map((s) => `${s.slug}: ${s.designation} (rev ${s.revision})`).join('\n') : 'Inga tomter ännu. site_create gör en från en fastighetsbeteckning.')] }
    }
    if (name === 'site_create') {
      const res = await createSite(String(args.designation ?? ''), 'claude')
      if ('errors' in res) return err(res.errors.join('\n'))
      return { content: [text(`Skapad: ${res.stored.doc.slug}, revision ${res.stored.meta.n}. Sidan: /plans/site/${res.stored.doc.slug}\n\n${describe(res.stored.doc, false)}`), ...(await picture(res.stored.doc, 'none'))] }
    }
    const slug = String(args.slug ?? '')
    if (name === 'site_get') {
      const s = await getSite(slug, typeof args.revision === 'number' ? args.revision : undefined)
      if (!s) return err(`Tomten ${slug} finns inte`)
      return { content: [text(`Revision ${s.meta.n} (${s.meta.author}: ${s.meta.message})\n${describe(s.doc, args.with_points === true)}`), ...(args.image === false ? [] : await picture(s.doc, args.underlay))] }
    }
    // site_edit
    const cur = await getSite(slug)
    if (!cur) return err(`Tomten ${slug} finns inte`)
    if (!Array.isArray(args.ops) || typeof args.base_revision !== 'number') return err('ops (lista) och base_revision (nummer) krävs')
    let items = cur.doc.items.map((i) => ({ ...i }))
    const ids = new Set(items.map((i) => i.id))
    const next = () => {
      let k = 1
      while (ids.has(`i${k}`)) k++
      ids.add(`i${k}`)
      return `i${k}`
    }
    const problems: string[] = []
    ;(args.ops as Array<Record<string, unknown>>).forEach((op, i) => {
      const at = `op ${i + 1}`
      if (op.op === 'add') {
        const it = (op.item ?? {}) as Record<string, unknown>
        const points = it.rect ? rectPoints(it.rect as { x: number; y: number; w: number; d: number; angle?: number }) : (it.points as P[] | undefined)
        items.push({ id: typeof it.id === 'string' ? it.id : next(), type: it.type as SiteItem['type'], name: String(it.name ?? ''), kind: String(it.kind ?? 'annat'), status: it.status as SiteItem['status'], color: String(it.color ?? '#d40000'), note: it.note ? String(it.note) : undefined, points: points ?? [] })
      } else if (op.op === 'update') {
        const k = items.findIndex((x) => x.id === op.id)
        if (k < 0) return void problems.push(`${at}: ${String(op.id)} finns inte`)
        const patch = { ...((op.patch ?? {}) as Record<string, unknown>) }
        if (patch.rect) patch.points = rectPoints(patch.rect as { x: number; y: number; w: number; d: number; angle?: number })
        delete patch.rect
        delete patch.id
        items[k] = { ...items[k], ...patch } as SiteItem
      } else if (op.op === 'delete') {
        if (!items.some((x) => x.id === op.id)) return void problems.push(`${at}: ${String(op.id)} finns inte`)
        items = items.filter((x) => x.id !== op.id)
      } else problems.push(`${at}: okänd op "${String(op.op)}" (add, update, delete)`)
    })
    if (problems.length) return err(`Ingen ändring sparades:\n${problems.join('\n')}`)
    const check = cleanItems(items)
    if (check.errors.length) return err(`Ingen ändring sparades:\n${check.errors.join('\n')}`)
    const res = await editItems(slug, items, args.base_revision, 'claude', String(args.message ?? 'Ändrat av Claude'))
    if ('errors' in res) return err(`Ingen ändring sparades:\n${res.errors.join('\n')}${res.status === 409 ? '\nLäs tomten igen (site_get) och gör om ändringen mot senaste revisionen.' : ''}`)
    return { content: [text(`Sparad som revision ${res.stored.meta.n}.\n${describe(res.stored.doc, false)}`), ...(args.image === true ? await picture(res.stored.doc, args.underlay) : [])] }
  } catch (e) {
    return err((e as Error).message)
  }
}
