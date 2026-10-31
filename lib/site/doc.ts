import { area, bbox, dist, type P } from './geometry'

// A site (a property seen from above) as the app keeps it: everything in LOCAL metres, x east and y north
// of the south-west corner of the property's bounding box, so the numbers on the page, in the grid and
// in what is said about the land are the same. `origin` is that corner in the map's grid (SWEREF 99 TM).

export const STATUSES = ['befintlig', 'idé', 'planerad', 'ansökan'] as const
export type Status = (typeof STATUSES)[number]
export const KINDS = ['äng', 'gräsmatta', 'byggnad', 'odling', 'skog', 'vatten', 'väg / stig', 'stängsel', 'ledning', 'annat'] as const
export type ItemType = 'area' | 'line' | 'point'

export type SiteItem = {
  id: string
  type: ItemType
  name: string
  kind: string
  status: Status
  color: string
  note?: string
  points: P[] // local metres; an area's ring is open (not closed by repeating the first point)
}

export type SiteBuilding = { id: string; kind: 'bostadshus' | 'komplementbyggnad'; corners: P[]; area: number; width: number; depth: number }

export type SiteDoc = {
  slug: string
  designation: string
  municipality: string
  objectId: string
  origin: P
  property: P[][][] // polygons: outer ring, then holes
  buildings: SiteBuilding[]
  // What the page shows and the photo covers: local metres.
  view: { minX: number; maxX: number; minY: number; maxY: number }
  items: SiteItem[]
  title?: { address?: string; author?: string }
}

export type SiteRevision = { n: number; author: 'user' | 'claude'; message: string; createdAt: string }

export const SLUG = /^[a-z0-9][a-z0-9-]{0,60}$/

export function slugOf(designation: string): string {
  return designation
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
}

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const pt = (p: unknown): p is P => !!p && typeof p === 'object' && fin((p as P).x) && fin((p as P).y)

export const DEFAULT_COLOR = '#d40000'

// Checks what comes from the page or from Claude; returns the cleaned items or the problems.
export function cleanItems(raw: unknown): { items: SiteItem[]; errors: string[] } {
  const errors: string[] = []
  if (!Array.isArray(raw)) return { items: [], errors: ['items måste vara en lista'] }
  const seen = new Set<string>()
  const items: SiteItem[] = []
  raw.forEach((r, i) => {
    const it = r as Partial<SiteItem>
    const at = `objekt ${i + 1}${it?.name ? ` (${it.name})` : ''}`
    if (!it || typeof it.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,40}$/i.test(it.id)) return void errors.push(`${at}: id saknas eller är ogiltigt`)
    if (seen.has(it.id)) return void errors.push(`${at}: id ${it.id} används två gånger`)
    seen.add(it.id)
    if (it.type !== 'area' && it.type !== 'line' && it.type !== 'point') return void errors.push(`${at}: type måste vara area, line eller point`)
    const need = it.type === 'area' ? 3 : it.type === 'line' ? 2 : 1
    if (!Array.isArray(it.points) || it.points.length < need || !it.points.every(pt)) return void errors.push(`${at}: ${it.type} behöver minst ${need} punkter med x och y i meter`)
    if (it.points.length > 2000) return void errors.push(`${at}: för många punkter`)
    const status = (STATUSES as readonly string[]).includes(String(it.status)) ? (it.status as Status) : 'befintlig'
    items.push({
      id: it.id,
      type: it.type,
      name: String(it.name ?? '').slice(0, 80) || (it.type === 'area' ? 'Yta' : it.type === 'line' ? 'Linje' : 'Punkt'),
      kind: String(it.kind ?? 'annat').slice(0, 40),
      status,
      color: /^#[0-9a-f]{6}$/i.test(String(it.color)) ? String(it.color) : DEFAULT_COLOR,
      ...(it.note ? { note: String(it.note).slice(0, 500) } : {}),
      points: it.points.map((p) => ({ x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100 })),
    })
  })
  return { items, errors }
}

export const itemArea = (it: SiteItem) => (it.type === 'area' ? area(it.points) : 0)
export const itemLength = (it: SiteItem) => (it.type === 'line' ? it.points.slice(1).reduce((t, p, i) => t + dist(it.points[i], p), 0) : 0)

export function propertyBox(polygons: P[][][]) {
  return bbox(polygons.flatMap((p) => p[0]))
}
