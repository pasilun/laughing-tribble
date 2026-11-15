// What does each filled room contain? For every room point's region: the annotator's boxes whose white surroundings
// fall mostly in it (labels and fixtures), and its size. A room with no evidence, or evidence with no room, is a question.
//   npx tsx scripts/wallbench/census.mts <tile> <marks.json>
import { readFileSync } from 'fs'
import { TILES, CASE, tileBits } from './common.mjs'
import { eraseInBoxes, fillRooms, distanceToInk, dropWallBodies } from './annotate.mjs'

const [tile = '154w', file] = process.argv.slice(2)
const marks = JSON.parse(readFileSync(file, 'utf8')) as { remove: Array<{ kind: string; box: number[]; what?: string }>; rooms: Array<{ name: string; at: number[] }> }
const b = await tileBits(TILES[tile])
const cleaned = eraseInBoxes(b, marks.remove.filter((r) => r.kind !== 'dashed').map((r) => r.box))
const lab = fillRooms(b.d, b.w, b.h, marks.rooms.map((r) => r.at))
dropWallBodies(lab, distanceToInk(cleaned, b.w, b.h), marks.rooms.length)

const k = CASE.mm_per_px
const area = new Map<number, number>()
for (const l of lab) if (l) area.set(l, (area.get(l) ?? 0) + 1)
const where = (box: number[]) => {
  // the room whose white pixels lie around the box: count labels in the box grown by 8 px
  const cnt = new Map<number, number>()
  const [x0, y0, x1, y1] = box
  for (let y = Math.max(0, y0 - 8); y <= Math.min(b.h - 1, y1 + 8); y++) for (let x = Math.max(0, x0 - 8); x <= Math.min(b.w - 1, x1 + 8); x++) { const l = lab[y * b.w + x]; if (l) cnt.set(l, (cnt.get(l) ?? 0) + 1) }
  return [...cnt.entries()].sort((a, c) => c[1] - a[1])[0]?.[0] ?? 0
}
const evidence = new Map<number, string[]>()
const orphan: string[] = []
for (const r of marks.remove) {
  if (r.kind === 'dashed') continue
  const l = where(r.box)
  const tag = `${r.kind}:${r.what ?? ''}`
  if (l) evidence.set(l, [...(evidence.get(l) ?? []), tag])
  else orphan.push(tag)
}
marks.rooms.forEach((r, i) => {
  const a = area.get(i + 1)
  console.log(`${String(i + 1).padStart(2)} ${r.name.padEnd(9)} ${a ? `${(a * k * k / 1e6).toFixed(1)} m²`.padEnd(8) : 'dropped '} ${(evidence.get(i + 1) ?? []).join(' | ') || '– no label or fixture –'}`)
})
if (orphan.length) console.log('evidence in no room:', orphan.join(' | '))
