// Renders a plan to före/efter SVG + PNG for visual review.
//   npx tsx scripts/render-plan.ts [plan.json|demo] <outDir>
import { Resvg } from '@resvg/resvg-js'
import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { demoPlan } from '../lib/plan/demo'
import { renderSheet } from '../lib/plan/sheet'
import type { Plan } from '../lib/plan/types'

const [src = 'demo', out = '.visual/plan'] = process.argv.slice(2)
const plan: Plan = src === 'demo' ? demoPlan() : JSON.parse(readFileSync(src, 'utf8'))
mkdirSync(out, { recursive: true })
for (const view of ['fore', 'efter'] as const) {
  const svg = renderSheet(plan, view)
  writeFileSync(`${out}/${view}.svg`, svg)
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: 2400 }, font: { loadSystemFonts: true } }).render().asPng()
  writeFileSync(`${out}/${view}.png`, png)
  console.log(`${out}/${view}.png`)
}
