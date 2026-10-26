// Generates the golden "known drawing" in e2e/fixtures/golden/: a made-up
// three-room flat (reference.json) drawn the way archive plans are drawn –
// heavy walls filled, partitions outlined, doors as leaf and arc, windows as
// glass lines, plus dimensions, labels and fixtures as clutter – and its
// north facade seen from outside. e2e/plan-golden.spec.ts builds a plan
// from these with the scan tools and scores it against reference.json.
// Run: npx tsx scripts/make-golden.ts
import { writeFileSync } from 'node:fs'
import sharp from 'sharp'
import { leftNormal, wallDir, wallSegments } from '../lib/plan/geometry'
import type { Plan, Pt, Wall } from '../lib/plan/types'

const DIR = 'e2e/fixtures/golden'
const MM_PER_PX = 8.467 // 1:100 at 300 dpi
const ORIGIN = { x: -1000, y: -1000 } // plan mm of the drawing's top-left
const SIZE = { w: 11000, h: 9000 }

const reference: Plan = {
  id: 'golden',
  name: 'Golden – trea',
  sheet: {
    paper: 'A3',
    orientation: 'landscape',
    scale: 50,
    northAngle: 0,
    titleBlock: { project: 'Golden', property: 'Exempel 1', address: 'Exempelgatan 1', apartments: 'Lgh 1001', floor: 'Plan 1 tr', drawingNumber: 'A-01', author: 'Exempel', date: '2026-10-26', revision: '' },
  },
  walls: [
    { id: 'yt-n', a: { x: 0, y: 0 }, b: { x: 9000, y: 0 }, thickness: 450, phase: 'existing', exterior: true, loadBearing: true },
    { id: 'yt-s', a: { x: 0, y: 6500 }, b: { x: 9000, y: 6500 }, thickness: 450, phase: 'existing', exterior: true, loadBearing: true },
    { id: 'trapp', a: { x: 0, y: 0 }, b: { x: 0, y: 6500 }, thickness: 300, phase: 'existing', loadBearing: true },
    { id: 'gavel', a: { x: 9000, y: 0 }, b: { x: 9000, y: 6500 }, thickness: 300, phase: 'existing', loadBearing: true },
    { id: 'hall-n', a: { x: 0, y: 3800 }, b: { x: 9000, y: 3800 }, thickness: 120, phase: 'existing' },
    { id: 'rum-mellan', a: { x: 4500, y: 0 }, b: { x: 4500, y: 3800 }, thickness: 120, phase: 'existing' },
    { id: 'bad-v', a: { x: 3000, y: 3800 }, b: { x: 3000, y: 6500 }, thickness: 100, phase: 'existing' },
    { id: 'kok-v', a: { x: 5000, y: 3800 }, b: { x: 5000, y: 6500 }, thickness: 120, phase: 'existing' },
  ],
  openings: [
    { id: 'd-entre', wallId: 'trapp', kind: 'door', offset: 4600, width: 900, phase: 'existing', hinge: 'b', swing: 'left' },
    { id: 'd-vardag', wallId: 'hall-n', kind: 'door', offset: 1300, width: 800, phase: 'existing', hinge: 'a', swing: 'left' },
    { id: 'd-sovrum', wallId: 'hall-n', kind: 'door', offset: 6600, width: 800, phase: 'existing', hinge: 'b', swing: 'left' },
    { id: 'd-bad', wallId: 'bad-v', kind: 'door', offset: 1000, width: 700, phase: 'existing', hinge: 'a', swing: 'left' },
    { id: 'o-kok', wallId: 'kok-v', kind: 'opening', offset: 700, width: 1000, phase: 'existing', through: true },
    { id: 'f-1', wallId: 'yt-n', kind: 'window', offset: 1000, width: 1200, phase: 'existing' },
    { id: 'f-2', wallId: 'yt-n', kind: 'window', offset: 2800, width: 1200, phase: 'existing' },
    { id: 'f-3', wallId: 'yt-n', kind: 'window', offset: 6100, width: 1200, phase: 'existing' },
    { id: 'f-4', wallId: 'yt-s', kind: 'window', offset: 6400, width: 1200, phase: 'existing' },
  ],
  fixtures: [],
  rooms: [
    { id: 'r-vardag', name: 'Vardagsrum', at: { x: 2250, y: 1900 } },
    { id: 'r-sovrum', name: 'Sovrum', at: { x: 6750, y: 1900 } },
    { id: 'r-hall', name: 'Hall', at: { x: 1500, y: 5150 } },
    { id: 'r-bad', name: 'Bad', at: { x: 4000, y: 5150 } },
    { id: 'r-kok', name: 'Kök', at: { x: 7000, y: 5150 } },
  ],
  dimensions: [],
  notes: [],
} as unknown as Plan

// Heavy walls run on past their centreline end to the outer face of the wall they meet.
const HEAVY: Record<string, number> = { 'yt-n': 150, 'yt-s': 150, trapp: 225, gavel: 225 }

const px = (v: number) => (v / MM_PER_PX).toFixed(2)
const P = (p: Pt) => `${px(p.x - ORIGIN.x)},${px(p.y - ORIGIN.y)}`
const LW = px(30) // 0.3 mm pen at 1:100
const THIN = px(15)

function quad(w: Wall, s: number, e: number, inset = 0): Pt[] {
  const d = wallDir(w)
  const n = leftNormal(d)
  const t = w.thickness / 2 - inset
  const at = (u: number, k: number) => ({ x: w.a.x + d.x * u + n.x * k, y: w.a.y + d.y * u + n.y * k })
  return [at(s, t), at(e, t), at(e, -t), at(s, -t)]
}
const poly = (q: Pt[], style: string) => `<polygon points="${q.map(P).join(' ')}" ${style}/>`
const line = (a: Pt, b: Pt, w = LW) => `<line x1="${px(a.x - ORIGIN.x)}" y1="${px(a.y - ORIGIN.y)}" x2="${px(b.x - ORIGIN.x)}" y2="${px(b.y - ORIGIN.y)}" stroke="#000" stroke-width="${w}"/>`

function drawing(plan: Plan): string {
  const out: string[] = []
  const len = (w: Wall) => Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y)
  const segs = (w: Wall) => {
    const ext = HEAVY[w.id] ?? 0
    return wallSegments(w, plan.openings.filter((o) => o.wallId === w.id)).map(([s, e]) => [s === 0 ? -ext : s, e >= len(w) ? e + ext : e] as [number, number])
  }
  const light = plan.walls.filter((w) => !(w.id in HEAVY))
  // Partitions: outlines, then their insides blanked so joins stay open.
  for (const w of light) for (const [s, e] of segs(w)) out.push(poly(quad(w, s, e), `fill="none" stroke="#000" stroke-width="${LW}"`))
  for (const w of light) for (const [s, e] of segs(w)) out.push(poly(quad(w, s + (s > 0 ? 15 : -60), e - (e < len(w) ? 15 : -60), 15), 'fill="#fff"'))
  for (const w of plan.walls.filter((w) => w.id in HEAVY)) for (const [s, e] of segs(w)) out.push(poly(quad(w, s, e), 'fill="#000"'))
  for (const o of plan.openings) {
    const w = plan.walls.find((x) => x.id === o.wallId)!
    const d = wallDir(w)
    const n = leftNormal(d)
    const at = (u: number, k: number) => ({ x: w.a.x + d.x * u + n.x * k, y: w.a.y + d.y * u + n.y * k })
    if (o.kind === 'window') {
      // Glass lines and the reveal ends.
      for (const k of [-40, 40]) out.push(line(at(o.offset, k), at(o.offset + o.width, k), THIN))
      continue
    }
    if (o.kind !== 'door') continue
    // Leaf open 90° on the swing side, arc back to the free jamb.
    const side = o.swing === 'right' ? -1 : 1
    const t = (w.thickness / 2) * side
    const hingeU = o.hinge === 'b' ? o.offset + o.width : o.offset
    const freeU = o.hinge === 'b' ? o.offset : o.offset + o.width
    const h = at(hingeU, t)
    const f = at(freeU, t)
    const tip = { x: h.x + n.x * side * o.width, y: h.y + n.y * side * o.width }
    const r = px(o.width)
    const cross = (tip.x - h.x) * (f.y - h.y) - (tip.y - h.y) * (f.x - h.x)
    out.push(line(h, tip))
    out.push(`<path d="M ${P(tip)} A ${r} ${r} 0 0 ${cross > 0 ? 1 : 0} ${P(f)}" fill="none" stroke="#000" stroke-width="${THIN}"/>`)
  }
  // Clutter that is not walls: a dimension chain with ticks, room "labels",
  // a bath tub, a stove, a scale bar.
  const dimY = 7300
  out.push(line({ x: 0, y: dimY }, { x: 9000, y: dimY }, THIN))
  for (const x of [0, 3000, 5000, 9000]) out.push(line({ x: x - 80, y: dimY + 80 }, { x: x + 80, y: dimY - 80 }, THIN))
  for (const r of plan.rooms) for (let i = 0; i < 4; i++) out.push(`<rect x="${px(r.at.x - 400 + i * 220 - ORIGIN.x)}" y="${px(r.at.y - 90 - ORIGIN.y)}" width="${px(160)}" height="${px(180)}" fill="#000"/>`)
  out.push(`<rect x="${px(3200 - ORIGIN.x)}" y="${px(5550 - ORIGIN.y)}" width="${px(1600)}" height="${px(700)}" rx="${px(150)}" fill="none" stroke="#000" stroke-width="${THIN}"/>`)
  out.push(`<rect x="${px(8100 - ORIGIN.x)}" y="${px(4100 - ORIGIN.y)}" width="${px(600)}" height="${px(600)}" fill="none" stroke="#000" stroke-width="${THIN}"/>`)
  out.push(`<rect x="${px(500 - ORIGIN.x)}" y="${px(7700 - ORIGIN.y)}" width="${px(5000)}" height="${px(60)}" fill="#000"/>`)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px(SIZE.w)}" height="${px(SIZE.h)}"><rect width="100%" height="100%" fill="#fff"/>${out.join('')}</svg>`
}

// North facade seen from outside: facade x 0 is the building's east end
// (plan x 9150), facade x 9300 its west end (plan x -150). Two floors with
// the same windows; ours is the lower row (y 4000–5500 in facade mm).
function facade(plan: Plan): { svg: string; band: { y0: number; y1: number }; anchors: Array<{ facade_x: number; plan: Pt }> } {
  const W = 9300
  const fx = (planX: number) => 9150 - planX
  const out: string[] = []
  const lpx = (v: number) => (v / MM_PER_PX).toFixed(2)
  const rect = (x: number, y: number, w: number, h: number, sw: string) => `<rect x="${lpx(x + 500)}" y="${lpx(y + 500)}" width="${lpx(w)}" height="${lpx(h)}" fill="none" stroke="#000" stroke-width="${sw}"/>`
  out.push(rect(0, 0, W, 7000, LW))
  for (const floor of [500, 4000]) {
    for (const o of plan.openings.filter((x) => x.wallId === 'yt-n')) {
      const x0 = fx(o.offset + o.width)
      out.push(rect(x0, floor, o.width, 1500, px(25)))
      out.push(rect(x0 + 60, floor + 60, o.width - 120, 1380, THIN))
      out.push(`<line x1="${lpx(x0 + o.width / 2 + 500)}" y1="${lpx(floor + 500)}" x2="${lpx(x0 + o.width / 2 + 500)}" y2="${lpx(floor + 2000)}" stroke="#000" stroke-width="${THIN}"/>`)
    }
  }
  let seed = 11
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  for (let i = 0; i < 800; i++) out.push(`<rect x="${lpx(500 + rnd() * W)}" y="${lpx(500 + 3500 + rnd() * 2500)}" width="1.5" height="1.5" fill="#000"/>`)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${lpx(W + 1000)}" height="${lpx(8000)}"><rect width="100%" height="100%" fill="#fff"/>${out.join('')}</svg>`
  // Facade mm with the source placed at (-500, -500): drawing x = facade x.
  return { svg, band: { y0: 3700, y1: 5800 }, anchors: [{ facade_x: 0, plan: { x: 9150, y: 0 } }, { facade_x: W, plan: { x: -150, y: 0 } }] }
}

async function main() {
  writeFileSync(`${DIR}/reference.json`, JSON.stringify(reference, null, 1) + '\n')
  await sharp(Buffer.from(drawing(reference))).grayscale().png({ palette: true, colours: 2 }).toFile(`${DIR}/drawing.png`)
  const f = facade(reference)
  await sharp(Buffer.from(f.svg)).grayscale().png({ palette: true, colours: 2 }).toFile(`${DIR}/facade-n.png`)
  const kase = {
    // The flat, as Claude would mark it off the drawing: dimensions and the scale bar outside.
    drawing: { file: 'drawing.png', mm_per_px: MM_PER_PX, x: ORIGIN.x, y: ORIGIN.y, rect: { x: -500, y: -500, w: 10000, h: 7500 } },
    // Facades (street and yard): points on those walls. Their openings are windows.
    exterior: [{ x: 4500, y: 0 }, { x: 4500, y: 6500 }],
    facade: { file: 'facade-n.png', mm_per_px: MM_PER_PX, x: -500, y: -500, band: f.band, anchors: f.anchors },
  }
  writeFileSync(`${DIR}/case.json`, JSON.stringify(kase, null, 1) + '\n')
  console.log('wrote', DIR)
}
main()
