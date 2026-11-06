import { test, expect } from '@playwright/test'

test('plan list: search, pages of ten, delete with a confirmation step', async ({ page, request }) => {
  const tag = `Listtest${Date.now()}`
  for (let i = 1; i <= 12; i++) await request.post('/api/plans', { data: { name: `${tag} plan ${String(i).padStart(2, '0')}` } })

  await page.goto('/plans')
  await page.getByTestId('plan-filter').fill(tag)
  await expect(page.getByTestId('plan-count')).toContainText('12 av')
  await expect(page.getByTestId('plan-row')).toHaveCount(10)
  await expect(page.getByTestId('page-info')).toHaveText('Sida 1 av 2')
  await expect(page.getByTestId('page-prev')).toBeDisabled()

  await page.getByTestId('page-next').click()
  await expect(page.getByTestId('plan-row')).toHaveCount(2)
  await expect(page.getByTestId('page-info')).toHaveText('Sida 2 av 2')
  await expect(page.getByTestId('page-next')).toBeDisabled()

  // Delete asks first: Avbryt leaves the plan, the second click moves it to the trash.
  const first = page.getByTestId('plan-row').first()
  const label = (await first.getByTestId('plan-name').textContent())!
  await first.getByTestId('delete-plan').click()
  await first.getByRole('button', { name: 'Avbryt' }).click()
  await expect(page.getByTestId('plan-row')).toHaveCount(2)
  await first.getByTestId('delete-plan').click()
  await first.getByTestId('delete-yes').click()
  await expect(page.getByTestId('notice')).toContainText('papperskorgen')
  await expect(page.getByTestId('plan-row')).toHaveCount(1)
  await expect(page.getByTestId('plan-count')).toContainText('11 av')

  // Gone on the server too.
  await page.reload()
  await page.getByTestId('plan-filter').fill(label)
  await expect(page.getByText(`Ingen plan matchar`)).toBeVisible()

  // Clean up what the test made.
  const all = await (await request.get('/api/plans')).json()
  for (const p of all.plans.filter((x: { name: string }) => x.name.startsWith(tag))) await request.delete(`/api/plans/${p.id}`)
  const trashed = (await (await request.get('/api/plans/trash')).json()).plans
  for (const p of trashed.filter((x: { name: string }) => x.name.startsWith(tag))) await request.delete(`/api/plans/${p.id}?permanent=1`)
})

test('plan list: tags are set per plan, shown as filters, searchable and kept when the plan is saved', async ({ page, request }) => {
  const tag = `Tagtest${Date.now()}`
  const proj = `Projekt ${tag}`
  const prop = `förslag ${tag}`
  const a = (await (await request.post('/api/plans', { data: { name: `${tag} A` } })).json()).plan.id as string
  const b = (await (await request.post('/api/plans', { data: { name: `${tag} B` } })).json()).plan.id as string

  // The API cleans them: trimmed, no duplicates in any case, no empty ones.
  const set = await request.patch(`/api/plans/${a}`, { data: { tags: [`  ${proj} `, proj.toLowerCase(), '', prop] } })
  expect((await set.json()).tags).toEqual([proj, prop])
  expect((await request.patch(`/api/plans/${a}`, { data: { tags: 'nej' } })).status()).toBe(400)
  expect((await request.patch(`/api/plans/nej-finns-inte`, { data: { tags: ['x'] } })).status()).toBe(404)

  // A saved revision keeps them.
  const cur = await (await request.get(`/api/plans/${a}`)).json()
  await request.put(`/api/plans/${a}`, { data: { plan: cur.plan, baseRevision: cur.revision.n } })
  const listed = (await (await request.get('/api/plans')).json()).plans.find((p: { id: string }) => p.id === a)
  expect(listed.tags).toEqual([proj, prop])

  // In the list: add a tag to B in the page, filter on it, search on it.
  await page.goto('/plans')
  await page.getByTestId('plan-filter').fill(tag)
  const rowB = page.getByTestId('plan-row').filter({ hasText: `${tag} B` })
  await rowB.getByTestId('edit-tags').click()
  await rowB.getByTestId('tag-input').fill(proj)
  await rowB.getByTestId('tag-save').click()
  await expect(rowB.getByTestId('row-tag')).toHaveText(proj)

  await page.getByTestId('plan-filter').fill('')
  await page.getByTestId('tag-chip').filter({ hasText: prop }).click()
  await expect(page.getByTestId('plan-row')).toHaveCount(1)
  await expect(page.getByTestId('plan-row')).toContainText(`${tag} A`)
  await page.getByTestId('tag-chip').filter({ hasText: prop }).click()
  await page.getByTestId('plan-filter').fill(proj.toLowerCase())
  await expect(page.getByTestId('plan-row').filter({ hasText: tag })).toHaveCount(2)

  for (const id of [a, b]) {
    await request.delete(`/api/plans/${id}`)
    await request.delete(`/api/plans/${id}?permanent=1`)
  }
})
