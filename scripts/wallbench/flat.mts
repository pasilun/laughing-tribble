// The wall reader on a whole flat, from confirmed rooms (step 1): regions by the engine, the flat's rooms chosen by number,
// then (2) the wall network only as ink (lettering, specks, thin lines left out), (3) pairing + the old detector,
// (4) room rules on every region, (5) only walls with one of the flat's rooms on a side. Scored against the fixture's
// walls of the same flat (chosen by the same side test).
//   npx tsx scripts/wallbench/flat.mts <x> <y> <w> <h> <rooms.json> <out-dir>
import { readFileSync } from 'fs'
import sharp from 'sharp'
import { CASE, FIXTURE, toPx, picture, type Bits } from './common.mjs'
import { computeRegions } from './regions.mjs'
import { pairWalls, DEFAULTS } from './pairs.mjs'
import { covered } from './union.mjs'
import { detectWalls } from '../../lib/plan/scan/detect.js'
import { joinPieces, mergeStacked } from '../../lib/plan/scan/pieces.js'
import { scorePlan } from '../../lib/plan/bench/score.js'
import type { Plan, Wall } from '../../lib/plan/domain/types.js'

const [xs, ys, ws, hs, roomsFile, dir] = process.argv.slice(2)
const [X0, Y0, W0, H0] = [xs, ys, ws, hs].map(Number)
const conf = JSON.parse(readFileSync(roomsFile, 'utf8')) as { rooms: Array<{ name: string; regions: number[] }>; not_this_flat?: Record<string, number[]> }
// Regions step 1 calls wall bodies (the white between the two outlines of a thick wall) are not spaces.
const bodies = new Set(conf.not_this_flat?.['wall bodies'] ?? [])
const { b, lab, regions, walls } = await computeRegions(X0, Y0, W0, H0)
const k = CASE.mm_per_px

// Every kept region is a space with its own label (its number); the flat's rooms are the numbers chosen in step 1.
const byRoot = new Map(regions.map((r) => [r.id, r.n]))
const space = new Int16Array(b.w * b.h)
const roomOf = new Map<number, string>()
for (const r of conf.rooms) for (const n of r.regions) roomOf.set(n, r.name)
// Spaces are compared as rooms: the regions of one confirmed room share one label (the first region's number), so a
// line between two regions of the same room (a label's underline across the hall) has the same room on both sides.
const roomLabel = new Map<number, number>()
for (const r of conf.rooms) for (const n of r.regions) roomLabel.set(n, r.regions[0])
for (let i = 0; i < space.length; i++) { const n = byRoot.get(lab[i]) ?? 0; space[i] = bodies.has(n) ? 0 : roomLabel.get(n) ?? n }
const flatSpaces = new Set(conf.rooms.map((r) => r.regions[0]))

// What lies on each side of a wall (first space label met walking out from each face, up to 12 px), along its length.
function sides(wl: Wall) {
  const a = toPx(b, wl.a.x, wl.a.y), c = toPx(b, wl.b.x, wl.b.y)
  const vertical = Math.abs(a.x - c.x) < Math.abs(a.y - c.y)
  const n = Math.max(2, Math.round(Math.hypot(c.x - a.x, c.y - a.y) / 4))
  const half = wl.thickness / 2 / k
  const walk = (x: number, y: number, dx: number, dy: number) => {
    for (let s = 0; s < 12; s++) {
      const X = Math.round(x + dx * s), Y = Math.round(y + dy * s)
      if (X < 0 || Y < 0 || X >= b.w || Y >= b.h) return 0
      const L = space[Y * b.w + X]
      if (L) return L
    }
    return 0
  }
  const left: number[] = [], right: number[] = [], centre: number[] = []
  for (let i = 0; i <= n; i++) {
    const px = a.x + ((c.x - a.x) * i) / n, py = a.y + ((c.y - a.y) * i) / n
    if (px < 0 || py < 0 || px >= b.w || py >= b.h) continue
    centre.push(space[Math.round(py) * b.w + Math.round(px)])
    if (vertical) { left.push(walk(px - half - 1, py, -1, 0)); right.push(walk(px + half + 1, py, 1, 0)) }
    else { left.push(walk(px, py - half - 1, 0, -1)); right.push(walk(px, py + half + 1, 0, 1)) }
  }
  return { left, right, centre }
}
const share = (xs: number[], f: (v: number) => boolean) => (xs.length ? xs.filter(f).length / xs.length : 0)
function verdict(wl: Wall): 'inside' | 'same' | 'other' | 'keep' {
  const { left, right, centre } = sides(wl)
  if (share(centre, (v) => v > 0) > 0.5) return 'inside'
  const both = left.map((l, i) => (l && l === right[i] ? 1 : 0))
  if (share(both, (v) => v === 1) > 0.6) return 'same'
  if (share(left, (v) => flatSpaces.has(v)) < 0.3 && share(right, (v) => flatSpaces.has(v)) < 0.3) return 'other'
  return 'keep'
}

// Cut a candidate wherever it runs inside one room (centre and both sides the same space; in a doorway the two sides are
// different rooms, so a wall with a door is not cut there) and keep the pieces between that are at least 1 m long.
function trimToRooms(wl: Wall): Wall[] {
  const { left, right, centre } = sides(wl)
  const n = centre.length
  if (!n) return []
  const inside = centre.map((c, i) => c > 0 && left[i] === c && right[i] === c)
  const len = Math.hypot(wl.b.x - wl.a.x, wl.b.y - wl.a.y)
  const at = (t: number) => ({ x: Math.round(wl.a.x + ((wl.b.x - wl.a.x) * t) / (n - 1 || 1)), y: Math.round(wl.a.y + ((wl.b.y - wl.a.y) * t) / (n - 1 || 1)) })
  const out: Wall[] = []
  let start = -1
  for (let i = 0; i <= n; i++) {
    if (i < n && !inside[i]) { if (start < 0) start = i; continue }
    if (start >= 0) {
      const piece = { ...wl, id: `${wl.id}.${out.length + 1}`, a: at(start), b: at(i - 1) }
      if ((len * (i - 1 - start)) / (n - 1 || 1) >= 1000) out.push(piece)
      start = -1
    }
  }
  return out
}

// Wall finders on a bit image of the tile: pairing, plus the old detector where pairing has nothing.
async function find(bits: Uint8Array): Promise<Wall[]> {
  const bb: Bits = { ...b, d: bits }
  const pairs = pairWalls(bb, { ...DEFAULTS, mutual: false })
  const full = { w: 1411, h: 1740, data: new Uint8Array(1411 * 1740).fill(255) }
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) if (bits[y * b.w + x]) full.data[(b.y0 + y) * full.w + b.x0 + x] = 0
  const r = { id: 'a00', mmPerPx: k, x: CASE.x, y: CASE.y, widthPx: full.w, heightPx: full.h, src: '', rotation: 0 }
  const raw = mergeStacked(joinPieces(detectWalls(full as never, r as never, { rect: { x: X0, y: Y0, w: W0, h: H0 }, maxProposals: 1000 }).map((p) => ({ a: p.a, b: p.b, thickness: p.thickness })), 60))
    .filter((p) => Math.hypot(p.b.x - p.a.x, p.b.y - p.a.y) >= 1000).map((p, i): Wall => ({ id: `r${i + 1}`, ...p, phase: 'existing' }))
  return [...pairs, ...raw.filter((w) => !covered(w, pairs, 80, 0.5))]
}

// The reference: the fixture's walls with one of the flat's rooms on a side, clipped to the tile.
const B = { x0: X0, x1: X0 + W0, y0: Y0, y1: Y0 + H0 }
const cl = (v: number, a: number, c: number) => Math.min(c, Math.max(a, v))
const clip = (ws: Wall[]) => ws.filter((q) => !(Math.max(q.a.x, q.b.x) < B.x0 || Math.min(q.a.x, q.b.x) > B.x1 || Math.max(q.a.y, q.b.y) < B.y0 || Math.min(q.a.y, q.b.y) > B.y1)).map((q) => ({ ...q, a: { x: cl(q.a.x, B.x0, B.x1), y: cl(q.a.y, B.y0, B.y1) }, b: { x: cl(q.b.x, B.x0, B.x1), y: cl(q.b.y, B.y0, B.y1) } }))
const ref = clip(FIXTURE.walls).filter((w) => verdict(w) === 'keep' || verdict(w) === 'inside')
const score = (ws: Wall[]) => scorePlan({ ...FIXTURE, walls: ref, openings: [] } as Plan, { ...FIXTURE, walls: ws, openings: [] } as Plan, { minWallMm: 300 }).walls
const show = (name: string, ws: Wall[]) => { const s = score(ws); console.log(name.padEnd(42), `${String(ws.length).padStart(2)} walls  recall100 ${s.recall['100']}  recall50 ${s.recall['50']}  precision100 ${s.precision100}  median ${s.medianOffsetMm}`) }

console.log(`flat: ${conf.rooms.length} rooms on ${flatSpaces.size} regions; reference: ${ref.length} fixture walls of the flat`)
const rawWalls = clip(await find(b.d)).filter((w) => verdict(w) === 'keep')
show('raw drawing, walls of the flat', rawWalls)
const netWalls = clip(await find(walls))
show('wall network only, no room rules', netWalls.filter((w) => verdict(w) !== 'other'))
const ruled = netWalls.filter((w) => verdict(w) === 'keep')
show('wall network + room rules', ruled)
show('+ cut where a wall runs inside a room', netWalls.flatMap(trimToRooms).filter((w) => verdict(w) === 'keep'))
const kept = ruled
if (process.env.DEBUG) for (const w of kept) {
  const { left, right, centre } = sides(w)
  const top = (xs: number[]) => { const m = new Map<number, number>(); for (const v of xs) m.set(v, (m.get(v) ?? 0) + 1); return [...m.entries()].sort((p, q) => q[1] - p[1]).slice(0, 2).map(([v, c]) => `${roomOf.get(v) ?? v}:${Math.round((100 * c) / xs.length)}%`).join(' ') }
  const ok = covered(w, ref, 100, 0.5)
  console.log(`${ok ? 'REAL ' : 'FALSE'} (${Math.round(w.a.x)},${Math.round(w.a.y)})→(${Math.round(w.b.x)},${Math.round(w.b.y)}) tj ${w.thickness} | left ${top(left)} | right ${top(right)} | centre ${top(centre)}`)
}
const why = netWalls.map((w) => verdict(w))
console.log('dropped:', ['inside', 'same', 'other'].map((v) => `${v} ${why.filter((x) => x === v).length}`).join(', '))

// Picture: the flat's rooms tinted, other spaces grey, ink black/grey, fixture walls green, kept walls red.
const S = 1.6
const W = Math.round(b.w * S), H = Math.round(b.h * S)
const tint = (n: number): [number, number, number] => { const t = (n * 0.61803) % 1; const f = (o: number) => Math.round(255 * (0.8 + 0.18 * Math.cos(2 * Math.PI * (t + o / 3)))); return [f(0), f(1), f(2)] }
await picture(b.w, b.h, (i) => {
  if (walls[i]) return [40, 40, 40]
  if (b.d[i]) return [175, 175, 175]
  const sp = space[i]
  if (sp && flatSpaces.has(sp)) return tint(conf.rooms.findIndex((r) => r.regions[0] === sp) + 1)
  if (sp) return [236, 236, 236]
  return [255, 255, 255]
}, `${dir}/flat-base.png`, S)
const X = (mm: number) => (((mm - CASE.x) / k - b.x0) * S).toFixed(1), Y = (mm: number) => (((mm - CASE.y) / k - b.y0) * S).toFixed(1)
const line = (w: Wall, col: string, wd: number) => `<line x1="${X(w.a.x)}" y1="${Y(w.a.y)}" x2="${X(w.b.x)}" y2="${Y(w.b.y)}" stroke="${col}" stroke-width="${wd}" stroke-linecap="round" opacity="0.85"/>`
const names = conf.rooms.map((r) => { const reg = regions.find((q) => q.n === r.regions[0])!; return `<text x="${X(reg.at[0])}" y="${Y(reg.at[1])}" font-size="18" font-weight="bold" font-family="sans-serif" text-anchor="middle" fill="#333" stroke="#fff" stroke-width="3" paint-order="stroke">${r.name}</text>` })
const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${ref.map((w) => line(w, '#1a9a3a', 7)).join('')}${kept.map((w) => line(w, '#e01010', 3)).join('')}${names.join('')}</svg>`)
await sharp(`${dir}/flat-base.png`).composite([{ input: svg }]).png().toFile(`${dir}/flat-walls.png`)
