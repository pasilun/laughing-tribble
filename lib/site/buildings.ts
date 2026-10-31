import sharp from 'sharp'
import { minRect, type P } from './geometry'
import type { Mosaic } from './lantmateriet'

// Buildings read out of the topographic map: Lantmäteriet paints a dwelling orange-brown and
// other buildings tan, and a 0.5 m pixel is the finest the map is served in. So a footprint is
// good to about a metre: right for a situation plan's overview, not a survey (an inmätning or
// the building register's own geometry is what to use when the exact position decides).

export type Building = {
  id: string
  kind: 'bostadshus' | 'komplementbyggnad'
  corners: P[] // four, metres, in the map's grid
  area: number // m²
  width: number // long side, m
  depth: number // short side, m
}

const KINDS: Array<{ kind: Building['kind']; rgb: [number, number, number]; tol: number }> = [
  { kind: 'bostadshus', rgb: [201, 135, 84], tol: 22 },
  { kind: 'komplementbyggnad', rgb: [201, 183, 141], tol: 6 },
]

export async function extractBuildings(map: Mosaic, within: P[][]): Promise<Building[]> {
  const { data, info } = await sharp(map.png).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const w = info.width
  const h = info.height
  const out: Building[] = []
  const toMap = (px: number, py: number): P => ({ x: map.origin.x + px * map.res, y: map.origin.y - py * map.res })
  for (const k of KINDS) {
    const hit = new Uint8Array(w * h)
    for (let i = 0; i < w * h; i++) {
      const d = Math.max(Math.abs(data[i * 3] - k.rgb[0]), Math.abs(data[i * 3 + 1] - k.rgb[1]), Math.abs(data[i * 3 + 2] - k.rgb[2]))
      if (d <= k.tol) hit[i] = 1
    }
    const seen = new Uint8Array(w * h)
    for (let s = 0; s < w * h; s++) {
      if (!hit[s] || seen[s]) continue
      const px: P[] = []
      const stack = [s]
      seen[s] = 1
      while (stack.length) {
        const i = stack.pop()!
        const x = i % w
        const y = (i - x) / w
        // Corners of the pixel: the rectangle is fitted to the outside of the painted area.
        px.push({ x, y }, { x: x + 1, y }, { x, y: y + 1 }, { x: x + 1, y: y + 1 })
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
          const j = ny * w + nx
          if (hit[j] && !seen[j]) {
            seen[j] = 1
            stack.push(j)
          }
        }
      }
      if (px.length < 4 * 6) continue // under 6 pixels (1.5 m²): a speck or a letter
      const r = minRect(px)
      // A building is a filled block: thin lines, text and contour edges in a similar colour are not.
      const filled = px.length / 4 / Math.max(1, r.width * r.depth)
      if (r.depth < 4 || filled < 0.55) continue
      // The painted outline sits about half a pixel inside the true edge: grow every side by that.
      const g = 0.5
      const cx = r.corners.reduce((t, p) => t + p.x, 0) / 4
      const cy = r.corners.reduce((t, p) => t + p.y, 0) / 4
      const u = { x: Math.cos(r.angle), y: Math.sin(r.angle) }
      const v = { x: -u.y, y: u.x }
      const hw = r.width / 2 + g
      const hd = r.depth / 2 + g
      const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => toMap(cx + a * hw * u.x + b * hd * v.x, cy + a * hw * u.y + b * hd * v.y))
      const width = 2 * hw * map.res
      const depth = 2 * hd * map.res
      const c = toMap(cx, cy)
      // Only buildings on the property or just beside it (a neighbour's house is context, not this plan).
      const near = within.some((ring) => ring.some((p) => Math.hypot(p.x - c.x, p.y - c.y) < 60))
      if (!near) continue
      out.push({ id: '', kind: k.kind, corners, area: Math.round(width * depth), width: Math.round(width * 10) / 10, depth: Math.round(depth * 10) / 10 })
    }
  }
  // Dwelling first, then by size; numbered for the legend.
  out.sort((a, b) => (a.kind === b.kind ? b.area - a.area : a.kind === 'bostadshus' ? -1 : 1))
  return out.map((b, i) => ({ ...b, id: `B${i + 1}` }))
}
