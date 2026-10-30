import { checkPlan, type Finding } from './checks'
import { bounds, wallQuad } from './geometry'
import { applyOps, type Op } from './ops'
import { reviewPlan } from './review'
import { fittingScale, SCALES } from './sheet'
import type { Plan, Sheet, TitleBlock } from './types'

// The mechanical last steps of a plan, so they happen every time and not only when
// whoever draws it remembers them: the sheet scale and orientation that fill the
// paper, the overall dimension lines, a review and a check, and the list of what only
// the user can tell (title block fields).

export type FinishOptions = {
  // Mark the exterior walls load-bearing (basement and masonry houses: they are).
  markExteriorLoadBearing?: boolean
  // The overall outside size printed on the drawing: the traced plan is compared with it.
  printedOuter?: { width: number; length: number }
}

export type Finish = {
  ops: Op[]
  done: string[]
  findings: Finding[]
  ask: string[]
  plan: Plan
}

export const OUTER_TOLERANCE = 30 // mm

const FIELD: Array<[keyof TitleBlock, string]> = [
  ['property', 'fastighetsbeteckning (t.ex. "Stockholm Gnejsen 6")'],
  ['address', 'adress'],
  ['apartments', 'lägenhetsnummer'],
  ['author', 'ritad av'],
]

// The largest scale that fits, trying the current orientation first.
function bestSheet(plan: Plan): Pick<Sheet, 'scale' | 'orientation'> | null {
  const cur = plan.sheet.orientation
  const other = cur === 'landscape' ? 'portrait' : 'landscape'
  let best: Pick<Sheet, 'scale' | 'orientation'> | null = null
  for (const orientation of [cur, other] as const) {
    const scale = fittingScale({ ...plan, sheet: { ...plan.sheet, orientation } })
    if (scale && (!best || scale < best.scale)) best = { scale, orientation }
  }
  return best && SCALES.includes(best.scale) ? best : null
}

// Outer faces of the exterior walls (all walls when none is marked).
function envelope(plan: Plan) {
  const walls = plan.walls.some((w) => w.exterior) ? plan.walls.filter((w) => w.exterior) : plan.walls
  const pts = walls.flatMap(wallQuad)
  return {
    minX: Math.min(...pts.map((p) => p.x)),
    maxX: Math.max(...pts.map((p) => p.x)),
    minY: Math.min(...pts.map((p) => p.y)),
    maxY: Math.max(...pts.map((p) => p.y)),
  }
}

// The floor, when the plan's name says it ("Källarvåningen", "plan 2", "1 tr").
function floorFrom(name: string): string | null {
  const n = name.toLowerCase()
  if (/källar/.test(n)) return 'Källarvåning'
  if (/vind/.test(n)) return 'Vindsvåning'
  const m = /(?:plan|våning)\s*(\d+)|(\d+)\s*tr\b/.exec(n)
  const num = m?.[1] ?? m?.[2]
  return num ? `Plan ${num}` : null
}

export function finishPlan(input: Plan, opts: FinishOptions = {}): Finish {
  let plan = input
  const ops: Op[] = []
  const done: string[] = []
  const apply = (op: Op) => {
    const res = applyOps(plan, [op])
    if (res.errors.length) throw new Error(res.errors.join('\n'))
    plan = res.plan
    ops.push(op)
  }

  if (plan.walls.length) {
    const best = bestSheet(plan)
    if (best && (best.scale !== plan.sheet.scale || best.orientation !== plan.sheet.orientation)) {
      apply({ op: 'setSheet', patch: best })
      done.push(`Blad: ${plan.sheet.paper} ${best.orientation === 'landscape' ? 'liggande' : 'stående'}, skala 1:${best.scale} (största skalan där planen får plats)`)
    } else if (!best) done.push(`Planen får inte plats på ${plan.sheet.paper} i någon skala – välj större papper`)

    if (plan.dimensions.length === 0) {
      const e = envelope(plan)
      const b = bounds(plan)
      const s = plan.sheet.scale
      // Below and left of the plan, clear of anything drawn outside the walls (outside stairs).
      apply({ op: 'add', kind: 'dimension', item: { id: 'm-bredd', a: { x: e.minX, y: e.maxY }, b: { x: e.maxX, y: e.maxY }, offset: -(b.maxY - e.maxY + s * 6) } })
      apply({ op: 'add', kind: 'dimension', item: { id: 'm-langd', a: { x: e.minX, y: e.minY }, b: { x: e.minX, y: e.maxY }, offset: -(e.minX - b.minX + s * 8) } })
      done.push(`Yttermått: ${Math.round(e.maxX - e.minX)} × ${Math.round(e.maxY - e.minY)} mm utvändigt`)
    }

    if (opts.markExteriorLoadBearing) {
      const todo = plan.walls.filter((w) => w.exterior && !w.loadBearing)
      for (const w of todo) apply({ op: 'update', kind: 'wall', id: w.id, patch: { loadBearing: true } })
      if (todo.length) done.push(`${todo.length} ytterväggar markerade som bärande`)
    }
  }

  if (!plan.sheet.titleBlock.floor.trim()) {
    const floor = floorFrom(plan.name)
    if (floor) {
      apply({ op: 'setTitleBlock', patch: { floor } })
      done.push(`Våningsplan: ${floor} (från planens namn)`)
    }
  }

  const findings = [...reviewPlan(plan).findings, ...checkPlan(plan)].filter((f) => f.code !== 'title-block' && (f.level !== 'info' || f.code === 'sealed'))

  const exterior = plan.walls.filter((w) => w.exterior)
  if (exterior.length) {
    const e = envelope(plan)
    const w = e.maxX - e.minX
    const l = e.maxY - e.minY
    if (!plan.openings.some((o) => o.kind === 'window'))
      findings.unshift({ level: 'warning', code: 'no-windows', message: 'Inga fönster i ytterväggarna. Stämmer det med ritningen? Kontrollera fasadritningar och planens fönstermarkeringar (plan_scan_openings, plan_scan_elevation).' })
    if (opts.printedOuter) {
      // The printed pair may be given in either order; compare the pairing that fits best.
      const { width: pw, length: pl } = opts.printedOuter
      const straight = Math.abs(w - pw) + Math.abs(l - pl)
      const swapped = Math.abs(w - pl) + Math.abs(l - pw)
      const [tw, tl] = straight <= swapped ? [pw, pl] : [pl, pw]
      const dw = Math.round(w - tw)
      const dl = Math.round(l - tl)
      if (Math.abs(dw) > OUTER_TOLERANCE || Math.abs(dl) > OUTER_TOLERANCE)
        findings.unshift({
          level: 'warning',
          code: 'outer-size',
          message: `Utvändigt mått ${Math.round(w)} × ${Math.round(l)} mm avviker från det tryckta ${tw} × ${tl} mm (${dw >= 0 ? '+' : ''}${dw} / ${dl >= 0 ? '+' : ''}${dl} mm). Kontrollera ytterväggarnas läge och tjocklek mot ritningen (plan_scan_snap_walls, plan_scan_view) och kör plan_finish igen.`,
        })
      else done.push(`Yttermåttet stämmer med det tryckta (${tw} × ${tl} mm, avvikelse ${dw} / ${dl} mm)`)
    } else findings.push({ level: 'info', code: 'outer-unchecked', message: 'Yttermåttet är inte jämfört med ritningens tryckta mått – ange printed_outer_mm (bredd och längd) om ritningen har dem.' })
  }

  const tb = plan.sheet.titleBlock
  const ask = FIELD.filter(([k]) => !String(tb[k] ?? '').trim()).map(([, label]) => label)
  if (!tb.floor.trim()) ask.push('våningsplan')
  if (exterior.length && !plan.walls.some((w) => w.loadBearing))
    ask.push('om ytterväggarna är bärande (murade eller betong; då markeras de bärande och hatchas – svara ja och kör plan_finish igen med mark_exterior_load_bearing)')
  return { ops, done, findings, ask, plan }
}
