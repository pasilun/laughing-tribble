import { test, expect } from '@playwright/test'
import { connector, makePlan } from './connector-helpers'

// A refusal from the scan tools on a plan with face-referenced walls names the connector action, not the old tool name.

test('the refusal for missing_walls on a face plan names the action', async ({ request }) => {
  const { id, revision } = await makePlan(request, 'Ytor refusal')
  const wall = { id: 's', a: { x: 0, y: 0 }, b: { x: 4000, y: 0 }, thickness: 300, ref: 'left', phase: 'existing' }
  const ed = await connector(request, 'edit', { id, base_revision: revision, ops: [{ op: 'add', kind: 'wall', item: wall }] })
  expect(ed.isError, ed.content[0].text).toBeFalsy()
  const r = await connector(request, 'scan', { id, action: 'missing_walls', args: {} })
  expect(r.structuredContent!.ok).toBe(false)
  expect(r.content[0].text).toContain('missing_walls')
})
