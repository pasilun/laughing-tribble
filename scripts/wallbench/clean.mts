// W1: the cleaning step. Keeps ink that lies in long straight runs along the axes (an opening with line elements:
// for a bit image, exactly the horizontal and vertical runs at least `runMm` long), after closing gaps of up to
// `gapPx` in a run. Scores it against the fixture's walls and draws what was kept and removed.
//   npx tsx scripts/wallbench/clean.mts [tile] [runMm] [gapPx] [out.png]
import { FIXTURE, TILES, CASE, tileBits, wallMask, picture, type Bits } from './common.mjs'

export function clean(b: Bits, runMm: number, gapPx: number): Uint8Array {
  const L = Math.round(runMm / CASE.mm_per_px)
  const keep = new Uint8Array(b.w * b.h)
  const pass = (n: number, len: number, at: (i: number, j: number) => number) => {
    for (let i = 0; i < n; i++) {
      let j = 0
      while (j < len) {
        if (!b.d[at(i, j)]) { j++; continue }
        // A run, bridging gaps of up to gapPx.
        let end = j
        let k = j
        while (k < len) {
          if (b.d[at(i, k)]) { end = k; k++; continue }
          let g = k
          while (g < len && !b.d[at(i, g)] && g - k < gapPx) g++
          if (g < len && b.d[at(i, g)] && g - k <= gapPx) { k = g; continue }
          break
        }
        if (end - j + 1 >= L) for (let q = j; q <= end; q++) if (b.d[at(i, q)]) keep[at(i, q)] = 1
        j = end + 1
      }
    }
  }
  pass(b.h, b.w, (y, x) => y * b.w + x)
  pass(b.w, b.h, (x, y) => y * b.w + x)
  return keep
}

export function cleanScore(b: Bits, keep: Uint8Array, mask: Uint8Array) {
  let wallInk = 0, wallKept = 0, otherInk = 0, otherRemoved = 0
  for (let i = 0; i < b.d.length; i++) {
    if (!b.d[i]) continue
    if (mask[i]) { wallInk++; if (keep[i]) wallKept++ } else { otherInk++; if (!keep[i]) otherRemoved++ }
  }
  return { wallInkKept: +(wallKept / wallInk).toFixed(3), otherInkRemoved: +(otherRemoved / otherInk).toFixed(3), wallInk, otherInk }
}

if (process.argv[1]?.endsWith('clean.mts')) {
  const [tile = '154w', run = '400', gap = '2', out] = process.argv.slice(2)
  const b = await tileBits(TILES[tile])
  const mask = wallMask(b, FIXTURE.walls)
  const keep = clean(b, Number(run), Number(gap))
  console.log(tile, `run ${run} mm, gap ${gap} px`, JSON.stringify(cleanScore(b, keep, mask)))
  if (out)
    await picture(b.w, b.h, (i) => {
      if (!b.d[i]) return mask[i] ? [225, 245, 225] : [255, 255, 255]
      if (keep[i]) return mask[i] ? [0, 0, 0] : [30, 90, 230]
      return mask[i] ? [230, 30, 30] : [190, 190, 190]
    }, out)
}
