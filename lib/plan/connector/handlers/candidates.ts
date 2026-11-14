import { sourceIdOf } from '../../assist/audit'
import type { Op } from '../../domain/ops'
import type { Plan, Pt, Wall } from '../../domain/types'
import { detectWalls } from '../../scan/detect'
import { joinPieces, mergeStacked, type Piece } from '../../scan/pieces'
import { loadGray, resolveSource } from '../../scan/raster'
import { scanView } from '../../scan/view'
import { answer } from '../answer'
import { badArgument } from '../findings'
import { toToolResult, type ToolResult } from '../result'
import type { Finding } from '../types'

// Walls the drawing shows in a region that the plan does not have yet, numbered, for Claude to judge by eye: which are
// walls, which are fixtures, text or symbols. Each comes with the edit operation that adds it at the position found in
// the ink, so "3 and 7 are walls" becomes an edit with those two operations. Nothing is saved here.
// A drawn wall that runs on past the end of a wall in the plan (a wall traced too short) is offered as an extension of
// that wall: its op updates the wall's ends, and edit keeps the wall's openings where they are.

export type Candidate = { n: number; id: string; kind: 'add' | 'extend'; wall?: string; a: Pt; b: Pt; thickness: number; length: number; op: Op }

// How far a drawn wall must run past a wall's end to be offered as an extension: less is the crossing wall's thickness.
const EXTEND_MM = 300
// The widest gap an extension bridges: a doorway. The plan draws a wall with a doorway as one wall with an opening.
const DOORWAY_MM = 1200

const vertical = (p: { a: Pt; b: Pt }) => Math.abs(p.b.x - p.a.x) < Math.abs(p.b.y - p.a.y)
const len = (p: { a: Pt; b: Pt }) => Math.hypot(p.b.x - p.a.x, p.b.y - p.a.y)

// A piece the plan already has: a wall on the same axis, centre lines close, overlapping most of the piece.
function known(p: Piece, walls: Wall[]): boolean {
  const v = vertical(p)
  const c = v ? (p.a.x + p.b.x) / 2 : (p.a.y + p.b.y) / 2
  const [t0, t1] = v ? [Math.min(p.a.y, p.b.y), Math.max(p.a.y, p.b.y)] : [Math.min(p.a.x, p.b.x), Math.max(p.a.x, p.b.x)]
  return walls.some((w) => {
    if (vertical(w) !== v) return false
    const cw = v ? (w.a.x + w.b.x) / 2 : (w.a.y + w.b.y) / 2
    if (Math.abs(cw - c) > Math.max(80, (w.thickness + p.thickness) / 4)) return false
    const [w0, w1] = v ? [Math.min(w.a.y, w.b.y), Math.max(w.a.y, w.b.y)] : [Math.min(w.a.x, w.b.x), Math.max(w.a.x, w.b.x)]
    return Math.min(t1, w1) - Math.max(t0, w0) >= 0.5 * (t1 - t0)
  })
}

const span = (p: { a: Pt; b: Pt }, v: boolean): [number, number] => (v ? [Math.min(p.a.y, p.b.y), Math.max(p.a.y, p.b.y)] : [Math.min(p.a.x, p.b.x), Math.max(p.a.x, p.b.x)])

// Whether a piece lies on a wall's line (same axis, centre lines close) within `gap` of the stretch [w0, w1] along it.
function onLine(p: Piece, w: Wall, w0: number, w1: number, gap: number): boolean {
  const v = vertical(w)
  if (vertical(p) !== v) return false
  const c = v ? (p.a.x + p.b.x) / 2 : (p.a.y + p.b.y) / 2
  const cw = v ? (w.a.x + w.b.x) / 2 : (w.a.y + w.b.y) / 2
  if (Math.abs(cw - c) > Math.max(80, (w.thickness + p.thickness) / 4)) return false
  const [t0, t1] = span(p, v)
  return Math.min(t1, w1) - Math.max(t0, w0) >= -gap
}

// How far the drawing carries each wall of the plan: the pieces on its line that touch it or follow it across gaps no
// wider than a doorway, gathered until none is left, leaving out pieces that are another wall of the plan. A wall drawn longer than the plan has it is offered as an extension.
// How far a wall may be extended each way: not past a wall it already ends against (a T-joint or a corner: what lies
// beyond is another room's wall, or a stair, or the next flat), and not into the next wall of the plan on its line.
function limits(w: Wall, walls: Wall[]): [number, number] {
  const v = vertical(w)
  const c = v ? w.a.x : w.a.y
  const [w0, w1] = span(w, v)
  let lo = -Infinity
  let hi = Infinity
  for (const x of walls) {
    if (x === w) continue
    if (vertical(x) !== v) {
      const [x0, x1] = span(x, !v)
      if (c < x0 - x.thickness / 2 || c > x1 + x.thickness / 2) continue
      const cx = v ? x.a.y : x.a.x
      const reachMm = x.thickness / 2 + 50
      if (Math.abs(cx - w0) <= reachMm) lo = Math.max(lo, w0)
      if (Math.abs(cx - w1) <= reachMm) hi = Math.min(hi, w1)
    } else {
      const cx = v ? x.a.x : x.a.y
      if (Math.abs(cx - c) > Math.max(80, (w.thickness + x.thickness) / 4)) continue
      const [x0, x1] = span(x, v)
      if (x1 <= w0) lo = Math.max(lo, x1)
      if (x0 >= w1) hi = Math.min(hi, x0)
    }
  }
  return [lo, hi]
}

function reaches(pieces: Piece[], walls: Wall[]): { reach: Map<string, [number, number]>; used: Set<Piece> } {
  const reach = new Map<string, [number, number]>()
  const used = new Set<Piece>()
  for (const w of walls) {
    const v = vertical(w)
    let [r0, r1] = span(w, v)
    const [l0, l1] = limits(w, walls)
    // A piece that is another wall of the plan (the next wall on the same line, past a doorway) is not this one's.
    const others = walls.filter((x) => x !== w)
    const own = new Set<Piece>()
    for (let grew = true; grew; ) {
      grew = false
      for (const p of pieces) {
        if (own.has(p) || !onLine(p, w, r0, r1, DOORWAY_MM) || known(p, others)) continue
        const [t0, t1] = span(p, v)
        // Wholly past a limit: it belongs to whatever lies beyond (a stair, the next room), not to this wall.
        if (t1 <= l0 || t0 >= l1) continue
        own.add(p)
        const n0 = Math.max(l0, Math.min(r0, t0))
        const n1 = Math.min(l1, Math.max(r1, t1))
        if (n0 < r0 || n1 > r1) grew = true
        r0 = n0
        r1 = n1
      }
    }
    for (const p of own) used.add(p)
    const [w0, w1] = span(w, v)
    if (w0 - r0 >= EXTEND_MM || r1 - w1 >= EXTEND_MM) reach.set(w.id, [w0 - r0 >= EXTEND_MM ? r0 : w0, r1 - w1 >= EXTEND_MM ? r1 : w1])
  }
  return { reach, used }
}

// An extended end that stops just short of a crossing wall is joined to it at its centre line, as walls in the plan
// meet: within the crossing wall's half thickness plus JOIN_MM of its centre line.
const JOIN_MM = 400
function joinEnd(w: Wall, t: number, walls: Wall[], dir: 1 | -1): number {
  const v = vertical(w)
  const c = v ? w.a.x : w.a.y
  let best = t
  let gap = Infinity
  for (const x of walls) {
    if (x === w || vertical(x) === v) continue
    const [x0, x1] = span(x, !v)
    if (c < x0 - 1 || c > x1 + 1) continue
    const cx = v ? x.a.y : x.a.x
    const d = (cx - t) * dir
    if (d >= -x.thickness / 2 && d <= x.thickness / 2 + JOIN_MM && Math.abs(d) < gap) {
      gap = Math.abs(d)
      best = cx
    }
  }
  return best
}

// The wall's new ends when it is extended to cover the piece, in the wall's own direction (a stays the a-end).
function extended(w: Wall, lo: number, hi: number): { a: Pt; b: Pt } {
  const v = vertical(w)
  const forward = v ? w.a.y <= w.b.y : w.a.x <= w.b.x
  const at = (t: number): Pt => (v ? { x: w.a.x, y: Math.round(t) } : { x: Math.round(t), y: w.a.y })
  return forward ? { a: at(lo), b: at(hi) } : { a: at(hi), b: at(lo) }
}

export async function candidates(id: string, plan: Plan, revision: number, given: Record<string, unknown>, maxTokens?: number): Promise<ToolResult> {
  const fail = (f: Finding) => toToolResult(answer({ ok: false, id, revision, findings: [f] }), { summary: f.message })
  const sid = sourceIdOf(plan, typeof given.source_id === 'string' ? given.source_id : undefined)
  if (!sid) return fail(badArgument('args.source_id', 'planen har ingen källritning'))
  let r
  try {
    r = resolveSource(plan, sid)
  } catch (e) {
    return fail(badArgument('args.source_id', (e as Error).message))
  }
  const box = given.region as unknown
  if (!Array.isArray(box) || box.length !== 4 || !box.every((x) => typeof x === 'number') || box[2] <= 0 || box[3] <= 0)
    return fail(badArgument('args.region', 'ska vara [x, y, w, h] i mm (ett område på några meter)'))
  const [x, y, w, h] = box as number[]
  if (w * h > 36e6) return fail(badArgument('args.region', 'högst 6 × 6 m: små områden ger säkrare bedömningar'))
  const rect = { x, y, w, h }
  const g = await loadGray(id, r)
  const props = detectWalls(g, r, { rect, maxProposals: 1000 })
  const all = mergeStacked(joinPieces(props.map((p) => ({ a: p.a, b: p.b, thickness: p.thickness })), 60)).filter((p) => len(p) >= 400)
  // Extensions first: the drawing carries a wall further than the plan does, by more than a crossing wall's thickness.
  const { reach, used } = reaches(all, plan.walls)
  const pieces = all.filter((p) => !used.has(p) && !known(p, plan.walls))
  // Numbered in reading order: rows of 1 m from the top, left to right within a row.
  const mid = (p: Piece) => ({ x: (p.a.x + p.b.x) / 2, y: (p.a.y + p.b.y) / 2 })
  pieces.sort((p, q) => Math.floor(mid(p).y / 1000) - Math.floor(mid(q).y / 1000) || mid(p).x - mid(q).x)
  type Draft = Omit<Candidate, 'n'>
  const drafts: Draft[] = pieces.map((p) => {
    const m = mid(p)
    const cid = `c-${Math.round(m.x)}-${Math.round(m.y)}`
    const a = { x: Math.round(p.a.x), y: Math.round(p.a.y) }
    const b = { x: Math.round(p.b.x), y: Math.round(p.b.y) }
    return { id: cid, kind: 'add', a, b, thickness: Math.round(p.thickness), length: Math.round(len(p)), op: { op: 'add', kind: 'wall', item: { id: cid, a, b, thickness: Math.round(p.thickness), phase: 'existing' } } as Op }
  })
  for (const [wid, [lo, hi]] of reach) {
    const w = plan.walls.find((x) => x.id === wid)!
    const [w0, w1] = span(w, vertical(w))
    const ends = extended(w, lo < w0 ? joinEnd(w, lo, plan.walls, -1) : lo, hi > w1 ? joinEnd(w, hi, plan.walls, 1) : hi)
    drafts.push({ id: `x-${wid}`, kind: 'extend', wall: wid, ...ends, thickness: w.thickness, length: Math.round(len(ends)), op: { op: 'update', kind: 'wall', id: wid, patch: ends } })
  }
  drafts.sort((p, q) => Math.floor(mid(p).y / 1000) - Math.floor(mid(q).y / 1000) || mid(p).x - mid(q).x)
  const list: Candidate[] = drafts.map((d, i) => ({ n: i + 1, ...d }))
  const maxPx = Math.min(2576, Math.max(100, Math.round(28 * Math.sqrt(maxTokens ?? 1600))))
  const v = await scanView(id, plan, r, rect, { overlay: true, maxPx, candidates: list.map(({ n, a, b, thickness }) => ({ n, a, b, thickness })) })
  const lines = list.map((c) => {
    if (c.kind === 'add') return `${c.n}: (${c.a.x},${c.a.y})→(${c.b.x},${c.b.y}) tj ${c.thickness}, ${c.length} mm`
    const w = plan.walls.find((x) => x.id === c.wall)!
    return `${c.n}: förläng ${c.wall} till (${c.a.x},${c.a.y})→(${c.b.x},${c.b.y}), ${Math.round(len(w))} → ${c.length} mm (ritningen visar väggen längre)`
  })
  const summary = list.length
    ? `${list.length} väggkandidater i området som planen saknar, numrerade i bilden (blå, streckade). Avgör för varje nummer om det är en vägg eller något annat (inredning, text, symbol). Lägg till väggarna med edit: ta deras op ur data.candidates (en förlängning är en update av den befintliga väggen; dess öppningar ligger kvar).\n${lines.join('\n')}`
    : 'Inga väggkandidater i området som planen saknar. Saknas en vägg ändå: ge ungefärliga ändpunkter till scan (action "snap_walls", args.walls).'
  return toToolResult(
    answer({ ok: true, id, revision, data: { action: 'candidates', source: sid, region: [x, y, w, h], candidates: list, image: { mm_per_px: 1 / v.scale, origin_mm: [x, y] } } }),
    { summary, images: [{ type: 'image', data: v.png.toString('base64'), mimeType: 'image/png' }] },
  )
}
