import sharp from 'sharp'
import type { P } from './geometry'

// Property and map from Lantmäteriet's Min karta (minkarta.lantmateriet.se): the same two
// services the page itself uses – a search (property → id and geometry, SWEREF 99 TM metres)
// and the topographic WMTS tiles. Both are open to anyone using the page; they are not a
// documented product, so a failure here means the page changed. Keep the request count small.

const BASE = 'https://minkarta.lantmateriet.se'
const HEADERS = { 'User-Agent': 'planstudio-site/0.1 (one property at a time)' }

export type Property = {
  id: string
  designation: string
  municipality: string
  centre: P
  // One polygon per part of the property; each polygon is an outer ring then holes.
  polygons: P[][][]
}

async function getJson<T>(path: string): Promise<T> {
  const r = await fetch(`${BASE}${path}`, { headers: HEADERS })
  if (!r.ok) throw new Error(`Lantmäteriet svarade ${r.status} på ${path.split('?')[0]}`)
  return (await r.json()) as T
}

export async function findProperty(designation: string): Promise<Property> {
  const found = await getJson<{ sokresultat: Array<{ headertext: string; id: string; subtext: string; typ: string; position: { east: number; north: number } }> }>(
    `/api/searchservice/searchinput?&searchtext=${encodeURIComponent(designation)}`,
  )
  const hit = found.sokresultat.find((x) => x.typ === 'REGISTERENHET')
  if (!hit) throw new Error(`Hittade ingen fastighet som heter "${designation}" (sökte: ${found.sokresultat.map((x) => x.headertext).join(', ') || 'inget'})`)
  const geo = await getJson<{ enhetsutbredning?: Array<{ yta?: Array<{ type: string; coordinates: number[][][] }> }> }>(`/api/searchservice/fastighetsgeometri/v1?objektidentitet=${hit.id}`)
  const polygons: P[][][] = []
  for (const u of geo.enhetsutbredning ?? []) for (const y of u.yta ?? []) if (y.type === 'Polygon') polygons.push(y.coordinates.map((ring) => ring.slice(0, -1).map(([x, yy]) => ({ x, y: yy }))))
  if (!polygons.length) throw new Error(`${hit.headertext} har ingen geometri i Lantmäteriets karta`)
  return { id: hit.id, designation: hit.headertext, municipality: hit.subtext, centre: { x: hit.position.east, y: hit.position.north }, polygons }
}

// WMTS in SWEREF 99 TM (tilematrixset 3006): origin (-1 200 000, 8 500 000), 256 px tiles,
// 4096 m per pixel at level 0, halved each level; the finest level is 13 (0.5 m per pixel).
export const LEVEL = 13
export const RES = 4096 / 2 ** LEVEL
const ORIGIN = { x: -1_200_000, y: 8_500_000 }

export type Mosaic = { png: Buffer; width: number; height: number; origin: P; res: number } // origin: top left corner, metres

export async function fetchMosaic(box: { minX: number; maxX: number; minY: number; maxY: number }, layer: 'topowebb' | 'topowebb_nedtonad'): Promise<Mosaic> {
  const tile = RES * 256
  const c0 = Math.floor((box.minX - ORIGIN.x) / tile)
  const c1 = Math.floor((box.maxX - ORIGIN.x) / tile)
  const r0 = Math.floor((ORIGIN.y - box.maxY) / tile)
  const r1 = Math.floor((ORIGIN.y - box.minY) / tile)
  const jobs: Array<{ c: number; r: number }> = []
  for (let c = c0; c <= c1; c++) for (let r = r0; r <= r1; r++) jobs.push({ c, r })
  if (jobs.length > 36) throw new Error(`Området är för stort (${jobs.length} rutor)`)
  const tiles = await Promise.all(
    jobs.map(async ({ c, r }) => {
      const url = `${BASE}/map/topowebbcache?layer=${layer}&style=default&tilematrixset=3006&Service=WMTS&Request=GetTile&Version=1.0.0&Format=image%2Fpng&TileMatrix=${LEVEL}&TileCol=${c}&TileRow=${r}`
      const res = await fetch(url, { headers: HEADERS })
      if (!res.ok) throw new Error(`Kartruta ${c},${r}: ${res.status}`)
      return { input: Buffer.from(await res.arrayBuffer()), left: (c - c0) * 256, top: (r - r0) * 256 }
    }),
  )
  const width = (c1 - c0 + 1) * 256
  const height = (r1 - r0 + 1) * 256
  const png = await sharp({ create: { width, height, channels: 3, background: '#ffffff' } }).composite(tiles).png().toBuffer()
  return { png, width, height, origin: { x: ORIGIN.x + c0 * tile, y: ORIGIN.y - r0 * tile }, res: RES }
}
