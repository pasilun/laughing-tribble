import { Vector2, WallLoop } from '@/types/building-v2'

function lineIntersect(p1: Vector2, d1: Vector2, p2: Vector2, d2: Vector2): Vector2 | null {
  const denom = d1.x * d2.y - d1.y * d2.x
  if (Math.abs(denom) < 1e-10) return null
  const t = ((p2.x - p1.x) * d2.y - (p2.y - p1.y) * d2.x) / denom
  return { x: p1.x + t * d1.x, y: p1.y + t * d1.y }
}

// CCW polygon: right normal of direction (dx,dy) points outward = (dy, -dx) normalised
function rightNormal(dx: number, dy: number): Vector2 {
  const len = Math.sqrt(dx * dx + dy * dy)
  return { x: dy / len, y: -dx / len }
}

// Compute the miter corner at vCorner where edge (vPrev→vCorner) meets edge (vCorner→vNext).
// tPrev/tNext are the thicknesses of the two edges.
// outward=true → outer face corner, outward=false → inner face corner.
function miterCorner(
  vPrev: Vector2, vCorner: Vector2, vNext: Vector2,
  tPrev: number, tNext: number,
  outward: boolean
): Vector2 {
  const dPrev = { x: vCorner.x - vPrev.x, y: vCorner.y - vPrev.y }
  const dNext = { x: vNext.x - vCorner.x, y: vNext.y - vCorner.y }
  const lenPrev = Math.sqrt(dPrev.x ** 2 + dPrev.y ** 2)
  const lenNext = Math.sqrt(dNext.x ** 2 + dNext.y ** 2)
  const dirPrev = { x: dPrev.x / lenPrev, y: dPrev.y / lenPrev }
  const dirNext = { x: dNext.x / lenNext, y: dNext.y / lenNext }
  const nPrev = rightNormal(dPrev.x, dPrev.y)
  const nNext = rightNormal(dNext.x, dNext.y)
  const sign = outward ? 1 : -1
  const p1: Vector2 = {
    x: vCorner.x + sign * nPrev.x * tPrev / 2,
    y: vCorner.y + sign * nPrev.y * tPrev / 2,
  }
  const p2: Vector2 = {
    x: vCorner.x + sign * nNext.x * tNext / 2,
    y: vCorner.y + sign * nNext.y * tNext / 2,
  }
  return lineIntersect(p1, dirPrev, p2, dirNext) ?? p1
}

// Returns the 4-corner footprint polygon for edge [edgeIndex] of the loop:
// [outerStart, outerEnd, innerEnd, innerStart] (suitable as IFCARBITRARYCLOSEDPROFILEDEF)
export function wallFootprint(loop: WallLoop, edgeIndex: number): [Vector2, Vector2, Vector2, Vector2] {
  const n = loop.vertices.length
  const i = edgeIndex
  const vStart  = loop.vertices[i]
  const vEnd    = loop.vertices[(i + 1) % n]
  const vPrev   = loop.vertices[(i - 1 + n) % n]
  const vNext   = loop.vertices[(i + 2) % n]
  const tThis   = loop.edges[i].thickness
  const tPrev   = loop.edges[(i - 1 + n) % n].thickness
  const tNext   = loop.edges[(i + 1) % n].thickness

  return [
    miterCorner(vPrev, vStart, vEnd, tPrev, tThis, true),   // outerStart
    miterCorner(vStart, vEnd, vNext, tThis, tNext, true),   // outerEnd
    miterCorner(vStart, vEnd, vNext, tThis, tNext, false),  // innerEnd
    miterCorner(vPrev, vStart, vEnd, tPrev, tThis, false),  // innerStart
  ]
}
