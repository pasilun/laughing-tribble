import { test, expect } from '@playwright/test'
import { demoPlan } from '@/lib/plan/demo'
import { reviewPlan, roomKind } from '@/lib/plan/review'
import type { Opening, Plan, Room, Wall } from '@/lib/plan/types'

// Pure model tests — no browser needed.

const wall = (id: string, ax: number, ay: number, bx: number, by: number, extra: Partial<Wall> = {}): Wall => ({ id, a: { x: ax, y: ay }, b: { x: bx, y: by }, thickness: 100, phase: 'existing', ...extra })
const door = (id: string, wallId: string, offset: number, width: number, extra: Partial<Opening> = {}): Opening => ({ id, wallId, kind: 'door', offset, width, phase: 'existing', hinge: 'a', swing: 'right', ...extra })
const room = (id: string, name: string, x: number, y: number, apartment?: string): Room => ({ id, name, at: { x, y }, ...(apartment ? { apartment } : {}) })

// A stair hall (x 0–2000) and one flat: Tamb, WC and Kök along the north, a big Rum to the south.
function flat(): Plan {
  const ext = { exterior: true }
  return {
    ...demoPlan(),
    walls: [
      wall('n', 0, 0, 8000, 0, ext), wall('s', 0, 6000, 8000, 6000, ext), wall('w', 0, 0, 0, 6000, ext), wall('e', 8000, 0, 8000, 6000, ext),
      wall('lgh', 2000, 0, 2000, 6000), wall('tamb-wc', 4000, 0, 4000, 2000), wall('wc-kok', 5500, 0, 5500, 2000), wall('mitt', 2000, 2000, 8000, 2000),
    ],
    openings: [
      door('entre', 'lgh', 500, 900, { swing: 'left' }), // out into the stair hall… seen from a→b (down) left is east: into Tamb
      door('wc', 'tamb-wc', 600, 700), // right of a→b (down) is west: out into the Tamb
      door('rum', 'mitt', 500, 800),
      door('kok', 'mitt', 4000, 800),
      { id: 'f-rum', kind: 'window', wallId: 'e', offset: 3000, width: 1200, phase: 'existing' },
      { id: 'f-kok', kind: 'window', wallId: 'e', offset: 500, width: 1000, phase: 'existing' },
    ],
    fixtures: [],
    dimensions: [],
    rooms: [room('th', 'Trapphall', 1000, 3000), room('tamb', 'Tamb.', 3000, 1000, 'A'), room('wc', 'WC', 4750, 1000, 'A'), room('kok', 'Kök', 6750, 1000, 'A'), room('rum', 'Rum', 5000, 4000, 'A')],
  }
}
const codes = (p: Plan) => reviewPlan(p).findings.filter((f) => f.level !== 'info').map((f) => f.code)
const edit = (f: (p: Plan) => void) => { const p = flat(); f(p); return p }

test('room names map to their use', () => {
  expect(roomKind({ name: 'Tmb.' })).toBe('entry')
  expect(roomKind({ name: 'WC/dusch' })).toBe('wet')
  expect(roomKind({ name: 'Matvrå/Kök' })).toBe('kitchen')
  expect(roomKind({ name: 'Kv' })).toBe('kitchen')
  expect(roomKind({ name: 'G' })).toBe('closet')
  expect(roomKind({ name: 'Rum' })).toBe('habitable')
  expect(roomKind({ name: 'Trapphall' })).toBe('common')
})

test('a sound flat reviews clean: one entrance into the Tamb, every room reached', () => {
  const r = reviewPlan(flat())
  expect(r.findings.filter((f) => f.level !== 'info')).toEqual([])
  expect(r.flats).toEqual([expect.objectContaining({ apartment: 'A', entrances: ['entre'] })])
})

test('the walk through a flat finds what is wrong with it', () => {
  // no way in
  expect(codes(edit((p) => (p.openings = p.openings.filter((o) => o.id !== 'entre'))))).toContain('no-entrance')
  // a second way in, straight into the Rum
  expect(codes(edit((p) => p.openings.push(door('entre2', 'lgh', 4000, 900))))).toEqual(expect.arrayContaining(['entrances', 'entrance-room']))
  // the kitchen belongs to another flat: a door between flats, and that flat has no entrance
  expect(codes(edit((p) => (p.rooms.find((r) => r.id === 'kok')!.apartment = 'B')))).toEqual(expect.arrayContaining(['between-flats', 'no-entrance']))
  // a room with no door
  expect(codes(edit((p) => (p.openings = p.openings.filter((o) => o.id !== 'kok'))))).toContain('no-door')
  // the WC also opens into the kitchen
  expect(codes(edit((p) => p.openings.push(door('wc2', 'wc-kok', 600, 700))))).toEqual(expect.arrayContaining(['wet-doors', 'wc-to-kitchen']))
  // a WC door swinging in (the user's rule: toilets open out)
  expect(codes(edit((p) => (p.openings.find((o) => o.id === 'wc')!.swing = 'left')))).toContain('wc-door-inward')
  // an opening in a free-standing wall stub, and a scan gap too narrow to be a door
  expect(codes(edit((p) => { p.walls.push(wall('stub', 6000, 4000, 7000, 4000)); p.openings.push({ id: 'gap', kind: 'opening', wallId: 'stub', offset: 300, width: 400, phase: 'existing' }) }))).toContain('same-space')
  expect(codes(edit((p) => p.openings.push({ id: 'gap', kind: 'opening', wallId: 'tamb-wc', offset: 1500, width: 300, phase: 'existing' })))).toContain('too-narrow')
  // a habitable room without a window
  expect(codes(edit((p) => (p.openings = p.openings.filter((o) => o.id !== 'f-rum'))))).toContain('no-window')
})

test('a door that slams into a closet is flagged; the same door opening out is not', () => {
  // A 0.6 m closet in the Rum's south-west corner.
  const withCloset = (swing: 'left' | 'right') =>
    edit((p) => {
      p.walls.push(wall('g-n', 2000, 5300, 2700, 5300), wall('g-o', 2700, 5300, 2700, 6000))
      p.openings.push(door('g', 'g-n', 100, 500, { swing }))
      p.rooms.push(room('g', 'G', 2350, 5650, 'A'))
    })
  // g-n runs east: left is north (the Rum), right is south (into the closet)
  expect(codes(withCloset('right'))).toContain('door-into-small')
  expect(codes(withCloset('left'))).not.toContain('door-into-small')
})

test('a plan that stops at the stair hall takes the outside of the drawing as the common side', () => {
  const p = edit((p) => {
    p.walls = p.walls.filter((w) => w.id !== 'w')
    p.walls.find((w) => w.id === 'n')!.a.x = 2000
    p.walls.find((w) => w.id === 's')!.a.x = 2000
    p.rooms = p.rooms.filter((r) => r.id !== 'th')
  })
  const r = reviewPlan(p)
  expect(r.flats[0].entrances).toEqual(['entre'])
  expect(r.findings.filter((f) => f.level !== 'info')).toEqual([])
})
