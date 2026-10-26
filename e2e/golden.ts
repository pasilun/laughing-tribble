import { readFileSync } from 'node:fs'
import { comparePlans } from '@/lib/plan/compare'
import { pointSegmentDistance } from '@/lib/plan/geometry'
import { roomAreas } from '@/lib/plan/rooms'
import type { Plan, Pt, Wall } from '@/lib/plan/types'

// The golden case: build a plan from one known drawing with the scan tools,
// the way Claude does (detect, snap, read the facade, find openings, read
// doors), then judge it against the plan the drawing was made from.
// Fixtures: e2e/fixtures/golden (scripts/make-golden.ts).

export const GOLDEN = 'e2e/fixtures/golden'

// The same flat drawn with door symbols, and in the 1936 style (doorways as
// a dashed face or a centre mark: kind and swing can't be read).
export type Style = 'arkiv' | '1936'

export type Call = (name: string, args: Record<string, unknown>) => Promise<{ text: string; isError?: boolean }>
export type GetPlan = (id: string) => Promise<{ plan: Plan; revision: number }>

type Case = {
  styles: Record<Style, string>
  drawing: { mm_per_px: number; x: number; y: number; rect: { x: number; y: number; w: number; h: number } }
  rooms: Plan['rooms']
  exterior: Pt[]
  facade: { file: string; mm_per_px: number; x: number; y: number; band: { y0: number; y1: number }; anchors: Array<{ facade_x: number; plan: Pt }> }
}

export function reference(): Plan {
  return JSON.parse(readFileSync(`${GOLDEN}/reference.json`, 'utf8')) as Plan
}

type Piece = { a: Pt; b: Pt; thickness: number }

// Detected walls come in pieces where a door or window breaks them: join
// pieces on one line (centre within 60 mm, similar thickness) across gaps up
// to 2 m (a door plus the break where a crossing wall meets one face), so the
// openings tool sees one wall with a gap.
export function joinPieces(pieces: Piece[]): Piece[] {
  const vert = (p: Piece) => Math.abs(p.b.x - p.a.x) < Math.abs(p.b.y - p.a.y)
  const span = (p: Piece) => (vert(p) ? { c: (p.a.x + p.b.x) / 2, t0: Math.min(p.a.y, p.b.y), t1: Math.max(p.a.y, p.b.y) } : { c: (p.a.y + p.b.y) / 2, t0: Math.min(p.a.x, p.b.x), t1: Math.max(p.a.x, p.b.x) })
  const out: Array<{ v: boolean; c: number; t0: number; t1: number; th: number[] }> = []
  for (const p of [...pieces].sort((x, y) => span(x).t0 - span(y).t0)) {
    const s = span(p)
    const v = vert(p)
    const m = out.find((o) => o.v === v && Math.abs(o.c - s.c) <= 60 && s.t0 - o.t1 <= 2000 && Math.abs(o.th[0] - p.thickness) <= 0.35 * Math.max(o.th[0], p.thickness))
    if (m) {
      m.t1 = Math.max(m.t1, s.t1)
      m.th.push(p.thickness)
    } else out.push({ v, c: s.c, t0: s.t0, t1: s.t1, th: [p.thickness] })
  }
  return out.map((o) => {
    const th = Math.round(o.th.sort((a, b) => a - b)[o.th.length >> 1])
    return o.v ? { a: { x: o.c, y: o.t0 }, b: { x: o.c, y: o.t1 }, thickness: th } : { a: { x: o.t0, y: o.c }, b: { x: o.t1, y: o.c }, thickness: th }
  })
}

// The wall closest to all of the points.
function nearestWall(plan: Plan, pts: Pt[]): Wall {
  const d = (w: Wall) => pts.reduce((s, p) => s + pointSegmentDistance(p, w.a, w.b).d, 0)
  return [...plan.walls].sort((x, y) => d(x) - d(y))[0]
}

// Builds the plan; returns its id and a log of each step's reply.
export async function generate(call: Call, getPlan: GetPlan, opts: { style: Style; methods: string[] | 'auto' }): Promise<{ id: string; log: string[] }> {
  const kase = JSON.parse(readFileSync(`${GOLDEN}/case.json`, 'utf8')) as Case
  const log: string[] = []
  const step = async (name: string, args: Record<string, unknown>) => {
    const r = await call(name, args)
    log.push(`## ${name}\n${r.text}`)
    if (r.isError) throw new Error(`${name}: ${r.text}`)
    return r.text
  }
  const created = await step('plan_create', { name: 'Golden' })
  const id = /Skapad: ([a-z0-9-]+)/.exec(created)![1]
  const rev = async () => (await getPlan(id)).revision
  const file = (f: string) => readFileSync(`${GOLDEN}/${f}`).toString('base64')

  await step('plan_source_add', { plan_id: id, base_revision: await rev(), id: 'plan', role: 'archive', filename: kase.styles[opts.style], data_base64: file(kase.styles[opts.style]), mm_per_px: kase.drawing.mm_per_px, x: kase.drawing.x, y: kase.drawing.y })
  await step('plan_source_add', { plan_id: id, base_revision: await rev(), id: 'fasad-n', role: 'archive', view: 'elevation', filename: kase.facade.file, data_base64: file(kase.facade.file), mm_per_px: kase.facade.mm_per_px, x: kase.facade.x, y: kase.facade.y })

  // Walls: detect, join the pieces, snap.
  const found = await step('plan_scan_detect_walls', { plan_id: id, source_id: 'plan', rect: kase.drawing.rect })
  const pieces = [...found.matchAll(/p\d+: \((-?\d+),(-?\d+)\)→\((-?\d+),(-?\d+)\) längd \d+ tj (\d+)/g)].map((m) => ({ a: { x: +m[1], y: +m[2] }, b: { x: +m[3], y: +m[4] }, thickness: +m[5] }))
  const walls = joinPieces(pieces).map((p, i) => ({ id: `w${i + 1}`, ...p, phase: 'existing' }))
  await step('plan_scan_snap_walls', { plan_id: id, base_revision: await rev(), source_id: 'plan', walls, message: 'Väggar från ritningen' })

  const snapped = await getPlan(id)
  const ext = kase.exterior.map((p) => nearestWall(snapped.plan, [p]).id)
  await step('plan_edit', { plan_id: id, base_revision: snapped.revision, message: 'Fasadväggar', ops: ext.map((w) => ({ op: 'update', kind: 'wall', id: w, patch: { exterior: true } })) })

  // The facade wall is the one the facade drawing's anchors lie on.
  const facadeWall = nearestWall((await getPlan(id)).plan, kase.facade.anchors.map((x) => x.plan))
  await step('plan_scan_elevation', { plan_id: id, base_revision: await rev(), source_id: 'fasad-n', wall_id: facadeWall.id, band: kase.facade.band, anchors: kase.facade.anchors, apply: true })

  await step('plan_scan_openings', { plan_id: id, base_revision: await rev(), source_id: 'plan', apply: true, ...(opts.methods === 'auto' ? {} : { methods: opts.methods }) })
  await step('plan_scan_doors', { plan_id: id, base_revision: await rev(), source_id: 'plan', apply: true })
  await step('plan_edit', { plan_id: id, base_revision: await rev(), message: 'Rum', ops: kase.rooms.map((item) => ({ op: 'add', kind: 'room', item })) })
  return { id, log }
}

export type Score = {
  walls: { matched: number; total: number; extra: number; maxPosMm: number; maxThicknessMm: number }
  openings: { matched: number; total: number; extra: number; wrongKind: string[]; wrongSwing: string[]; maxCentreMm: number; maxWidthMm: number }
  rooms: { wrong: string[]; maxAreaM2: number }
  report: string
}

// Generated walls get the id of the reference wall on the same line (same
// direction, centre lines within 200 mm, overlapping by half the shorter),
// then the plans are compared with plan_compare's comparison.
// symbols=false: the drawing has no door symbols, so a door read as an
// opening (no swing) is right.
export function judge(plan: Plan, ref: Plan, opts: { symbols: boolean } = { symbols: true }): Score {
  const vert = (w: Wall) => Math.abs(w.b.x - w.a.x) < Math.abs(w.b.y - w.a.y)
  const line = (w: Wall) => (vert(w) ? { c: (w.a.x + w.b.x) / 2, t0: Math.min(w.a.y, w.b.y), t1: Math.max(w.a.y, w.b.y) } : { c: (w.a.y + w.b.y) / 2, t0: Math.min(w.a.x, w.b.x), t1: Math.max(w.a.x, w.b.x) })
  const rename = new Map<string, string>()
  for (const r of ref.walls) {
    const lr = line(r)
    const hit = plan.walls
      .filter((w) => !rename.has(w.id) && vert(w) === vert(r))
      .map((w) => ({ w, l: line(w) }))
      .filter(({ l }) => Math.abs(l.c - lr.c) <= 200 && Math.min(l.t1, lr.t1) - Math.max(l.t0, lr.t0) >= 0.5 * Math.min(l.t1 - l.t0, lr.t1 - lr.t0))
      .sort((p, q) => Math.abs(p.l.c - lr.c) - Math.abs(q.l.c - lr.c))[0]
    if (hit) rename.set(hit.w.id, r.id)
  }
  const id = (x: string) => rename.get(x) ?? x
  const named: Plan = { ...plan, walls: plan.walls.map((w) => ({ ...w, id: id(w.id) })), openings: plan.openings.map((o) => ({ ...o, wallId: id(o.wallId) })) }
  const c = comparePlans(named, ref)
  const refOp = new Map(ref.openings.map((o) => [o.id, o]))
  const planOp = new Map(named.openings.map((o) => [o.id, o]))
  const wrongKind: string[] = []
  const wrongSwing: string[] = []
  for (const m of c.openings.matched) {
    const r = refOp.get(m.refId)!
    const p = planOp.get(m.id)!
    const plain = !opts.symbols && r.kind !== 'window' && p.kind !== 'window'
    if (r.kind !== p.kind && !plain) wrongKind.push(`${r.id}: ${p.kind}, ska vara ${r.kind}`)
    else if (r.kind === 'door' && p.kind === 'door' && (r.hinge !== p.hinge || r.swing !== p.swing)) wrongSwing.push(`${r.id}: ${p.hinge}/${p.swing}, ska vara ${r.hinge}/${r.swing}`)
  }
  const max = (xs: number[]) => xs.reduce((a, x) => Math.max(a, Math.abs(x)), 0)
  const score: Score = {
    walls: { matched: c.walls.length, total: ref.walls.length, extra: c.wallsOnlyInPlan.length, maxPosMm: max(c.walls.map((w) => w.diffMm)), maxThicknessMm: max(c.walls.map((w) => w.thicknessDiffMm)) },
    openings: {
      matched: c.openings.matched.length,
      total: ref.openings.length,
      extra: c.openings.extra.length,
      wrongKind,
      wrongSwing,
      maxCentreMm: max(c.openings.matched.map((m) => m.centreDiffMm)),
      maxWidthMm: max(c.openings.matched.map((m) => m.widthDiffMm)),
    },
    rooms: { wrong: [], maxAreaM2: 0 },
    report: '',
  }
  // Room areas from the walls: the same rooms, each within its area.
  const got = roomAreas(named, 'fore')
  const want = roomAreas(ref, 'fore')
  const m2 = (a?: number) => (a === undefined ? '–' : (a / 1e6).toFixed(2))
  const roomLines: string[] = []
  for (const r of ref.rooms) {
    const a = got.get(r.id)
    const b = want.get(r.id)
    if ((a === undefined) !== (b === undefined)) score.rooms.wrong.push(r.id)
    else if (a !== undefined && b !== undefined) score.rooms.maxAreaM2 = Math.max(score.rooms.maxAreaM2, Math.abs(a - b) / 1e6)
    roomLines.push(`  ${r.id}: ${m2(a)} m² mot ${m2(b)}`)
  }
  score.report = [
    `Väggar ${score.walls.matched}/${score.walls.total}, extra ${score.walls.extra} (${c.wallsOnlyInPlan.join(', ') || '–'}), saknas: ${c.wallsOnlyInRef.join(', ') || '–'}`,
    ...c.walls.map((w) => `  ${w.id}: läge ${w.diffMm >= 0 ? '+' : ''}${w.diffMm}, tj ${w.thickness} mot ${w.refThickness}`),
    `Öppningar ${score.openings.matched}/${score.openings.total}, extra ${score.openings.extra}`,
    ...c.openings.matched.map((m) => `  ✓ ${m.refId} = ${m.id} (${planOp.get(m.id)!.kind}): mitt ${m.centreDiffMm}, bredd ${m.widthDiffMm >= 0 ? '+' : ''}${m.widthDiffMm}`),
    ...c.openings.missed.map((m) => `  ✗ ${m.refId} (${m.kind} i ${m.wallId})`),
    ...c.openings.extra.map((m) => `  + ${m.id} (${m.kind} i ${m.wallId})`),
    ...wrongKind.map((x) => `  fel typ ${x}`),
    ...wrongSwing.map((x) => `  fel slag ${x}`),
    `Rum (area, plan mot referens)${score.rooms.wrong.length ? `, fel: ${score.rooms.wrong.join(', ')}` : ''}`,
    ...roomLines,
  ].join('\n')
  return score
}
