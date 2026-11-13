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

export type Candidate = { n: number; id: string; a: Pt; b: Pt; thickness: number; length: number; op: Op }

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
  const pieces = mergeStacked(joinPieces(props.map((p) => ({ a: p.a, b: p.b, thickness: p.thickness })), 60))
    .filter((p) => len(p) >= 400 && !known(p, plan.walls))
  // Numbered in reading order: rows of 1 m from the top, left to right within a row.
  const mid = (p: Piece) => ({ x: (p.a.x + p.b.x) / 2, y: (p.a.y + p.b.y) / 2 })
  pieces.sort((p, q) => Math.floor(mid(p).y / 1000) - Math.floor(mid(q).y / 1000) || mid(p).x - mid(q).x)
  const list: Candidate[] = pieces.map((p, i) => {
    const m = mid(p)
    const cid = `c-${Math.round(m.x)}-${Math.round(m.y)}`
    const a = { x: Math.round(p.a.x), y: Math.round(p.a.y) }
    const b = { x: Math.round(p.b.x), y: Math.round(p.b.y) }
    return { n: i + 1, id: cid, a, b, thickness: Math.round(p.thickness), length: Math.round(len(p)), op: { op: 'add', kind: 'wall', item: { id: cid, a, b, thickness: Math.round(p.thickness), phase: 'existing' } } as Op }
  })
  const maxPx = Math.min(2576, Math.max(100, Math.round(28 * Math.sqrt(maxTokens ?? 1600))))
  const v = await scanView(id, plan, r, rect, { overlay: true, maxPx, candidates: list.map(({ n, a, b, thickness }) => ({ n, a, b, thickness })) })
  const lines = list.map((c) => `${c.n}: (${c.a.x},${c.a.y})→(${c.b.x},${c.b.y}) tj ${c.thickness}, ${c.length} mm`)
  const summary = list.length
    ? `${list.length} väggkandidater i området som planen saknar, numrerade i bilden (blå, streckade). Avgör för varje nummer om det är en vägg eller något annat (inredning, text, symbol). Lägg till väggarna med edit: ta deras op ur data.candidates.\n${lines.join('\n')}`
    : 'Inga väggkandidater i området som planen saknar. Saknas en vägg ändå: ge ungefärliga ändpunkter till scan (action "snap_walls", args.walls).'
  return toToolResult(
    answer({ ok: true, id, revision, data: { action: 'candidates', source: sid, region: [x, y, w, h], candidates: list, image: { mm_per_px: 1 / v.scale, origin_mm: [x, y] } } }),
    { summary, images: [{ type: 'image', data: v.png.toString('base64'), mimeType: 'image/png' }] },
  )
}
