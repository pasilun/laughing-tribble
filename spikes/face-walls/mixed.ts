import { centred } from './centred'
// A face-referenced wall meeting (1) a centre-line wall, as in a plan that is only partly measured, and (2) a wall at 45°.
const plan = { walls: [
  { id: 'north', a: { x: 0, y: 0 }, b: { x: 4000, y: 0 }, thickness: 300, ref: 'right' as const },   // room face, body north
  { id: 'west-centre', a: { x: 0, y: 0 }, b: { x: 0, y: 3000 }, thickness: 200 },                     // drawn the old way
  { id: 'slant', a: { x: 4000, y: 0 }, b: { x: 6000, y: 2000 }, thickness: 300, ref: 'right' as const },
] }
for (const w of centred(plan).walls) console.log(w.id, JSON.stringify(w.a), JSON.stringify(w.b))
