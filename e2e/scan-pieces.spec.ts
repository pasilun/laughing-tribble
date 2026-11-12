import { test, expect } from '@playwright/test'
import { mergeStacked } from '@/lib/plan/scan/pieces'

test('two long strips with touching faces become one wall; short strips and separate walls stay apart', () => {
  // An exterior wall found as an outer strip (95 mm at y 7880) and an inner strip (234 mm at y 8064).
  const outer = { a: { x: 20000, y: 7880 }, b: { x: 28000, y: 7880 }, thickness: 95 }
  const inner = { a: { x: 20400, y: 8064 }, b: { x: 28400, y: 8064 }, thickness: 234 }
  const [m, ...rest] = mergeStacked([outer, inner])
  expect(rest).toEqual([])
  expect(m.thickness).toBe(Math.round(8064 + 117 - (7880 - 47.5)))
  expect(m.a.y).toBe(m.b.y)
  // A counter strip along a partition is short: left alone.
  const wall = { a: { x: 0, y: 0 }, b: { x: 0, y: 4000 }, thickness: 100 }
  const counter = { a: { x: 90, y: 500 }, b: { x: 90, y: 1500 }, thickness: 80 }
  expect(mergeStacked([wall, counter])).toHaveLength(2)
  // Two partitions a room apart: left alone.
  expect(mergeStacked([wall, { a: { x: 1500, y: 0 }, b: { x: 1500, y: 4000 }, thickness: 100 }])).toHaveLength(2)
})
