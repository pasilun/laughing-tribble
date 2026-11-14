import { test, expect } from '@playwright/test'
import { readFileSync } from 'fs'
import { auditPlan } from '@/lib/plan/assist/audit'
import { hasFaceWalls } from '@/lib/plan/domain/faces'
import type { Plan } from '@/lib/plan/domain/types'

// The audit's wall fixes are written from the centre-line view. A face-referenced wall (wall.ref) must not get one:
// the fix would put the stored wall half a thickness off. lgh154-face.json has every wall on a room face.

const face = () => JSON.parse(readFileSync('e2e/fixtures/faces/lgh154-face.json', 'utf8')) as Plan

test('no wall item of a face-referenced plan carries a fix', async () => {
  const plan = face()
  expect(hasFaceWalls(plan)).toBe(true)
  const items = await auditPlan('faces-audit', plan)
  const walls = items.filter((i) => i.id.startsWith('wall:'))
  for (const item of walls) {
    expect(item.fix, item.id).toBeUndefined()
  }
})
