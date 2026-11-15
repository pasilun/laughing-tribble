// Uses an annotator's marks (a JSON of "remove" boxes and "rooms" points, in tile px) to help the wall reader:
//  1. erase every connected piece of ink that lies wholly inside a remove box (a wall crossing a box survives);
//  2. fill the rooms from their points through white paper (all at once, so a doorway is split between the rooms);
//  3. drop walls whose two sides lie in the same room (a counter, an underline, a cupboard edge).
//   npx tsx scripts/wallbench/annotate.mts <tile> <marks.json> <out-dir>
import { readFileSync } from 'fs'
import { TILES, CASE, tileBits, toPx, picture, type Bits } from './common.mjs'
import { pairWalls, DEFAULTS } from './pairs.mjs'
import { traceTile, scoreTile, overlay } from './detect.mjs'
import { covered } from './union.mjs'
import { detectWalls } from '../../lib/plan/scan/detect.js'
import { joinPieces, mergeStacked } from '../../lib/plan/scan/pieces.js'
import type { Wall } from '../../lib/plan/domain/types.js'

type Marks = { remove: Array<{ kind: string; box: number[] }>; rooms: Array<{ name: string; at: number[] }> }

// Inside a box, ink is erased unless it belongs to a straight horizontal or vertical run (gaps ≤ 2 px bridged) that
// continues outside the box: a wall crossing the box always does; lettering, underlines and fixtures inside it do not,
// even where they touch a wall.
export function eraseInBoxes(b: Bits, boxes: number[][]): Uint8Array {
  const out = b.d.slice()
  const inBox = (x: number, y: number, [x0, y0, x1, y1]: number[]) => x >= x0 && x <= x1 && y >= y0 && y <= y1
  for (const box of boxes) {
    const [x0, y0, x1, y1] = box.map((v) => Math.round(v))
    for (let y = Math.max(0, y0); y <= Math.min(b.h - 1, y1); y++)
      for (let x = Math.max(0, x0); x <= Math.min(b.w - 1, x1); x++) {
        if (!b.d[y * b.w + x]) continue
        // walk the horizontal and the vertical run through this pixel; keep it if either leaves the box
        const leaves = (dx: number, dy: number) => {
          for (const sgn of [-1, 1]) {
            let X = x, Y = y, gap = 0
            while (true) {
              X += dx * sgn; Y += dy * sgn
              if (X < 0 || Y < 0 || X >= b.w || Y >= b.h) return true
              if (b.d[Y * b.w + X]) gap = 0
              else if (++gap > 2) break
              if (!inBox(X, Y, box) && gap === 0) return true
            }
          }
          return false
        }
        if (!leaves(1, 0) && !leaves(0, 1)) out[y * b.w + x] = 0
      }
  }
  return out
}

// Connected pieces of ink (8-neighbours) wholly inside some box are erased.
export function eraseBoxed(b: Bits, boxes: number[][]): Uint8Array {
  const out = b.d.slice()
  const seen = new Uint8Array(b.d.length)
  const stack: number[] = []
  for (let i = 0; i < b.d.length; i++) {
    if (!b.d[i] || seen[i]) continue
    const comp: number[] = []
    let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1
    stack.push(i); seen[i] = 1
    while (stack.length) {
      const j = stack.pop()!
      comp.push(j)
      const x = j % b.w, y = (j - x) / b.w
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y)
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const X = x + dx, Y = y + dy
        if (X < 0 || Y < 0 || X >= b.w || Y >= b.h) continue
        const k = Y * b.w + X
        if (b.d[k] && !seen[k]) { seen[k] = 1; stack.push(k) }
      }
    }
    if (boxes.some(([a, c, e, f]) => x0 >= a && y0 >= c && x1 <= e && y1 <= f)) for (const j of comp) out[j] = 0
  }
  return out
}

// Rooms: breadth-first from every seed at once through white pixels. Label 0 = unreached or ink.
export function fillRooms(d: Uint8Array, w: number, h: number, seeds: number[][]): Int16Array {
  const lab = new Int16Array(w * h)
  let q: number[] = []
  seeds.forEach(([x, y], n) => {
    const i = Math.round(y) * w + Math.round(x)
    if (i >= 0 && i < d.length && !d[i]) { lab[i] = n + 1; q.push(i) }
  })
  while (q.length) {
    const next: number[] = []
    for (const i of q) {
      const x = i % w, y = (i - x) / w
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const X = x + dx, Y = y + dy
        if (X < 0 || Y < 0 || X >= w || Y >= h) continue
        const k = Y * w + X
        if (!d[k] && !lab[k]) { lab[k] = lab[i]; next.push(k) }
      }
    }
    q = next
  }
  return lab
}

// A wall is between rooms unless both sides, along most of its length, lie in the same room.
export function sameRoomBothSides(b: Bits, lab: Int16Array, wl: Wall): boolean {
  const a = toPx(b, wl.a.x, wl.a.y), c = toPx(b, wl.b.x, wl.b.y)
  const vertical = Math.abs(a.x - c.x) < Math.abs(a.y - c.y)
  const n = Math.max(1, Math.round(Math.hypot(c.x - a.x, c.y - a.y) / 4))
  const reach = wl.thickness / 2 / CASE.mm_per_px + 6
  let same = 0, counted = 0
  const at = (x: number, y: number) => {
    // the first room label found walking outwards from the face, up to 10 px
    for (let s = 0; s < 10; s++) {
      const X = Math.round(x), Y = Math.round(y)
      if (X < 0 || Y < 0 || X >= b.w || Y >= b.h) return 0
      const L = lab[Y * b.w + X]
      if (L) return L
      if (vertical) x += x > (a.x + c.x) / 2 ? 1 : -1
      else y += y > (a.y + c.y) / 2 ? 1 : -1
    }
    return 0
  }
  for (let i = 0; i <= n; i++) {
    const px = a.x + ((c.x - a.x) * i) / n, py = a.y + ((c.y - a.y) * i) / n
    const l1 = vertical ? at(px - reach, py) : at(px, py - reach)
    const l2 = vertical ? at(px + reach, py) : at(px, py + reach)
    if (!l1 || !l2) continue
    counted++
    if (l1 === l2) same++
  }
  return counted >= 3 && same / counted > 0.6
}

const PALETTE: Array<[number, number, number]> = [[255, 225, 225], [225, 240, 255], [230, 255, 225], [255, 245, 210], [240, 225, 255], [215, 250, 250], [250, 230, 245], [235, 235, 210]]

if (process.argv[1]?.endsWith('annotate.mts')) {
  const [tile = '154w', marksFile, dir] = process.argv.slice(2)
  const marks = JSON.parse(readFileSync(marksFile, 'utf8')) as Marks
  const b = await tileBits(TILES[tile])
  // A dashed line can be a wall drawn with an opening: dashed boxes are not erased.
  const cleaned = eraseInBoxes(b, marks.remove.filter((r) => r.kind !== 'dashed').map((r) => r.box))
  const lab = fillRooms(cleaned, b.w, b.h, marks.rooms.map((r) => r.at))
  // Picture 1: the marks. Kept ink black, erased ink orange, rooms tinted, boxes outlined, seeds as dots.
  const edge = new Uint8Array(b.w * b.h)
  for (const { box: [x0, y0, x1, y1] } of marks.remove) for (let x = Math.max(0, x0); x <= Math.min(b.w - 1, x1); x++) for (let y = Math.max(0, y0); y <= Math.min(b.h - 1, y1); y++) if (x === x0 || x === x1 || y === y0 || y === y1) edge[y * b.w + x] = 1
  const dot = new Uint8Array(b.w * b.h)
  for (const { at: [x, y] } of marks.rooms) for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { const X = Math.round(x) + dx, Y = Math.round(y) + dy; if (X >= 0 && Y >= 0 && X < b.w && Y < b.h) dot[Y * b.w + X] = 1 }
  await picture(b.w, b.h, (i) => {
    if (dot[i]) return [200, 0, 160]
    if (edge[i]) return [0, 140, 255]
    if (b.d[i]) return cleaned[i] ? [30, 30, 30] : [245, 150, 30]
    return lab[i] ? PALETTE[(lab[i] - 1) % PALETTE.length] : [255, 255, 255]
  }, `${dir}/marks-${tile}.png`)

  // Walls: (a) as before; (b) on the cleaned ink; (c) cleaned and between rooms.
  const cb: Bits = { ...b, d: cleaned }
  const { walls: raw0, g } = await traceTile(tile, 'raw')
  const union = (pairs: Wall[], raw: Wall[]) => [...pairs, ...raw.filter((w) => !covered(w, pairs, 80, 0.5))]
  const before = union(pairWalls(b, { ...DEFAULTS, mutual: false }), raw0)
  // the old detector on the cleaned tile (pasted into a blank crop-sized image)
  const full = { w: g.w, h: g.h, data: new Uint8Array(g.w * g.h).fill(255) }
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) if (cleaned[y * b.w + x]) full.data[(b.y0 + y) * g.w + b.x0 + x] = 0
  const [tx, ty, tw, th] = TILES[tile]
  const r = { id: 'a00', mmPerPx: CASE.mm_per_px, x: CASE.x, y: CASE.y, widthPx: g.w, heightPx: g.h, src: '', rotation: 0 }
  const rawC = mergeStacked(joinPieces(detectWalls(full as never, r as never, { rect: { x: tx, y: ty, w: tw, h: th }, maxProposals: 1000 }).map((p) => ({ a: p.a, b: p.b, thickness: p.thickness })), 60))
    .filter((p) => Math.hypot(p.b.x - p.a.x, p.b.y - p.a.y) >= 1000).map((p, i): Wall => ({ id: `r${i + 1}`, ...p, phase: 'existing' }))
  const boxed = union(pairWalls(cb, { ...DEFAULTS, mutual: false }), rawC)
  const rooms = boxed.filter((w) => !sameRoomBothSides(b, lab, w))
  for (const [name, walls] of [['before (pairs + old detector)', before], ['boxes: erased ink', boxed], ['boxes + rooms', rooms]] as const) {
    const s = scoreTile(tile, walls as Wall[])
    console.log(name.padEnd(30), `${(walls as Wall[]).length} walls`, `recall100 ${s.recall['100']}`, `recall50 ${s.recall['50']}`, `precision100 ${s.precision100}`, `median ${s.medianOffsetMm}`)
  }
  await overlay(tile, rooms, full, `${dir}/rooms-${tile}.png`)
}
