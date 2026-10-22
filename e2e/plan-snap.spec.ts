import { test, expect } from '@playwright/test'
import { centerCorner, faceToCenter, snapPoint } from '@/components/plan-editor/snap'
import { demoPlan } from '@/lib/plan/demo'

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
