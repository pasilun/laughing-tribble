import { test, expect } from '@playwright/test'
import { centerCorner, faceToCenter, snapPoint } from '@/components/plan-editor/snap'
import { demoPlan } from '@/lib/plan/domain/demo'

test('face-traced wall becomes a centre line on the chosen side', () => {
  // Along +x in y-down coordinates, "left" is up (negative y).
  expect(faceToCenter({ x: 0, y: 0 }, { x: 4000, y: 0 }, 100, 'left')).toEqual({ a: { x: 0, y: -50 }, b: { x: 4000, y: -50 } })
  expect(faceToCenter({ x: 0, y: 0 }, { x: 4000, y: 0 }, 100, 'right')).toEqual({ a: { x: 0, y: 50 }, b: { x: 4000, y: 50 } })
  expect(faceToCenter({ x: 0, y: 0 }, { x: 4000, y: 0 }, 100, 'center')).toEqual({ a: { x: 0, y: 0 }, b: { x: 4000, y: 0 } })
})

test('consecutive centre lines meet at the outer corner', () => {
  const top = faceToCenter({ x: 0, y: 0 }, { x: 4000, y: 0 }, 100, 'left')
  const right = faceToCenter({ x: 4000, y: 0 }, { x: 4000, y: 3000 }, 100, 'left')
  expect(centerCorner(top.a, top.b, right.a, right.b)).toEqual({ x: 4050, y: -50 })
})

test('snapping: wall end, then right angle, then grid', () => {
  const plan = demoPlan()
  expect(snapPoint({ x: 6004, y: 3 }, plan, { tolerance: 20, grid: 10 })).toMatchObject({ kind: 'endpoint', pt: { x: 6000, y: 0 } })
  const ortho = snapPoint({ x: 2000, y: 1530 }, plan, { from: { x: 1000, y: 1500 }, tolerance: 20, grid: 10 })
  expect(ortho.kind).toBe('axis')
  expect(ortho.pt.y).toBe(1500)
  const grid = snapPoint({ x: 1234, y: 2345 }, plan, { tolerance: 5, grid: 10 })
  expect(grid).toMatchObject({ kind: 'grid', pt: { x: 1230, y: 2350 } })
  // Onto a wall's axis for T-junctions.
  expect(snapPoint({ x: 6012, y: 2000 }, plan, { tolerance: 20, grid: 10 })).toMatchObject({ kind: 'onwall', wallId: 'lgh-grans', pt: { x: 6000, y: 2000 } })
})

test('measuring snaps to wall surfaces and visible corners, not only the centre line', () => {
  const wall = (id: string, a: { x: number; y: number }, b: { x: number; y: number }, thickness: number) => ({ id, a, b, thickness, phase: 'existing' as const })
  // A 200 mm wall along y = 0 and a 100 mm wall meeting it from below at x = 3000 (T-junction).
  const plan = { ...demoPlan(), walls: [wall('a', { x: 0, y: 0 }, { x: 6000, y: 0 }, 200), wall('b', { x: 3000, y: 0 }, { x: 3000, y: 3000 }, 100)], openings: [], fixtures: [], rooms: [], dimensions: [], notes: [] }
  const o = { tolerance: 30, grid: 10, faces: true }
  // Near the lower surface of the wall (y = 100) away from the T: the surface, not the centre line.
  expect(snapPoint({ x: 1500, y: 110 }, plan, o)).toMatchObject({ kind: 'face', pt: { x: 1500, y: 100 } })
  // Near the middle it is still the centre line.
  expect(snapPoint({ x: 1500, y: 15 }, plan, o)).toMatchObject({ kind: 'onwall', pt: { x: 1500, y: 0 } })
  // Off, the centre line only (what wall drawing uses).
  expect(snapPoint({ x: 1500, y: 110 }, plan, { ...o, faces: false }).kind).not.toBe('face')
  // The corner where the thin wall meets the surface of the thick one.
  expect(snapPoint({ x: 3060, y: 108 }, plan, o)).toMatchObject({ kind: 'corner', pt: { x: 3050, y: 100 } })
  // The thin wall's corner inside the thick wall is hidden and is not offered.
  expect(snapPoint({ x: 3055, y: 55 }, plan, o).kind).not.toBe('corner')
  // Measuring horizontally from the left: the horizontal line meets the near surface of the thin wall (x = 2950), not its centre line.
  const hit = snapPoint({ x: 2960, y: 1505 }, plan, { ...o, from: { x: 1000, y: 1500 } })
  expect(hit).toMatchObject({ kind: 'face', pt: { x: 2950, y: 1500 } })
  // From the other side, the opposite surface.
  expect(snapPoint({ x: 3040, y: 1505 }, plan, { ...o, from: { x: 5000, y: 1500 } })).toMatchObject({ kind: 'face', pt: { x: 3050, y: 1500 } })
  // Without surfaces it is the centre line.
  expect(snapPoint({ x: 2985, y: 1505 }, plan, { ...o, faces: false, from: { x: 1000, y: 1500 } })).toMatchObject({ kind: 'onwall', pt: { x: 3000, y: 1500 } })
})
