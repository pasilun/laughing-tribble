import { test, expect } from '@playwright/test'
import { connector, makePlan } from './connector-helpers'

// A wall can be stored on a face (wall.ref) through edit; get says which line is stored. Changing ref on an existing
// wall is refused, since it would move the body by half the thickness.

const wall = (ref?: string) => ({ id: 's', a: { x: 0, y: 0 }, b: { x: 4000, y: 0 }, thickness: 300, phase: 'existing', ...(ref ? { ref } : {}) })

test('a wall added with ref is listed with the face it is stored on', async ({ request }) => {
  const { id, revision } = await makePlan(request, 'Ytor')
  const ed = await connector(request, 'edit', { id, base_revision: revision, ops: [{ op: 'add', kind: 'wall', item: wall('left') }] })
  expect(ed.isError, ed.content[0].text).toBeFalsy()
  const g = await connector(request, 'get', { id, parts: ['walls'] })
  expect(g.content[0].text).toContain('- s: (0,0)→(4000,0) längd 4000 tj 300 linjen är vänster yta existing')
})

test('ref must be left or right', async ({ request }) => {
  const { id, revision } = await makePlan(request, 'Ytor fel')
  const ed = await connector(request, 'edit', { id, base_revision: revision, ops: [{ op: 'add', kind: 'wall', item: wall('up') }] })
  expect(ed.structuredContent!.ok).toBe(false)
  expect(ed.content[0].text).toContain("ref är 'left' eller 'right'")
})

test('ref cannot be changed on an existing wall', async ({ request }) => {
  const { id, revision } = await makePlan(request, 'Ytor byte')
  const add = await connector(request, 'edit', { id, base_revision: revision, ops: [{ op: 'add', kind: 'wall', item: wall() }] })
  const ed = await connector(request, 'edit', { id, base_revision: add.structuredContent!.revision, ops: [{ op: 'update', kind: 'wall', id: 's', patch: { ref: 'left' } }] })
  expect(ed.structuredContent!.ok).toBe(false)
  expect(ed.content[0].text).toContain('ref kan inte ändras')
})

test('the guide explains ref on a wall', async ({ request }) => {
  const g = await connector(request, 'guide', { topic: 'ops' })
  expect(g.content[0].text).toContain('"ref"?:"left"|"right"')
})
