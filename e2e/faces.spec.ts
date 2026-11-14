import { test, expect } from '@playwright/test'
import { readFileSync } from 'fs'
import { centreLines, centreShift } from '@/lib/plan/domain/faces'
import { validatePlan } from '@/lib/plan/domain/ops'
import { roomAreas } from '@/lib/plan/domain/rooms'
import type { Plan, Wall } from '@/lib/plan/domain/types'

// Walls stored on a face (wall.ref) and the centre-line view the rest of the code reads. lgh154-face.json is lgh 154
// with every wall stored on a room face (the spike of 2026-11-11, spikes/face-walls/).

const face = () => JSON.parse(readFileSync('e2e/fixtures/faces/lgh154-face.json', 'utf8')) as Plan
// Room areas are read from the view, as every reader of the plan does while the view exists.
const area = (p: Plan, room: string) => Math.round(roomAreas(centreLines(p), 'fore').get(room)! / 1e3) / 1e3
const noPolygons = (p: Plan): Plan => ({ ...p, rooms: p.rooms.map((r) => ({ ...r, polygon: undefined })) })

test('a plan with no face-referenced wall is its own view', () => {
  for (const f of ['e2e/fixtures/flat/drawing-1999.json', 'e2e/fixtures/golden/reference.json']) {
    const p = JSON.parse(readFileSync(f, 'utf8')) as Plan
    expect(centreLines(p)).toBe(p)
  }
})

test('the view of lgh 154 on faces is a valid plan with the same room areas as the centre-line plan', () => {
  const v = centreLines(face())
  expect(validatePlan(v)).toEqual([])
  expect(v.walls.some((w) => 'ref' in w)).toBe(false)
  expect([area(v, 'Garderob'), area(v, 'Hall'), area(v, 'Sovrum'), area(v, 'Vardagsrum'), area(v, 'WC')]).toEqual([4.39, 1.224, 3.887, 12.389, 2.346])
  // Applying it twice is the same as once.
  expect(centreLines(v)).toBe(v)
})

test('a thinner face-referenced wall keeps its face, and the room keeps its area', () => {
  const p = noPolygons(face())
  const id = 'W:Sovrum.south:outer'
  const face0 = (q: Plan) => {
    const w = centreLines(q).walls.find((x) => x.id === id)!
    return { inner: w.a.y - w.thickness / 2, outer: w.a.y + w.thickness / 2 }
  }
  expect(face0(p)).toEqual({ inner: 4540, outer: 4840 })
  const thin: Plan = { ...p, walls: p.walls.map((w) => (w.id === id ? { ...w, thickness: 200 } : w)) }
  expect(face0(thin)).toEqual({ inner: 4540, outer: 4740 })
  expect(area(thin, 'Sovrum')).toBe(area(p, 'Sovrum'))
  // The same change on the centre-line plan moves both faces and changes the room.
  const centre = centreLines(p)
  const c2: Plan = { ...centre, walls: centre.walls.map((w) => (w.id === id ? { ...w, thickness: 200 } : w)) }
  const w2 = c2.walls.find((x) => x.id === id)!
  expect([w2.a.y - 100, w2.a.y + 100]).toEqual([4590, 4790])
  expect(area(c2, 'Sovrum')).toBeGreaterThan(area(p, 'Sovrum'))
})

test('a face-referenced wall meets a centre-line wall and a wall at 45° at one point', () => {
  const walls: Wall[] = [
    { id: 'north', a: { x: 0, y: 0 }, b: { x: 4000, y: 0 }, thickness: 300, ref: 'right', phase: 'existing' },
    { id: 'west', a: { x: 0, y: 0 }, b: { x: 0, y: 3000 }, thickness: 200, phase: 'existing' },
    { id: 'slant', a: { x: 4000, y: 0 }, b: { x: 6000, y: 2000 }, thickness: 300, ref: 'right', phase: 'existing' },
  ]
  const v = centreLines({ walls })
  const at = (id: string) => v.walls.find((w) => w.id === id)!
  // Body to the north: the centre line is 150 mm above the stored face.
  expect(centreShift(walls[0])).toEqual({ x: 0, y: -150 })
  expect(at('north').a).toEqual(at('west').a)
  expect(at('north').b).toEqual(at('slant').a)
})

test('an opening stays where it is drawn when the view moves its wall\'s a-end', () => {
  const walls: Wall[] = [
    { id: 'n', a: { x: 0, y: 0 }, b: { x: 4000, y: 0 }, thickness: 300, ref: 'right', phase: 'existing' },
    { id: 'w', a: { x: 0, y: 0 }, b: { x: 0, y: 3000 }, thickness: 200, ref: 'left', phase: 'existing' },
  ]
  const openings = [{ id: 'o', wallId: 'n', kind: 'window' as const, offset: 1000, width: 900, phase: 'existing' as const }]
  const v = centreLines({ walls, openings })
  const n = v.walls.find((x) => x.id === 'n')!
  // The face's a-end is at x 0; the view runs the centre line to the west wall's centre line, 100 mm further west.
  expect(n.a.x).toBe(-100)
  expect(n.a.x + v.openings![0].offset).toBe(1000)
})
