// Pairs first, then the old detector's walls where no paired wall already covers them. Scores all four tiles.
//   npx tsx scripts/wallbench/union.mts [out-dir]
import { TILES, tileBits } from './common.mjs'
import { traceTile, scoreTile, overlay } from './detect.mjs'
import { pairWalls, DEFAULTS } from './pairs.mjs'
import type { Wall } from '../../lib/plan/domain/types.js'

const vertical = (w: Wall) => Math.abs(w.b.x - w.a.x) < Math.abs(w.b.y - w.a.y)
const cen = (w: Wall) => (vertical(w) ? (w.a.x + w.b.x) / 2 : (w.a.y + w.b.y) / 2)
const span = (w: Wall): [number, number] => (vertical(w) ? [Math.min(w.a.y, w.b.y), Math.max(w.a.y, w.b.y)] : [Math.min(w.a.x, w.b.x), Math.max(w.a.x, w.b.x)])
// Covered: a wall on the same axis, centre within `tol`, overlapping at least `share` of this one's length.
export function covered(w: Wall, others: Wall[], tol: number, share: number) {
  const [a, b] = span(w)
  return others.some((o) => {
    if (vertical(o) !== vertical(w) || Math.abs(cen(o) - cen(w)) > Math.max(tol, o.thickness / 2)) return false
    const [c, d] = span(o)
    return Math.min(b, d) - Math.max(a, c) >= share * (b - a)
  })
}

export async function unionTile(tile: string) {
  const b = await tileBits(TILES[tile])
  const pairs = pairWalls(b, { ...DEFAULTS, mutual: false })
  const { walls: raw, g } = await traceTile(tile, 'raw')
  return { walls: [...pairs, ...raw.filter((w) => !covered(w, pairs, 80, 0.5))], pairs, raw, g }
}

if (process.argv[1]?.endsWith('union.mts')) {
  const dir = process.argv[2]
  let n = 0
  for (const t of Object.keys(TILES)) {
    const { walls, pairs, raw, g } = await unionTile(t)
    const s = scoreTile(t, walls)
    console.log(t.padEnd(8), 'union', `${pairs.length}+${walls.length - pairs.length} walls`, `recall100 ${s.recall['100']}`, `recall50 ${s.recall['50']}`, `precision100 ${s.precision100}`, `median ${s.medianOffsetMm}`)
    if (dir) await overlay(t, walls, g, `${dir}/union-${t}.png`)
    n += raw.length * 0
  }
}
