import { test, expect } from '@playwright/test'
import { connector, legacy, makePlan } from './connector-helpers'

// Until the drawing's readers read a wall's body, the ones that measure across a wall or write walls and openings
// refuse a plan with walls stored on a face, and nothing is changed.

test('scan readers and trace refuse a plan with a face-referenced wall', async ({ request }) => {
  const { id, revision } = await makePlan(request, 'Ytor skanning')
  const wall = { id: 's', a: { x: 0, y: 0 }, b: { x: 4000, y: 0 }, thickness: 300, ref: 'left', phase: 'existing' }
  const ed = await connector(request, 'edit', { id, base_revision: revision, ops: [{ op: 'add', kind: 'wall', item: wall }] })
  expect(ed.isError, ed.content[0].text).toBeFalsy()
  const rev = ed.structuredContent!.revision!
  for (const action of ['snap_walls', 'openings', 'doors', 'missing_walls']) {
    const r = await connector(request, 'scan', { id, action, args: action === 'snap_walls' ? { wall_ids: ['s'] } : {} })
    expect(r.content[0].text, action).toContain('hanterar ännu inte väggar som lagras på en yta')
  }
  const c = await connector(request, 'scan', { id, action: 'candidates', args: { region: [0, 0, 4000, 4000] } })
  expect(c.structuredContent!.ok).toBe(false)
  expect(c.content[0].text).toContain('hanterar ännu inte väggar som lagras på en yta')
  const t = await connector(request, 'source', { id, base_revision: rev, action: 'trace', args: {} })
  expect(t.content[0].text).toContain('hanterar ännu inte väggar som lagras på en yta')
  // The old connector's tools refuse the same way.
  const old = await legacy(request, 'plan_scan_openings', { plan_id: id })
  expect(old.content[0].text).toContain('hanterar ännu inte väggar som lagras på en yta')
  const after = await connector(request, 'get', { id, parts: ['walls'] })
  expect(after.structuredContent!.revision).toBe(rev)
})
