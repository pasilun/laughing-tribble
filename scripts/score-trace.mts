// How good is a traced plan? The printed dimensions are the truth.
//   npx tsx scripts/score-trace.mts <host> <key> <plan-id> [--printed 6080x10500] [--reference <plan-id>]
// Prints the outside size against the printed one, what plan_finish would still flag
// (dry run, nothing saved), and, with --reference, the wall and opening match against
// another plan of the same floor (e2e/golden.ts judge).
import { judge } from '../e2e/golden'
import { finishPlan } from '../lib/plan/finish'
import { wallQuad } from '../lib/plan/geometry'
import { roomAreas } from '../lib/plan/rooms'
import type { Plan } from '../lib/plan/types'

const [host, key, id, ...rest] = process.argv.slice(2)
if (!host || !key || !id) {
  console.error('npx tsx scripts/score-trace.mts <host> <key> <plan-id> [--printed 6080x10500] [--reference <plan-id>]')
  process.exit(1)
}
const opt = (name: string) => {
  const i = rest.indexOf(`--${name}`)
  return i < 0 ? undefined : rest[i + 1]
}
const get = async (pid: string): Promise<Plan> => {
  const r = await fetch(new URL(`/api/plans/${pid}`, host), { headers: { Authorization: `Bearer ${key}` } })
  if (!r.ok) throw new Error(`${pid}: ${r.status}`)
  return (await r.json()).plan
}

const plan = await get(id)
const walls = plan.walls.some((w) => w.exterior) ? plan.walls.filter((w) => w.exterior) : plan.walls
const pts = walls.flatMap(wallQuad)
const w = Math.round(Math.max(...pts.map((p) => p.x)) - Math.min(...pts.map((p) => p.x)))
const l = Math.round(Math.max(...pts.map((p) => p.y)) - Math.min(...pts.map((p) => p.y)))
const printed = opt('printed')?.split('x').map(Number)

console.log(`${plan.name} (${id})`)
console.log(`yttermått ${w} × ${l} mm${printed ? `, tryckt ${printed[0]} × ${printed[1]}: ${w - printed[0] >= 0 ? '+' : ''}${w - printed[0]} / ${l - printed[1] >= 0 ? '+' : ''}${l - printed[1]} mm` : ''}`)
console.log(`väggar ${plan.walls.length}, öppningar ${plan.openings.length} (fönster ${plan.openings.filter((o) => o.kind === 'window').length}, dörrar ${plan.openings.filter((o) => o.kind === 'door').length}), inredning ${plan.fixtures.length}, källor ${plan.sources?.length ?? 0}`)
const areas = roomAreas(plan, 'fore')
console.log('rum: ' + plan.rooms.map((r) => `${r.name} ${areas.get(r.id) !== undefined ? (areas.get(r.id)! / 1e6).toFixed(1) : '–'} m²`).join(', '))

const fin = finishPlan(plan, printed ? { printedOuter: { width: printed[0], length: printed[1] } } : {})
console.log(`\nplan_finish skulle ${fin.ops.length ? 'göra' : 'inte göra något'}: ${fin.done.join('; ') || '–'}`)
for (const f of fin.findings) console.log(`  [${f.level}] ${f.message}`)
if (fin.ask.length) console.log(`  frågor till användaren: ${fin.ask.join('; ')}`)

const ref = opt('reference')
if (ref) {
  // The reference may sit at another origin: move the plan's outer north-west corner onto it.
  const refPlan = await get(ref)
  const corner = (p: Plan) => {
    const q = (p.walls.some((x) => x.exterior) ? p.walls.filter((x) => x.exterior) : p.walls).flatMap(wallQuad)
    return { x: Math.min(...q.map((s) => s.x)), y: Math.min(...q.map((s) => s.y)) }
  }
  const a = corner(plan)
  const b = corner(refPlan)
  const dx = b.x - a.x
  const dy = b.y - a.y
  const mv = (p: { x: number; y: number }) => ({ x: p.x + dx, y: p.y + dy })
  const moved: Plan = { ...plan, walls: plan.walls.map((x) => ({ ...x, a: mv(x.a), b: mv(x.b) })), fixtures: plan.fixtures.map((x) => ({ ...x, ...mv(x) })), rooms: plan.rooms.map((x) => ({ ...x, at: mv(x.at) })), masses: (plan.masses ?? []).map((m) => ({ ...m, points: m.points.map(mv) })) }
  const s = judge(moved, refPlan, { symbols: false })
  console.log(`\nmot referensen ${ref}:\n${s.report}`)
}
