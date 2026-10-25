import { test, expect } from '@playwright/test'

// Plan API: revisions, conflicts, issuing and exports.

test('plan revisions, conflict guard and exports', async ({ request }) => {
  const created = await request.post('/api/plans', { data: { name: 'API-test', template: 'demo' } })
  expect(created.status()).toBe(201)
  const { plan, revision } = await created.json()
  expect(revision.n).toBe(1)
  const id = plan.id as string

  const edit = await request.post(`/api/plans/${id}/ops`, {
    data: { baseRevision: 1, author: 'claude', message: 'Bredda', ops: [{ op: 'update', kind: 'opening', id: 'ny-oppning', patch: { width: 1000 } }] },
  })
  expect(edit.status()).toBe(200)
  expect((await edit.json()).revision.n).toBe(2)

  // A stale base revision is rejected and nothing is written.
  const stale = await request.post(`/api/plans/${id}/ops`, { data: { baseRevision: 1, ops: [] } })
  expect(stale.status()).toBe(409)

  // Invalid edits are rejected as a whole.
  const bad = await request.post(`/api/plans/${id}/ops`, {
    data: { baseRevision: 2, ops: [{ op: 'update', kind: 'opening', id: 'ny-oppning', patch: { offset: 99999 } }] },
  })
  expect(bad.status()).toBe(422)

  const old = await (await request.get(`/api/plans/${id}?rev=1`)).json()
  expect(old.plan.openings.find((o: { id: string }) => o.id === 'ny-oppning').width).toBe(900)

  const issued = await (await request.post(`/api/plans/${id}/issue`, { data: {} })).json()
  expect(issued.revision.issued).toBe('A')
  expect(issued.plan.sheet.titleBlock.revision).toBe('A')

  const revs = await (await request.get(`/api/plans/${id}/revisions`)).json()
  expect(revs.revisions.map((r: { n: number }) => r.n)).toEqual([1, 2, 3])

  const svg = await request.get(`/api/plans/${id}/sheet?view=efter&format=svg`)
  expect(svg.headers()['content-type']).toContain('image/svg+xml')
  expect(await svg.text()).toContain('width="420mm"')

  const pdf = await request.get(`/api/plans/${id}/sheet?view=both&format=pdf`)
  expect(pdf.headers()['content-type']).toBe('application/pdf')
  const body = await pdf.body()
  expect(body.subarray(0, 5).toString()).toBe('%PDF-')
  // A3 landscape in points.
  expect(body.toString('latin1')).toMatch(/MediaBox \[0 0 1190\.55\d* 841\.88\d*\]/)

  const dxf = await request.get(`/api/plans/${id}/sheet?view=efter&format=dxf`)
  const dxfText = await dxf.text()
  expect(dxfText).toContain('AC1009')
  expect(dxfText).toContain('A-VAGG-RIV')

  const checks = await (await request.get(`/api/plans/${id}/checks`)).json()
  expect(checks.findings.some((f: { code: string }) => f.code === 'fire')).toBe(true)
})

test('two saves from the same revision at once: one is kept, the other is a conflict', async ({ request }) => {
  const created = await (await request.post('/api/plans', { data: { name: 'Samtidig' } })).json()
  const id = created.plan.id as string
  const add = (n: number) => ({ op: 'add', kind: 'wall', item: { id: `v${n}`, a: { x: 0, y: n * 500 }, b: { x: 3000, y: n * 500 }, thickness: 100, phase: 'existing' } })
  const [a, b] = await Promise.all([1, 2].map((n) => request.post(`/api/plans/${id}/ops`, { data: { baseRevision: 1, ops: [add(n)], message: `vägg ${n}` } })))
  const statuses = [a.status(), b.status()].sort()
  expect(statuses).toEqual([200, 409])
  const revs = (await (await request.get(`/api/plans/${id}/revisions`)).json()).revisions as Array<{ n: number }>
  expect(revs.map((r) => r.n)).toEqual([1, 2])
  const head = await (await request.get(`/api/plans/${id}`)).json()
  expect(head.plan.walls).toHaveLength(1)
})
