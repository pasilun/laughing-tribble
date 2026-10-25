// Scores an opening detector against a reference plan: runs it on a source
// of a plan, adds every find to a copy (in memory), and reports which finds
// match a reference opening (true) and which don't (false). Development
// aid: the plan itself is not changed.
//   npx tsx scripts/eval-openings.ts <plan> <reference> <source> <method,...> [--rescan]
// --rescan first drops the openings that source alone gave, to score them anew.
process.env.PLAN_STORE ??= 'fs'
import { comparePlans } from '../lib/plan/compare'
import { loadPlan } from '../lib/plan/service'
import { newOpenings } from '../lib/plan/scan/openings'
import { loadGray, resolveSource } from '../lib/plan/scan/raster'

async function main() {
  const [planId, refId, sourceId, methods, flag] = process.argv.slice(2)
  const loaded = (await loadPlan(planId))!.plan
  const plan = flag === '--rescan' ? { ...loaded, openings: loaded.openings.filter((o) => !o.evidence?.length || o.evidence.some((e) => e.source !== sourceId)) } : loaded
  const ref = (await loadPlan(refId))!.plan
  const r = resolveSource(plan, sourceId)
  const g = await loadGray(planId, r)
  const found = newOpenings(g, r, plan, undefined, undefined, methods.split(',')).openings
  const before = comparePlans(plan, ref).openings.matched.length
  const c = comparePlans({ ...plan, openings: [...plan.openings, ...found] }, ref)
  const hits = new Set(c.openings.matched.map((m) => m.id))
  const ok = found.filter((o) => hits.has(o.id))
  console.log(`${found.length} finds: ${ok.length} match the reference, ${found.length - ok.length} don't (matched before: ${before}, after: ${c.openings.matched.length})`)
  for (const o of found) {
    const m = c.openings.matched.find((x) => x.id === o.id)
    console.log(`${m ? '✓' : '✗'} ${o.id} ${o.wallId} ${o.offset}/${o.width} [${o.evidence?.[0]?.method}]${m ? ` = ${m.refId} (centre ${m.centreDiffMm} mm, width ${m.widthDiffMm > 0 ? '+' : ''}${m.widthDiffMm} mm)` : ''}`)
  }
}
main()
