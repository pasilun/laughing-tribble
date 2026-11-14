import { test, expect } from '@playwright/test'
import { readFileSync } from 'fs'
import type { Op } from '@/lib/plan/domain/ops'
import type { Plan } from '@/lib/plan/domain/types'
import { connector, legacy } from './connector-helpers'

// scan (action "snap_walls") with a rough wall whose id the plan already has: the wall is re-fitted from the new rough
// ends (here: extended to where the drawing ends it), proposed as an update that keeps its openings, not a second wall.

const F = 'e2e/fixtures/flat'

test('a rough wall with an existing id re-fits that wall and keeps its openings', async ({ request }) => {
  test.setTimeout(90_000)
  const ref = JSON.parse(readFileSync(`${F}/drawing-1999.json`, 'utf8')) as Plan
  const c = JSON.parse(readFileSync(`${F}/case.json`, 'utf8')) as { mm_per_px: number; x: number; y: number }
  const full = ref.walls.find((w) => w.id === 'iv-152-ö')!
  const short = { ...full, b: { x: full.b.x, y: full.b.y - 2000 } }
  const keep = ref.openings.filter((o) => o.wallId !== short.id || o.offset + o.width <= short.b.y - short.a.y)
  const plan = { ...ref, walls: ref.walls.map((w) => (w.id === short.id ? short : w)), openings: keep }
  const made = await connector(request, 'manage', { action: 'import', args: { name: `Omfäst ${Date.now()}`, plan } })
  const id = made.structuredContent!.id!
  const added = await legacy(request, 'plan_source_add', { plan_id: id, base_revision: made.structuredContent!.revision, id: 'a00', role: 'archive', filename: 'a00-crop.png', data_base64: readFileSync(`${F}/a00-crop.png`).toString('base64'), mm_per_px: c.mm_per_px, x: c.x, y: c.y })
  expect(added.isError, added.content[0].text).toBeFalsy()

  // Rough ends, about 60 mm off the drawn line, the far end at the crossing wall.
  const rough = { id: short.id, a: { x: short.a.x + 60, y: short.a.y }, b: { x: short.b.x + 60, y: full.b.y } }
  const snap = await connector(request, 'scan', { id, action: 'snap_walls', args: { walls: [rough] } })
  expect(snap.isError, snap.content[0].text).toBeFalsy()
  const ops = snap.structuredContent!.next![0].arguments.ops as Op[]
  expect(ops.some((o) => o.op === 'add')).toBe(false)
  const up = ops.find((o) => o.op === 'update' && o.kind === 'wall' && o.id === short.id)
  expect(up, JSON.stringify(ops)).toBeTruthy()

  const applied = await connector(request, 'edit', snap.structuredContent!.next![0].arguments)
  expect(applied.isError, applied.content[0].text).toBeFalsy()
  const after = (await (await request.get(`/api/plans/${id}`)).json()).plan as Plan
  const w = after.walls.find((x) => x.id === short.id)!
  expect(after.walls.filter((x) => x.id === short.id)).toHaveLength(1)
  // Back on the drawn line, and as long as the drawing has it.
  expect(Math.abs(w.a.x - full.a.x)).toBeLessThanOrEqual(30)
  expect(Math.abs(w.b.y - full.b.y)).toBeLessThanOrEqual(150)
  // Its other fields are kept, and its openings stay where they are drawn (the offset follows a moved a-end).
  expect(w.phase).toBe(short.phase)
  for (const o of keep.filter((o) => o.wallId === short.id)) expect(Math.abs(w.a.y + after.openings.find((x) => x.id === o.id)!.offset - (short.a.y + o.offset))).toBeLessThanOrEqual(1)
})
