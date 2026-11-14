import { test, expect } from '@playwright/test'
import { readFileSync } from 'fs'
import { centreLines } from '@/lib/plan/domain/faces'
import { comparePlans } from '@/lib/plan/assist/compare'
import type { Plan } from '@/lib/plan/domain/types'

// comparePlans measures walls on the centre-line view. lgh154-face.json stores every wall on a room face, so the
// stored lines differ from the view; compared with its own view, every wall must be 0 mm off.
const face = () => JSON.parse(readFileSync('e2e/fixtures/faces/lgh154-face.json', 'utf8')) as Plan

test('a face plan compared with its own centre-line view differs by 0 mm on every wall', () => {
  const plan = face()
  const cmp = comparePlans(plan, centreLines(plan))
  expect(cmp.walls.length).toBe(plan.walls.length)
  expect(cmp.walls.filter((w) => w.diffMm !== 0)).toEqual([])
  expect(cmp.wallsOnlyInRef).toEqual([])
  expect(cmp.wallsOnlyInPlan).toEqual([])
})
