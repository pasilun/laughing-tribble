import { test, expect } from '@playwright/test'
import { readFileSync } from 'fs'
import { scorePlan } from '@/lib/plan/bench/score'
import type { Plan } from '@/lib/plan/domain/types'

const ref = () => JSON.parse(readFileSync('e2e/fixtures/flat/drawing-1999.json', 'utf8')) as Plan

test('the fixture scored against itself is perfect', () => {
  const s = scorePlan(ref(), ref())
  expect(s.walls.recall).toEqual({ '50': 1, '100': 1, '200': 1 })
  expect(s.walls.precision100).toBe(1)
  expect(s.walls.medianOffsetMm).toBe(0)
  expect(s.openings.doorways).toEqual({ reference: 23, found: 23, extra: 0 })
  expect(s.openings.windows).toEqual({ reference: 7, found: 7, extra: 0 })
})

test('walls moved 150 mm count within 200 but not within 100; an empty plan scores zero', () => {
  const moved = ref()
  moved.walls = moved.walls.map((w) => ({ ...w, a: { x: w.a.x + 150, y: w.a.y + 150 }, b: { x: w.b.x + 150, y: w.b.y + 150 } }))
  const s = scorePlan(ref(), moved)
  // A few reference walls run within 100 mm of another one, so a little still lines up by chance.
  expect(s.walls.recall['100']).toBeLessThan(0.15)
  expect(s.walls.recall['200']).toBeGreaterThan(0.8)
  const empty = { ...ref(), walls: [], openings: [] }
  expect(scorePlan(ref(), empty).walls.recall['200']).toBe(0)
  expect(scorePlan(ref(), empty).openings.doorways.found).toBe(0)
})
