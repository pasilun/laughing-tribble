import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { Resvg } from '@resvg/resvg-js'
import { centred } from './centred'
import { validatePlan } from '../../lib/plan/domain/ops'
import { roomAreas } from '../../lib/plan/domain/rooms'
import { renderSheet } from '../../lib/plan/domain/sheet'
import { checkPlan } from '../../lib/plan/domain/checks'
const stored = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const out = process.argv[3]; mkdirSync(out, { recursive: true })
const show = (label: string, plan0: any, noPolygons = false) => {
  const plan = noPolygons ? { ...plan0, rooms: plan0.rooms.map(({ polygon, ...r }: any) => r) } : plan0
  const view = centred(plan)
  const sw = view.walls.find((w: any) => w.id === 'W:Sovrum.south:outer'); console.log('  south wall of Sovrum: inner face y', sw.a.y - sw.thickness / 2, 'outer face y', sw.a.y + sw.thickness / 2)
  console.log(label, 'validate', validatePlan(view).length, 'checks', checkPlan(view).filter((c: any) => !c.code.startsWith('title')).map((c: any) => c.code + ':' + c.message.slice(0, 60)))
  console.log('  areas', [...roomAreas(view, 'fore')].map(([k, v]) => `${k} ${(v / 1e6).toFixed(3)}`).join(', '))
  const svg = renderSheet(view, 'fore'); const png = new Resvg(svg, { fitTo: { mode: 'width', value: 2400 }, font: { loadSystemFonts: true } }).render().asPng()
  writeFileSync(`${out}/${label}.png`, png)
  return view
}
const v = show('face', stored)
for (const id of ['W:Garderob.north:outer', 'W:Garderob.west:outer', 'W:Garderob.east|Hall.west', 'W:Sovrum.south:outer'])
  console.log('  ', id, JSON.stringify(stored.walls.find((w: any) => w.id === id) && { a: stored.walls.find((w: any) => w.id === id).a, b: stored.walls.find((w: any) => w.id === id).b, ref: stored.walls.find((w: any) => w.id === id).ref }), '->', JSON.stringify({ a: v.walls.find((w: any) => w.id === id).a, b: v.walls.find((w: any) => w.id === id).b }))
// "Trim the facade from the outside": the south wall of Sovrum 300 -> 200. One field changes; the inner face stays.
const thin = JSON.parse(JSON.stringify(stored)); thin.walls.find((w: any) => w.id === 'W:Sovrum.south:outer').thickness = 200
show('face-nopoly', stored, true)
show('face-thin', thin, true)
// The same edit on a centre-line plan (today): thickness only, the centre line stays, so both faces move.
const centre = centred(stored); const c2 = JSON.parse(JSON.stringify(centre)); c2.walls.find((w: any) => w.id === 'W:Sovrum.south:outer').thickness = 200
show('centre-thin', c2, true)
