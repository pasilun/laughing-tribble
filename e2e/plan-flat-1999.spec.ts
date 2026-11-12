import { test, expect } from '@playwright/test'
import { readFileSync } from 'fs'
import { validatePlan } from '@/lib/plan/domain/ops'
import type { Plan } from '@/lib/plan/domain/types'
import { connector, legacy } from './connector-helpers'

// The 1999 survey (A00:24) drawn as faithfully as the drawing allows: only what the drawing shows, no laser
// measurements and no later changes (the kitchen wall in 153 is whole, no shower cabins). Door swings are left out
// because the drawing does not show them; every door is a plain opening. It is the reference for tracing the survey
// from scratch, with the crop in a00-crop.png and its placement in case.json. Locked 2026-11-12 by the maintainer;
// change it only with them.

const F = 'e2e/fixtures/flat'
const fixture = () => JSON.parse(readFileSync(`${F}/drawing-1999.json`, 'utf8')) as Plan

test('the 1999 fixture is a valid plan of walls, masses and openings only', () => {
  const p = fixture()
  expect(validatePlan(p)).toEqual([])
  expect(p.walls).toHaveLength(35)
  expect(p.masses).toHaveLength(2)
  expect(p.openings).toHaveLength(30)
  expect(p.openings.filter((o) => o.kind === 'window')).toHaveLength(7)
  // No door swings: the drawing does not show them.
  expect(p.openings.filter((o) => o.kind === 'door' || o.hinge || o.swing)).toEqual([])
  expect(p.walls.every((w) => w.phase === 'existing')).toBe(true)
})

test('the 1999 fixture imports and renders over the survey crop', async ({ request }) => {
  const c = JSON.parse(readFileSync(`${F}/case.json`, 'utf8')) as { mm_per_px: number; x: number; y: number }
  const made = await connector(request, 'manage', { action: 'import', args: { name: `1999 ${Date.now()}`, plan: fixture() } })
  expect(made.isError, made.content[0].text).toBeFalsy()
  const id = made.structuredContent!.id!
  const added = await legacy(request, 'plan_source_add', { plan_id: id, base_revision: made.structuredContent!.revision, id: 'a00', role: 'archive', filename: 'a00-crop.png', data_base64: readFileSync(`${F}/a00-crop.png`).toString('base64'), mm_per_px: c.mm_per_px, x: c.x, y: c.y })
  expect(added.isError, added.content[0].text).toBeFalsy()
  const v = await connector(request, 'view', { id, view: 'overlay' })
  expect(v.isError, v.content[0].text).toBeFalsy()
  expect(v.content.at(-1)!.type).toBe('image')
})
