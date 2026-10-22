import { Resvg } from '@resvg/resvg-js'
import path from 'path'
import sharp from 'sharp'
import { wallQuad } from '../geometry'
import type { Plan, Pt } from '../types'
import { loadPng, toPx, type Raster } from './raster'

// A crop of a source drawing in plan millimetres, with a labelled mm grid
// and optionally the plan's walls drawn on top — what Claude looks at to
// read positions and to check its own tracing.

export type Rect = { x: number; y: number; w: number; h: number } // plan mm

const FONT_DIR = path.join(process.cwd(), 'lib/plan/fonts')

export type ViewOptions = {
  gridMm?: number      // grid spacing; default chosen from the crop size
  overlay?: boolean    // draw the plan's walls and openings on top
  maxPx?: number       // output size (longest side)
  view?: 'fore' | 'efter'
}

export async function scanView(planId: string, plan: Plan, r: Raster, rect: Rect, opts: ViewOptions = {}): Promise<{ png: Buffer; scale: number }> {
  const maxPx = opts.maxPx ?? 1400
  // Pixel crop of the source, clamped to the image.
  const p0 = toPx(r, { x: rect.x, y: rect.y })
  const p1 = toPx(r, { x: rect.x + rect.w, y: rect.y + rect.h })
  const left = Math.max(0, Math.floor(p0.x))
  const top = Math.max(0, Math.floor(p0.y))
  const right = Math.min(r.widthPx, Math.ceil(p1.x))
  const bottom = Math.min(r.heightPx, Math.ceil(p1.y))
  if (right - left < 2 || bottom - top < 2) throw new Error('utsnittet ligger utanför källritningen')
  // Output in mm space: the requested rect, so the grid lines up exactly.
  const k = maxPx / Math.max(rect.w, rect.h) // output px per mm
  const outW = Math.max(1, Math.round(rect.w * k))
  const outH = Math.max(1, Math.round(rect.h * k))
  const cropW = Math.max(1, Math.round((right - left) * r.mmPerPx * k))
  const cropH = Math.max(1, Math.round((bottom - top) * r.mmPerPx * k))
  const offX = Math.round((r.x + left * r.mmPerPx - rect.x) * k)
  const offY = Math.round((r.y + top * r.mmPerPx - rect.y) * k)
  // Whole source pixels overshoot the rect a little: clip to the output.
  const cl = Math.max(0, -offX)
  const ct = Math.max(0, -offY)
  const cw = Math.min(cropW - cl, outW - Math.max(0, offX))
  const ch = Math.min(cropH - ct, outH - Math.max(0, offY))
  if (cw < 1 || ch < 1) throw new Error('utsnittet ligger utanför källritningen')
  const crop = await sharp(
    await sharp(await loadPng(planId, r), { limitInputPixels: 200_000_000 })
      .extract({ left, top, width: right - left, height: bottom - top })
      .resize(cropW, cropH, { fit: 'fill' })
      .png()
      .toBuffer(),
  )
    .extract({ left: cl, top: ct, width: cw, height: ch })
    .png()
    .toBuffer()

  const svg = overlaySvg(plan, rect, k, outW, outH, opts)
  const overlay = new Resvg(svg, {
    font: { loadSystemFonts: false, fontFiles: [path.join(FONT_DIR, 'LiberationSans-Regular.ttf')], defaultFontFamily: 'Liberation Sans' },
  })
    .render()
    .asPng()
  const png = await sharp({ create: { width: outW, height: outH, channels: 3, background: '#ffffff' } })
    .composite([
      { input: crop, left: Math.max(0, offX), top: Math.max(0, offY) },
      { input: overlay, left: 0, top: 0 },
    ])
    .png()
    .toBuffer()
  return { png, scale: k }
}

function niceGrid(span: number): number {
  for (const g of [100, 200, 250, 500, 1000, 2000]) if (span / g <= 14) return g
  return 5000
}

function overlaySvg(plan: Plan, rect: Rect, k: number, w: number, h: number, opts: ViewOptions): string {
  const P = (p: Pt) => ({ x: (p.x - rect.x) * k, y: (p.y - rect.y) * k })
  const parts: string[] = []
  const grid = opts.gridMm ?? niceGrid(Math.max(rect.w, rect.h))
  for (let gx = Math.ceil(rect.x / grid) * grid; gx <= rect.x + rect.w; gx += grid) {
    const X = (gx - rect.x) * k
    const major = gx % (grid * 5) === 0
    parts.push(`<line x1="${X}" y1="0" x2="${X}" y2="${h}" stroke="#16a34a" stroke-opacity="${major ? 0.6 : 0.3}" stroke-width="1"/>`)
    parts.push(`<text x="${X + 2}" y="12" font-size="11" fill="#15803d">${gx}</text>`)
  }
  for (let gy = Math.ceil(rect.y / grid) * grid; gy <= rect.y + rect.h; gy += grid) {
    const Y = (gy - rect.y) * k
    const major = gy % (grid * 5) === 0
    parts.push(`<line x1="0" y1="${Y}" x2="${w}" y2="${Y}" stroke="#16a34a" stroke-opacity="${major ? 0.6 : 0.3}" stroke-width="1"/>`)
    parts.push(`<text x="2" y="${Y - 2}" font-size="11" fill="#15803d">${gy}</text>`)
  }
  if (opts.overlay) {
    const view = opts.view ?? 'efter'
    for (const wall of plan.walls) {
      if (view === 'fore' && wall.phase === 'new') continue
      const q = wallQuad(wall).map(P)
      const color = wall.phase === 'demolish' ? '#f59e0b' : wall.phase === 'new' ? '#2563eb' : '#dc2626'
      parts.push(`<polygon points="${q.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}" fill="${color}" fill-opacity="0.25" stroke="${color}" stroke-width="1.5"/>`)
      const mid = P({ x: (wall.a.x + wall.b.x) / 2, y: (wall.a.y + wall.b.y) / 2 })
      parts.push(`<text x="${mid.x + 3}" y="${mid.y - 3}" font-size="11" fill="${color}">${wall.id}</text>`)
    }
    for (const o of plan.openings) {
      const wall = plan.walls.find((x) => x.id === o.wallId)
      if (!wall) continue
      const len = Math.hypot(wall.b.x - wall.a.x, wall.b.y - wall.a.y) || 1
      const d = { x: (wall.b.x - wall.a.x) / len, y: (wall.b.y - wall.a.y) / len }
      const s = P({ x: wall.a.x + d.x * o.offset, y: wall.a.y + d.y * o.offset })
      const e = P({ x: wall.a.x + d.x * (o.offset + o.width), y: wall.a.y + d.y * (o.offset + o.width) })
      parts.push(`<line x1="${s.x}" y1="${s.y}" x2="${e.x}" y2="${e.y}" stroke="#7c3aed" stroke-width="4" stroke-opacity="0.8"/>`)
      if (o.kind === 'door') {
        // Leaf and swing arc as the sheet draws them, to compare with the source.
        const n = { x: d.y, y: -d.x }
        const side = (o.swing ?? 'left') === 'left' ? 1 : -1
        const atA = (o.hinge ?? 'a') === 'a'
        const t0 = atA ? o.offset : o.offset + o.width
        const t1 = atA ? o.offset + o.width : o.offset
        const hw = { x: wall.a.x + d.x * t0, y: wall.a.y + d.y * t0 }
        const fr = { x: wall.a.x + d.x * t1, y: wall.a.y + d.y * t1 }
        const leaf = { x: hw.x + n.x * side * o.width, y: hw.y + n.y * side * o.width }
        const H = P(hw)
        const Lf = P(leaf)
        const F = P(fr)
        const cross = (Lf.x - H.x) * (F.y - H.y) - (Lf.y - H.y) * (F.x - H.x)
        const r = o.width * k
        parts.push(`<line x1="${H.x}" y1="${H.y}" x2="${Lf.x}" y2="${Lf.y}" stroke="#7c3aed" stroke-width="2"/>`)
        parts.push(`<path d="M ${Lf.x} ${Lf.y} A ${r} ${r} 0 0 ${cross > 0 ? 1 : 0} ${F.x} ${F.y}" fill="none" stroke="#7c3aed" stroke-width="1.5" stroke-dasharray="6 4"/>`)
        parts.push(`<text x="${(H.x + Lf.x) / 2 + 4}" y="${(H.y + Lf.y) / 2}" font-size="11" fill="#7c3aed">${o.id}</text>`)
      }
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="Liberation Sans">${parts.join('')}</svg>`
}
