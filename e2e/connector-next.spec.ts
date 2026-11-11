import { test, expect } from '@playwright/test'
import { demoPlan } from '@/lib/plan/domain/demo'
import { nextCalls } from '@/lib/plan/connector/next'

test('nextCalls follows the plan', () => {
  const empty = { ...demoPlan('p'), walls: [], openings: [], rooms: [], fixtures: [], dimensions: [], sources: [] }
  expect(nextCalls(empty, 1).next).toEqual([{ tool: 'source', arguments: { id: 'p', action: 'upload_link' }, why: expect.any(String) }])
  const src = { ...empty, sources: [{ id: 's1', name: 'x', role: 'archive' as const, src: 'a', widthPx: 1, heightPx: 1, mmPerPx: 1, x: 0, y: 0, rotation: 0 }] }
  expect(nextCalls(src, 1).next[0]).toMatchObject({ tool: 'source', arguments: { id: 'p', action: 'calibrate' } })
  const cal = { ...src, sources: [{ ...src.sources[0], calibration: '3 mått' }] }
  expect(nextCalls(cal, 1).next[0]).toMatchObject({ tool: 'scan', arguments: { action: 'trace' } })
  const demo = demoPlan('d')
  const withSource = { ...demo, sources: cal.sources }
  expect(nextCalls(withSource, 4, { openIssues: 2 }).next[0]).toMatchObject({ tool: 'check', arguments: { id: 'd', scope: ['audit'] } })
  expect(nextCalls(demo, 4).next.some((n) => n.tool === 'check' && JSON.stringify(n.arguments.scope) === '["audit"]')).toBe(false)
  const noRooms = { ...demo, rooms: [] }
  const n = nextCalls(noRooms, 4, { openIssues: 0 }).next[0]
  expect(n.tool).toBe('edit'); expect(n.arguments.base_revision).toBe(4)
  const done = nextCalls(demo, 4, { openIssues: 0 })
  expect(done.next.length === 0 ? done.note : done.next[0].tool).toBeTruthy()
})
