import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { extractBuildings, type Building } from './buildings'
import { cleanItems, propertyBox, slugOf, type SiteBuilding, type SiteDoc, type SiteItem, type SiteRevision } from './doc'
import { backgroundUri, svgToPdf, svgToPng } from './export'
import { area as polygonArea, bbox, type P } from './geometry'
import { fetchAerial, fetchMosaic, findProperty, type Mosaic } from './lantmateriet'
import { layoutSite, renderSite, type SiteArea, type SiteLine, type SitePoint, type SiteSheet } from './render'
import { getSite, saveSite, type StoredSite } from './store'

const VIEW_MARGIN = 45 // m of map around the property on the page

const round1 = (n: number) => Math.round(n * 10) / 10
const local = (p: P, o: P): P => ({ x: round1(p.x - o.x), y: round1(p.y - o.y) })

// Areas the owner has marked for a property, kept in the repository as sites/<slug>/areas.json (local metres).
function seedItems(slug: string): SiteItem[] {
  const file = path.join(process.cwd(), 'sites', slug, 'areas.json')
  if (!existsSync(file)) return []
  const raw = JSON.parse(readFileSync(file, 'utf8')) as { areas: Array<{ id: string; name: string; kind?: string; status?: string; stroke?: string; ring: P[] }> }
  return cleanItems(raw.areas.map((a) => ({ id: a.id, type: 'area', name: a.name, kind: a.kind ?? 'annat', status: a.status ?? 'befintlig', color: a.stroke ?? '#2f6b1f', points: a.ring }))).items
}

// Properties the repository already knows something about (sites/<slug>/areas.json with a designation): offered
// on the list page so that making the first site is one click.
export function knownDesignations(): string[] {
  const dir = path.join(process.cwd(), 'sites')
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap((slug) => {
    const file = path.join(dir, slug, 'areas.json')
    if (!existsSync(file)) return []
    const d = (JSON.parse(readFileSync(file, 'utf8')) as { designation?: string }).designation
    return d ? [d] : []
  })
}

// Corrections to what the map shows: a building that is not a rectangle (sites/<slug>/areas.json, "buildings"), in local metres.
type BuildingFix = { id: string; kind?: SiteBuilding['kind']; label?: string; note?: string; area?: number; corners: P[] }
export function buildingFixes(slug: string): BuildingFix[] {
  const file = path.join(process.cwd(), 'sites', slug, 'areas.json')
  if (!existsSync(file)) return []
  return ((JSON.parse(readFileSync(file, 'utf8')) as { buildings?: BuildingFix[] }).buildings ?? []).filter((b) => b.id && Array.isArray(b.corners) && b.corners.length >= 3)
}
export function applyBuildingFixes(buildings: SiteBuilding[], fixes: BuildingFix[]): SiteBuilding[] {
  return buildings.map((b) => {
    const f = fixes.find((x) => x.id === b.id && (!x.kind || x.kind === b.kind))
    return f ? { ...b, corners: f.corners, area: f.area ?? Math.round(polygonArea(f.corners)), label: f.label, note: f.note } : b
  })
}

// A new site: the property's boundary from Lantmäteriet's Min karta and the buildings read from its map.
export async function createSite(designation: string, author: SiteRevision['author']): Promise<{ stored: StoredSite } | { errors: string[]; status: number }> {
  const prop = await findProperty(designation)
  const slug = slugOf(prop.designation)
  if (await getSite(slug)) return { errors: [`${prop.designation} finns redan (${slug})`], status: 409 }
  const rings = prop.polygons.map((p) => p[0])
  const b = bbox(rings.flat())
  const origin = { x: b.minX, y: b.minY }
  const topo = await fetchMosaic({ minX: b.minX - 60, maxX: b.maxX + 60, minY: b.minY - 60, maxY: b.maxY + 60 }, 'topowebb')
  const found = await extractBuildings(topo, rings)
  const doc: SiteDoc = {
    slug,
    designation: prop.designation,
    municipality: prop.municipality,
    objectId: prop.id,
    origin,
    property: prop.polygons.map((poly) => poly.map((ring) => ring.map((p) => local(p, origin)))),
    buildings: applyBuildingFixes(
      found.map((q) => ({ id: q.id, kind: q.kind, corners: q.corners.map((p) => local(p, origin)), area: q.area, width: q.width, depth: q.depth })),
      buildingFixes(slug),
    ),
    view: { minX: -VIEW_MARGIN, maxX: b.maxX - b.minX + VIEW_MARGIN, minY: -VIEW_MARGIN, maxY: b.maxY - b.minY + VIEW_MARGIN },
    items: seedItems(slug),
  }
  const meta = await saveSite(doc, { author, message: 'Skapad från Lantmäteriets karta' }, 0)
  return { stored: { doc, meta } }
}

// Importing a ready document (a site made elsewhere, or a test fixture).
export async function importSite(input: SiteDoc, author: SiteRevision['author']): Promise<{ stored: StoredSite } | { errors: string[]; status: number }> {
  const slug = slugOf(input.designation || input.slug || '')
  if (!slug) return { errors: ['designation krävs'], status: 400 }
  if (!Array.isArray(input.property) || !input.property.length || !input.origin) return { errors: ['property och origin krävs'], status: 400 }
  const { items, errors } = cleanItems(input.items ?? [])
  if (errors.length) return { errors, status: 422 }
  if (await getSite(slug)) return { errors: [`${slug} finns redan`], status: 409 }
  const doc: SiteDoc = { ...input, slug, items }
  const meta = await saveSite(doc, { author, message: 'Importerad' }, 0)
  return { stored: { doc, meta } }
}

export async function editSite(slug: string, change: { items?: unknown; buildings?: SiteBuilding[] }, base: number, author: SiteRevision['author'], message: string): Promise<{ stored: StoredSite } | { errors: string[]; status: number; head?: number }> {
  const cur = await getSite(slug)
  if (!cur) return { errors: ['tomten finns inte'], status: 404 }
  if (cur.meta.n !== base) return { errors: [`tomten har ändrats – senaste revision är ${cur.meta.n}`], status: 409, head: cur.meta.n }
  let items = cur.doc.items
  if (change.items !== undefined) {
    const clean = cleanItems(change.items)
    if (clean.errors.length) return { errors: clean.errors, status: 422 }
    items = clean.items
  }
  const doc: SiteDoc = { ...cur.doc, items, buildings: change.buildings ?? cur.doc.buildings }
  const meta = await saveSite(doc, { author, message }, base)
  return { stored: { doc, meta } }
}

export const editItems = (slug: string, items: unknown, base: number, author: SiteRevision['author'], message: string) => editSite(slug, { items }, base, author, message)

// ── pictures ────────────────────────────────────────────────────────────────

const cache = new Map<string, { data: Buffer; type: string; extent: SiteDoc['view'] }>()

// The underlay for the page: the pale map or the aerial photo, covering the doc's view; with its extent in local metres.
export async function underlayImage(doc: SiteDoc, layer: 'karta' | 'flyg'): Promise<{ data: Buffer; type: string; extent: SiteDoc['view'] }> {
  const key = `${doc.objectId}:${layer}:${doc.view.maxX}:${doc.view.maxY}`
  const hit = cache.get(key)
  if (hit) return hit
  const o = doc.origin
  const v = doc.view
  let out: { data: Buffer; type: string; extent: SiteDoc['view'] }
  if (layer === 'flyg') {
    const m = await fetchAerial({ minX: o.x + v.minX, maxX: o.x + v.maxX, minY: o.y + v.minY, maxY: o.y + v.maxY }, 0.25)
    const sharp = (await import('sharp')).default
    out = { data: await sharp(m.png).jpeg({ quality: 82 }).toBuffer(), type: 'image/jpeg', extent: v }
  } else {
    const m = await fetchMosaic({ minX: o.x + v.minX, maxX: o.x + v.maxX, minY: o.y + v.minY, maxY: o.y + v.maxY }, 'topowebb_nedtonad')
    out = {
      data: m.png,
      type: 'image/png',
      extent: { minX: m.origin.x - o.x, maxX: m.origin.x + m.width * m.res - o.x, minY: m.origin.y - m.height * m.res - o.y, maxY: m.origin.y - o.y },
    }
  }
  cache.set(key, out)
  if (cache.size > 6) cache.delete(cache.keys().next().value!)
  return out
}

export function sheetOf(doc: SiteDoc, o: { underlay?: Mosaic; photo?: boolean; grid?: number; paper?: 'A3' | 'A4'; scale?: number } = {}): SiteSheet {
  const O = doc.origin
  const map = (p: P): P => ({ x: p.x + O.x, y: p.y + O.y })
  const legendOf = (it: SiteItem) => `${it.kind}${it.status !== 'befintlig' ? ` – ${it.status}` : ''}`
  const areas: SiteArea[] = doc.items.filter((i) => i.type === 'area').map((i) => ({ id: i.id, name: i.name, kind: i.kind, status: i.status, stroke: i.color, legend: legendOf(i), ring: i.points.map(map) }))
  const lines: SiteLine[] = doc.items.filter((i) => i.type === 'line').map((i) => ({ id: i.id, name: i.name, kind: i.kind, status: i.status, stroke: i.color, legend: legendOf(i), points: i.points.map(map) }))
  const points: SitePoint[] = doc.items.filter((i) => i.type === 'point').map((i) => ({ id: i.id, name: i.name, kind: i.kind, status: i.status, stroke: i.color, legend: legendOf(i), at: map(i.points[0]) }))
  const buildings: Building[] = doc.buildings.map((q) => ({ ...q, corners: q.corners.map(map) }))
  return {
    polygons: doc.property.map((poly) => poly.map((ring) => ring.map(map))),
    buildings,
    areas,
    lines,
    points,
    title: { designation: doc.designation, municipality: doc.municipality, address: doc.title?.address, author: doc.title?.author },
    background: o.underlay,
    backgroundOpacity: o.photo ? 1 : undefined,
    grid: o.grid,
    paper: o.paper,
    scale: o.scale,
  }
}

// The sheet as SVG, with the underlay the caller asks for (the map or the photo cover the whole drawing area).
export async function renderDoc(doc: SiteDoc, o: { underlay?: 'none' | 'karta' | 'flyg'; grid?: number; paper?: 'A3' | 'A4'; scale?: number } = {}): Promise<{ svg: string; paperW: number; paperH: number }> {
  const base = sheetOf(doc, { grid: o.grid, paper: o.paper, scale: o.scale })
  const L = layoutSite(base)
  let sheet = base
  let uri: string | undefined
  if (o.underlay === 'karta' || o.underlay === 'flyg') {
    const b = propertyBox(base.polygons)
    const halfW = ((L.map.w / 2) * L.scale) / 1000 + 2
    const halfH = ((L.map.h / 2) * L.scale) / 1000 + 2
    const mid = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 }
    const area = { minX: mid.x - halfW, maxX: mid.x + halfW, minY: mid.y - halfH, maxY: mid.y + halfH }
    const photo = o.underlay === 'flyg'
    const m = photo ? await fetchAerial(area, 0.25) : await fetchMosaic(area, 'topowebb_nedtonad')
    sheet = sheetOf(doc, { underlay: m, photo, grid: o.grid ?? (photo ? 10 : undefined), paper: o.paper, scale: o.scale })
    uri = await backgroundUri(m, { photo })
  }
  return { svg: renderSite(sheet, uri), paperW: L.paperW, paperH: L.paperH }
}

export async function exportDoc(doc: SiteDoc, format: 'svg' | 'png' | 'pdf', o: Parameters<typeof renderDoc>[1] = {}): Promise<{ data: Buffer; type: string }> {
  const { svg, paperW, paperH } = await renderDoc(doc, o)
  if (format === 'png') return { data: svgToPng(svg, 2200), type: 'image/png' }
  if (format === 'pdf') return { data: await svgToPdf(svg, paperW, paperH, `Situationsplan ${doc.designation}`), type: 'application/pdf' }
  return { data: Buffer.from(svg), type: 'image/svg+xml; charset=utf-8' }
}
