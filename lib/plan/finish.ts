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
}

export type Finish = {
  ops: Op[]
  done: string[]
  findings: Finding[]
  ask: string[]
  plan: Plan
}

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

  const findings = [...reviewPlan(plan).findings, ...checkPlan(plan)].filter((f) => f.code !== 'title-block' && (f.level !== 'info' || f.code === 'sealed'))
  const tb = plan.sheet.titleBlock
  const ask = FIELD.filter(([k]) => !String(tb[k] ?? '').trim()).map(([, label]) => label)
  return { ops, done, findings, ask, plan }
}
