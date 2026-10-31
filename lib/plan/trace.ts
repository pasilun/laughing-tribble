import { sourceIdOf } from './audit'
import { wallLength } from './geometry'
import { pairPrinted } from './finish'
import type { Op } from './ops'
import { spaceGrid } from './rooms'
import { detectWalls } from './scan/detect'
import { joinPieces } from './scan/pieces'
import { loadGray, resolveSource, type Raster } from './scan/raster'
import { snapWalls } from './scan/snap'
import { handleScanTool } from './scan/tools'
import { scanView } from './scan/view'
import { editPlan, loadPlan } from './service'
import type { Pt, Wall } from './types'

// plan_trace: the whole mechanical part of tracing a drawing in one call, with the
// same defaults a careful person would use – calibrate against the printed outside
// size, detect and snap the walls, mark the facade, read openings and doors. What is
// left is judgement, and it comes back as a short list of decisions.

export type TraceArgs = {
  sourceId?: string
  // The overall outside size printed on the drawing; calibrates when the source is not calibrated.
  printed?: { width: number; length: number }
  // Or exact end points of printed dimensions (see plan_scan_dimension).
  dimensions?: Array<{ a: Pt; b: Pt; mm: number; label?: string }>
}

export type Traced = { text: string; png?: Buffer; isError?: boolean }

const MIN_WALL = 1000
// A scan's resolution is often not what its header says (a 1:100 sheet at "300 dpi" can be
// 30 % off), so the first scale is only a guess: the printed size decides.
const AUTO_CALIBRATION_LIMIT = 0.45

const textOf = (r: { content: Array<{ type: string; text?: string }> }) => r.content.filter((c) => c.type === 'text').map((c) => c.text ?? '').join('\n')

// Walls whose centre line lies on the outer edge of the traced outline.
function exteriorIds(walls: Wall[]): string[] {
  const vert = (w: Wall) => Math.abs(w.b.x - w.a.x) < Math.abs(w.b.y - w.a.y)
  const vs = walls.filter(vert)
  const hs = walls.filter((w) => !vert(w))
  if (!vs.length || !hs.length) return []
  const xs = vs.map((w) => (w.a.x + w.b.x) / 2)
  const ys = hs.map((w) => (w.a.y + w.b.y) / 2)
  const x0 = Math.min(...xs)
  const x1 = Math.max(...xs)
  const y0 = Math.min(...ys)
  const y1 = Math.max(...ys)
  const tol = 200
  const longEnough = (w: Wall, span: number) => wallLength(w) >= 0.4 * span
  const out: string[] = []
  for (const w of vs) {
    const x = (w.a.x + w.b.x) / 2
    if ((Math.abs(x - x0) <= tol || Math.abs(x - x1) <= tol) && longEnough(w, y1 - y0)) out.push(w.id)
  }
  for (const w of hs) {
    const y = (w.a.y + w.b.y) / 2
    if ((Math.abs(y - y0) <= tol || Math.abs(y - y1) <= tol) && longEnough(w, x1 - x0)) out.push(w.id)
  }
  return out
}


type Prop = ReturnType<typeof detectWalls>[number]
const plen = (p: Prop) => Math.hypot(p.b.x - p.a.x, p.b.y - p.a.y)

// Where the house is on the sheet (which also holds title text, a scale bar, a stray stair and
// specks), found from the pieces the detector returns: pieces on one line, however broken, add
// up to a wall line; the outline is the outermost wall lines that run most of the way across.
// Pieces are grouped by centre line, so a slightly skewed or hand drawn wall still counts as one.
export function houseBox(props: Prop[]): { x0: number; x1: number; y0: number; y1: number } | null {
  const TOL = 250
  const line = (vertical: boolean) => {
    const ps = props
      .filter((p) => p.confidence >= 0.5 && plen(p) >= 300 && p.thickness >= 110 && (Math.abs(p.b.x - p.a.x) < Math.abs(p.b.y - p.a.y)) === vertical)
      .map((p) => ({ c: vertical ? (p.a.x + p.b.x) / 2 : (p.a.y + p.b.y) / 2, t0: vertical ? Math.min(p.a.y, p.b.y) : Math.min(p.a.x, p.b.x), t1: vertical ? Math.max(p.a.y, p.b.y) : Math.max(p.a.x, p.b.x), len: plen(p), th: p.thickness }))
      .sort((p, q) => p.c - q.c)
    const groups: Array<{ cs: number[]; t0: number; t1: number; total: number; th: number[] }> = []
    for (const p of ps) {
      const g = groups.find((x) => Math.abs(x.cs[x.cs.length - 1] - p.c) <= TOL)
      if (g) {
        g.cs.push(p.c)
        g.t0 = Math.min(g.t0, p.t0)
        g.t1 = Math.max(g.t1, p.t1)
        g.total += p.len
        g.th.push(p.th)
      } else groups.push({ cs: [p.c], t0: p.t0, t1: p.t1, total: p.len, th: [p.th] })
    }
    const med = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1]
    const kept = groups.filter((x) => x.total >= 1500).map((x) => ({ c: med(x.cs), span: x.t1 - x.t0, th: med(x.th) }))
    const top = Math.max(0, ...kept.map((x) => x.span))
    return kept.filter((x) => x.span >= 0.5 * top)
  }
  const vs = line(true)
  const hs = line(false)
  if (vs.length < 2 || hs.length < 2) return null
  const left = vs.reduce((a, b) => (b.c < a.c ? b : a))
  const right = vs.reduce((a, b) => (b.c > a.c ? b : a))
  const top = hs.reduce((a, b) => (b.c < a.c ? b : a))
  const bottom = hs.reduce((a, b) => (b.c > a.c ? b : a))
  return { x0: left.c - left.th / 2, x1: right.c + right.th / 2, y0: top.c - top.th / 2, y1: bottom.c + bottom.th / 2 }
}

export async function autoTrace(planId: string, args: TraceArgs): Promise<Traced> {
  let rev = await loadPlan(planId)
  if (!rev) return { text: `Planen ${planId} finns inte`, isError: true }
  const sourceId = sourceIdOf(rev.plan, args.sourceId)
  if (!sourceId) return { text: 'Planen har ingen källritning. Anropa plan_upload_link och be användaren ladda upp ritningen först.', isError: true }
  const done: string[] = []
  const decide: string[] = []
  const reload = async () => {
    rev = (await loadPlan(planId))!
    return rev
  }

  // 1. Calibrate.
  const src = (rev.plan.sources ?? []).find((s) => s.id === sourceId)
  if (args.dimensions?.length) {
    const res = await handleScanTool('plan_scan_dimension', { plan_id: planId, source_id: sourceId, base_revision: rev.meta.n, apply: true, dimensions: args.dimensions })
    if (res?.isError) return { text: `Kalibreringen misslyckades:\n${textOf(res)}`, isError: true }
    done.push(`Kalibrerad mot ${args.dimensions.length} tryckta mått`)
    await reload()
  } else if (src?.calibration) {
    done.push(`Källan var redan kalibrerad (${src.calibration})`)
  } else if (args.printed) {
    const r = resolveSource(rev.plan, sourceId)
    const g = await loadGray(planId, r)
    const box = houseBox(detectWalls(g, r, {}))
    if (!box) decide.push('Kunde inte kalibrera automatiskt (ingen sammanhängande yttervägg hittades). Läs de tryckta måtten i bilden (plan_view) och kör plan_trace med dimensions, eller plan_scan_dimension.')
    else {
      const w = box.x1 - box.x0
      const l = box.y1 - box.y0
      const [tw, tl] = pairPrinted(w, l, args.printed)
      // The outline found must have the printed proportions, or it is something else on the sheet.
      const shape = Math.min(w, l) / Math.max(w, l) / (Math.min(tw, tl) / Math.max(tw, tl))
      if (Math.abs(shape - 1) > 0.12)
        decide.push(`Kunde inte hitta husets yttre kontur säkert (proportionerna ${Math.round(w)} × ${Math.round(l)} stämmer inte med tryckt ${tw} × ${tl}). Titta i bilden (plan_view), läs ändpunkterna för de tryckta måtten och kör plan_trace med dimensions.`)
      else if (Math.abs(tw / w - 1) > AUTO_CALIBRATION_LIMIT || Math.abs(tl / l - 1) > AUTO_CALIBRATION_LIMIT)
        decide.push(`Ritningens utsida mättes till ${Math.round(w)} × ${Math.round(l)} mm mot tryckt ${tw} × ${tl}: för stor skillnad för automatisk kalibrering (något utanför huset räknades med, eller skalan är fel). Läs de tryckta måtten i bilden (plan_view) och kör plan_trace med dimensions.`)
      else {
        const midY = (box.y0 + box.y1) / 2
        const midX = (box.x0 + box.x1) / 2
        const res = await handleScanTool('plan_scan_dimension', {
          plan_id: planId,
          source_id: sourceId,
          base_revision: rev.meta.n,
          apply: true,
          dimensions: [
            { label: 'bredd', a: { x: box.x0, y: midY }, b: { x: box.x1, y: midY }, mm: tw },
            { label: 'längd', a: { x: midX, y: box.y0 }, b: { x: midX, y: box.y1 }, mm: tl },
          ],
        })
        if (res?.isError) decide.push(`Automatisk kalibrering misslyckades: ${textOf(res).split('\n')[0]}`)
        else {
          done.push(`Kalibrerad mot tryckt yttermått ${tw} × ${tl} mm (ritningen mättes till ${Math.round(w)} × ${Math.round(l)})`)
          await reload()
        }
      }
    }
  } else {
    decide.push('Källan är inte kalibrerad. Ange printed_outer_mm (yttermåtten som står på ritningen) eller dimensions.')
  }

  // Walls found at a wrong scale are wrong in every way (lengths, thicknesses, what counts as a wall):
  // better to stop and ask for the one thing that is missing.
  const calibratedNow = (rev!.plan.sources ?? []).find((x) => x.id === sourceId)?.calibration || sourceId === 'underlay'
  if (!calibratedNow && rev!.plan.walls.length === 0) {
    let png: Buffer | undefined
    try {
      const rr = resolveSource(rev!.plan, sourceId)
      png = (await scanView(planId, rev!.plan, rr, { x: rr.x, y: rr.y, w: rr.widthPx * rr.mmPerPx, h: rr.heightPx * rr.mmPerPx }, { maxPx: 1400 })).png
    } catch {
      // text only
    }
    const text = ['plan_trace stannade: källan är inte kalibrerad, och väggar som läses av i fel skala blir fel.', ...decide.map((d) => `- ${d}`), '\nBilden visar hela ritningen med ett rutnät i mm. Läs av ändpunkterna för de tryckta måtten (t.ex. ytterkant till ytterkant) och kör plan_trace igen med dimensions: [{"a":{"x":…,"y":…},"b":{"x":…,"y":…},"mm":10500},{…}] och printed_outer_mm.'].join('\n')
    return { text, png }
  }

  // 2. Walls.
  let reportsBad: string[] = []
  const r: Raster = resolveSource(rev!.plan, sourceId)
  const g = await loadGray(planId, r)
  if (rev!.plan.walls.length === 0) {
    // Only the house: not the scale bar, the title or specks on the sheet.
    const box = houseBox(detectWalls(g, r, {}))
    const rect = box ? { x: box.x0 - 400, y: box.y0 - 400, w: box.x1 - box.x0 + 800, h: box.y1 - box.y0 + 800 } : undefined
    const props = detectWalls(g, r, { rect }).filter((p) => plen(p) >= MIN_WALL)
    const walls = joinPieces(props.map((p) => ({ a: p.a, b: p.b, thickness: p.thickness })), 200).map((p, i): Wall => ({ id: `w${i + 1}`, ...p, phase: 'existing' }))
    if (!walls.length) decide.push('Inga väggar hittades i källan. Titta på bilden (plan_view) och lägg in väggarna för hand med plan_edit.')
    else {
      const snapped = snapWalls(g, r, rev!.plan, { ids: [], add: walls }, {})
      const bad = new Set(snapped.reports.filter((x) => !x.ok).map((x) => x.id))
      reportsBad = [...bad]
      // Pieces found twice end up on one line after snapping: keep the longer.
      const alike = (p: Wall, q: Wall) => {
        const vp = Math.abs(p.b.x - p.a.x) < Math.abs(p.b.y - p.a.y)
        const vq = Math.abs(q.b.x - q.a.x) < Math.abs(q.b.y - q.a.y)
        if (vp !== vq) return false
        const c = (w: Wall) => (vp ? (w.a.x + w.b.x) / 2 : (w.a.y + w.b.y) / 2)
        const t = (w: Wall) => (vp ? [Math.min(w.a.y, w.b.y), Math.max(w.a.y, w.b.y)] : [Math.min(w.a.x, w.b.x), Math.max(w.a.x, w.b.x)])
        const [p0, p1] = t(p)
        const [q0, q1] = t(q)
        return Math.abs(c(p) - c(q)) <= Math.max(80, 0.4 * Math.max(p.thickness, q.thickness)) && Math.min(p1, q1) - Math.max(p0, q0) >= 0.5 * Math.min(p1 - p0, q1 - q0)
      }
      const winners: Wall[] = []
      for (const w of [...snapped.walls].filter((x) => !bad.has(x.id)).sort((p, q) => wallLength(q) - wallLength(p))) {
        if (winners.some((u) => alike(u, w))) bad.add(w.id)
        else winners.push(w)
      }
      const ops: Op[] = snapped.ops.filter((o) => !(o.op === 'add' && o.kind === 'wall' && bad.has(o.item.id)))
      const kept = snapped.walls.filter((w) => !bad.has(w.id))
      ops.push(...exteriorIds(kept).map((id): Op => ({ op: 'update', kind: 'wall', id, patch: { exterior: true } })))
      const res = await editPlan(planId, ops, rev!.meta.n, 'claude', 'Väggar från ritningen (plan_trace)')
      if (res.status !== 200) return { text: `Ingen ändring sparades:\n${res.errors.join('\n')}`, isError: true }
      await reload()
      const ext = rev!.plan.walls.filter((w) => w.exterior).length
      done.push(`${kept.length} väggar fästa mot ritningen, ${ext} av dem ytterväggar`)
      if (bad.size) {
        const lost = snapped.walls.filter((w) => bad.has(w.id)).map((w) => `(${Math.round(w.a.x)},${Math.round(w.a.y)})→(${Math.round(w.b.x)},${Math.round(w.b.y)})`)
        decide.push(`${bad.size} möjliga väggar var för osäkra och lades inte in: ${lost.join(', ')}. Titta i bilden: finns väggen, lägg in den med plan_edit och kör plan_audit.`)
      }
    }
  } else done.push(`Planen hade redan ${rev!.plan.walls.length} väggar – de behölls`)

  // 3. Openings and doors.
  if (rev!.plan.walls.length) {
    const opened = await handleScanTool('plan_scan_openings', { plan_id: planId, source_id: sourceId, base_revision: rev!.meta.n, apply: true })
    if (opened?.isError) decide.push(`Öppningar kunde inte läsas: ${textOf(opened).split('\n')[0]}`)
    await reload()
    const doors = await handleScanTool('plan_scan_doors', { plan_id: planId, source_id: sourceId, base_revision: rev!.meta.n, apply: true })
    if (doors?.isError) decide.push(`Dörrarna kunde inte läsas: ${textOf(doors).split('\n')[0]}`)
    await reload()
    const o = rev!.plan.openings
    const count = (k: string) => o.filter((x) => x.kind === k).length
    done.push(`${o.length} öppningar: ${count('door')} dörrar, ${count('window')} fönster, ${count('opening')} öppningar utan känd typ`)
    const plain = o.filter((x) => x.kind === 'opening')
    if (plain.length) decide.push(`${plain.length} öppningar är dörr eller passage, typ okänd: ${plain.slice(0, 6).map((x) => x.id).join(', ')}${plain.length > 6 ? ' …' : ''}. Titta i bilden: sätt kind till door (med hinge/swing) eller lämna som öppning.`)
    if (!o.some((x) => x.kind === 'window') && rev!.plan.walls.some((w) => w.exterior))
      decide.push('Inga fönster hittades. Har ritningen fasadbilder, lägg till dem som källa (view elevation) och kör plan_scan_elevation; annars markera fönster för hand.')
  }

  // 4. Rooms to name.
  const grid = spaceGrid(rev!.plan, 'fore')
  const unnamed = (grid?.spaces ?? []).filter((s) => !s.open && s.area > 1.5e6 && !s.rooms.length)
  if (unnamed.length && !rev!.plan.rooms.length)
    decide.push(`${unnamed.length} slutna rum saknar namn. Läs namnen i bilden och lägg in dem, t.ex. {"op":"add","kind":"room","item":{"id":"r1","name":"Kök","at":{"x":${Math.round(unnamed[0].at.x)},"y":${Math.round(unnamed[0].at.y)}}}}. Platser: ${unnamed.slice(0, 8).map((s) => `(${Math.round(s.at.x)},${Math.round(s.at.y)}) ${(s.area / 1e6).toFixed(1)} m²`).join('; ')}`)

  // 5. One picture of the result on the source.
  let png: Buffer | undefined
  try {
    const plan = rev!.plan
    const xs = plan.walls.flatMap((w) => [w.a.x, w.b.x])
    const ys = plan.walls.flatMap((w) => [w.a.y, w.b.y])
    if (xs.length) {
      const m = 600
      png = (await scanView(planId, plan, resolveSource(plan, sourceId), { x: Math.min(...xs) - m, y: Math.min(...ys) - m, w: Math.max(...xs) - Math.min(...xs) + 2 * m, h: Math.max(...ys) - Math.min(...ys) + 2 * m }, { overlay: true, view: 'fore', maxPx: 1400 })).png
    }
  } catch {
    // The text is the result; the picture is a help.
  }
  void reportsBad
  const text = [`plan_trace klar, revision ${rev!.meta.n}.`, 'Gjort:', ...done.map((d) => `- ${d}`), decide.length ? `\nAtt avgöra:\n${decide.map((d) => `- ${d}`).join('\n')}` : '\nInget att avgöra.', '\nNästa steg: plan_next.'].join('\n')
  return { text, png }
}
