import { Resvg } from '@resvg/resvg-js'
import PDFDocument from 'pdfkit'
import SVGtoPDF from 'svg-to-pdfkit'
import path from 'path'
import { add, along, leftNormal, scale, wallDir } from './geometry'
import { fireRatingIn, layoutSheet, renderSheet, visibleIn, wallPieces, VIEW_TITLE } from './sheet'
import type { Plan, Pt, View } from './types'

const FONT_DIR = path.join(process.cwd(), 'lib/plan/fonts')
const PT_PER_MM = 72 / 25.4

export function sheetSvg(plan: Plan, view: View): string {
  return renderSheet(plan, view)
}

// Vector PDF at the sheet's paper size; prints at true scale at 100%.
export async function sheetPdf(plan: Plan, views: View[]): Promise<Buffer> {
  const L = layoutSheet(plan)
  const size: [number, number] = [L.paperW * PT_PER_MM, L.paperH * PT_PER_MM]
  const doc = new PDFDocument({ size, margin: 0, autoFirstPage: false, info: { Title: `${plan.name} – ${views.map((v) => VIEW_TITLE[v]).join(', ')}` } })
  const chunks: Buffer[] = []
  doc.on('data', (c: Buffer) => chunks.push(c))
  const done = new Promise<void>((resolve) => doc.on('end', () => resolve()))
  for (const view of views) {
    doc.addPage({ size, margin: 0 })
    SVGtoPDF(doc, renderSheet(plan, view), 0, 0, {
      width: size[0],
      height: size[1],
      assumePt: false,
      fontCallback: (_family: string, bold: boolean) => (bold ? 'Helvetica-Bold' : 'Helvetica'),
    })
  }
  doc.end()
  await done
  return Buffer.concat(chunks)
}

export function sheetPng(plan: Plan, view: View, width = 2000, underlay = false): Buffer {
  const svg = renderSheet(plan, view, { underlay })
  return new Resvg(svg, {
    fitTo: { mode: 'width', value: width },
    font: {
      loadSystemFonts: false,
      fontFiles: [path.join(FONT_DIR, 'LiberationSans-Regular.ttf'), path.join(FONT_DIR, 'LiberationSans-Bold.ttf')],
      defaultFontFamily: 'Liberation Sans',
      sansSerifFamily: 'Liberation Sans',
    },
  })
    .render()
    .asPng()
}

// ── DXF (R12, model space 1:1 in millimetres) ──────────────────────────────
// For consultants who draw on top of the plan. Y is flipped (DXF is y-up).

const LAYERS: Array<[string, number, string]> = [
  ['A-VAGG-BEF', 8, 'CONTINUOUS'],
  ['A-VAGG-BARANDE', 1, 'CONTINUOUS'],
  ['A-VAGG-NY', 7, 'CONTINUOUS'],
  ['A-VAGG-RIV', 6, 'DASHED'],
  ['A-OPPNING', 4, 'CONTINUOUS'],
  ['A-INREDNING', 3, 'CONTINUOUS'],
  ['A-INREDNING-RIV', 6, 'DASHED'],
  ['A-BRAND', 1, 'DASHDOT'],
  ['A-TEXT', 7, 'CONTINUOUS'],
  ['A-MATT', 2, 'CONTINUOUS'],
]

export function planDxf(plan: Plan, view: View): Buffer {
  const out: Array<string | number> = []
  const g = (...pairs: Array<string | number>) => out.push(...pairs)
  const P = (p: Pt) => ({ x: p.x, y: -p.y })
  const lineE = (layer: string, a: Pt, b: Pt) => {
    const p = P(a)
    const q = P(b)
    g(0, 'LINE', 8, layer, 10, p.x, 20, p.y, 30, 0, 11, q.x, 21, q.y, 31, 0)
  }
  const polyE = (layer: string, pts: Pt[]) => pts.forEach((p, i) => lineE(layer, p, pts[(i + 1) % pts.length]))
  const textH = 2.5 * plan.sheet.scale
  const textE = (layer: string, at: Pt, s: string, h = textH, rot = 0) => {
    const p = P(at)
    g(0, 'TEXT', 8, layer, 10, p.x, 20, p.y, 30, 0, 40, h, 1, s, 50, rot, 72, 1, 11, p.x, 21, p.y, 31, 0)
  }
  const circleE = (layer: string, c: Pt, r: number) => {
    const p = P(c)
    g(0, 'CIRCLE', 8, layer, 10, p.x, 20, p.y, 30, 0, 40, r)
  }
  const arcE = (layer: string, c: Pt, r: number, from: number, to: number) => {
    const p = P(c)
    g(0, 'ARC', 8, layer, 10, p.x, 20, p.y, 30, 0, 40, r, 50, from, 51, to)
  }

  g(0, 'SECTION', 2, 'HEADER', 9, '$ACADVER', 1, 'AC1009', 9, '$INSUNITS', 70, 4, 9, '$DWGCODEPAGE', 3, 'ANSI_1252', 0, 'ENDSEC')
  g(0, 'SECTION', 2, 'TABLES')
  g(0, 'TABLE', 2, 'LTYPE', 70, 3)
  g(0, 'LTYPE', 2, 'CONTINUOUS', 70, 0, 3, 'Solid line', 72, 65, 73, 0, 40, 0)
  g(0, 'LTYPE', 2, 'DASHED', 70, 0, 3, '__ __ __', 72, 65, 73, 2, 40, 450, 49, 300, 49, -150)
  g(0, 'LTYPE', 2, 'DASHDOT', 70, 0, 3, '__ . __ .', 72, 65, 73, 4, 40, 600, 49, 400, 49, -100, 49, 0, 49, -100)
  g(0, 'ENDTAB')
  g(0, 'TABLE', 2, 'LAYER', 70, LAYERS.length)
  for (const [name, color, lt] of LAYERS) g(0, 'LAYER', 2, name, 70, 0, 62, color, 6, lt)
  g(0, 'ENDTAB', 0, 'ENDSEC')
  g(0, 'SECTION', 2, 'ENTITIES')

  for (const piece of wallPieces(plan, view)) {
    const layer = piece.style === 'demolish' ? 'A-VAGG-RIV' : piece.style === 'new' ? 'A-VAGG-NY' : piece.wall.loadBearing ? 'A-VAGG-BARANDE' : 'A-VAGG-BEF'
    polyE(layer, piece.quad)
  }
  for (const o of plan.openings) {
    if ((view === 'fore' && o.phase === 'new') || (view === 'efter' && o.phase === 'demolish')) continue
    const w = plan.walls.find((x) => x.id === o.wallId)
    if (!w) continue
    const n = leftNormal(wallDir(w))
    const half = w.thickness / 2
    const s = along(w, o.offset)
    const e = along(w, o.offset + o.width)
    if (o.kind === 'door') {
      const side = (o.swing ?? 'left') === 'left' ? 1 : -1
      const hingeAtA = (o.hinge ?? 'a') === 'a'
      const hinge = add(hingeAtA ? s : e, scale(n, side * half))
      const leafEnd = add(hinge, scale(n, side * o.width))
      lineE('A-OPPNING', hinge, leafEnd)
      const free = add(hingeAtA ? e : s, scale(n, side * half))
      const h = P(hinge)
      const a1 = (Math.atan2(P(leafEnd).y - h.y, P(leafEnd).x - h.x) * 180) / Math.PI
      const a2 = (Math.atan2(P(free).y - h.y, P(free).x - h.x) * 180) / Math.PI
      // DXF arcs run counter-clockwise; pick the quarter between leaf and closed position.
      const ccw = ((a2 - a1 + 360) % 360) <= 180
      arcE('A-OPPNING', hinge, o.width, ccw ? a1 : a2, ccw ? a2 : a1)
    } else {
      lineE('A-OPPNING', add(s, scale(n, half)), add(e, scale(n, half)))
      lineE('A-OPPNING', add(s, scale(n, -half)), add(e, scale(n, -half)))
      if (o.kind === 'window') lineE('A-OPPNING', s, e)
    }
  }
  for (const fx of plan.fixtures) {
    if (!visibleIn(fx.phase, view)) continue
    const layer = view === 'efter' && fx.phase === 'demolish' ? 'A-INREDNING-RIV' : 'A-INREDNING'
    const c = { x: fx.x, y: fx.y }
    if (fx.kind === 'exhaust' || fx.kind === 'plug') circleE(layer, c, Math.max(fx.w, fx.d) / 2)
    else {
      const r = ((fx.rotation ?? 0) * Math.PI) / 180
      const rot = (p: Pt) => ({ x: c.x + p.x * Math.cos(r) - p.y * Math.sin(r), y: c.y + p.x * Math.sin(r) + p.y * Math.cos(r) })
      polyE(layer, [rot({ x: -fx.w / 2, y: -fx.d / 2 }), rot({ x: fx.w / 2, y: -fx.d / 2 }), rot({ x: fx.w / 2, y: fx.d / 2 }), rot({ x: -fx.w / 2, y: fx.d / 2 })])
    }
    if (fx.label) textE('A-TEXT', c, fx.label, textH * 0.8)
  }
  for (const w of plan.walls) {
    const rating = fireRatingIn(w, view)
    if (!rating || !visibleIn(w.phase, view) || (view === 'efter' && w.phase === 'demolish')) continue
    const off = scale(leftNormal(wallDir(w)), w.thickness / 2 + 60)
    lineE('A-BRAND', add(w.a, off), add(w.b, off))
    textE('A-TEXT', add(scale(add(w.a, w.b), 0.5), scale(off, 4)), rating)
  }
  for (const r of plan.rooms) textE('A-TEXT', r.at, view === 'efter' && r.renamed ? r.renamed : r.name, textH * 1.2)
  for (const dm of plan.dimensions) {
    const n = leftNormal(wallDir({ id: '', a: dm.a, b: dm.b, thickness: 0, phase: 'existing' }))
    const a = add(dm.a, scale(n, dm.offset))
    const b = add(dm.b, scale(n, dm.offset))
    lineE('A-MATT', dm.a, a)
    lineE('A-MATT', dm.b, b)
    lineE('A-MATT', a, b)
    textE('A-MATT', add(scale(add(a, b), 0.5), scale(n, textH)), String(Math.round(Math.hypot(dm.b.x - dm.a.x, dm.b.y - dm.a.y))))
  }
  g(0, 'ENDSEC', 0, 'EOF')
  // R12 files are ANSI (Windows-1252); å, ä, ö are the same code points in latin1.
  return Buffer.from(out.map((v) => (typeof v === 'number' ? String(Math.round(v * 1000) / 1000) : v)).join('\r\n') + '\r\n', 'latin1')
}
