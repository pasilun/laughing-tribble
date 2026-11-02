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

  // Delete asks first: Avbryt leaves the plan, the second click removes it for good.
  const first = page.getByTestId('plan-row').first()
  const label = (await first.locator('a span').first().textContent())!
  await first.getByTestId('delete-plan').click()
  await first.getByRole('button', { name: 'Avbryt' }).click()
  await expect(page.getByTestId('plan-row')).toHaveCount(2)
  await first.getByTestId('delete-plan').click()
  await first.getByTestId('delete-yes').click()
  await expect(page.getByTestId('plan-row')).toHaveCount(1)
  await expect(page.getByTestId('plan-count')).toContainText('11 av')

  // Gone on the server too.
  await page.reload()
  await page.getByTestId('plan-filter').fill(label)
  await expect(page.getByText(`Ingen plan matchar`)).toBeVisible()

  // Clean up what the test made.
  const all = await (await request.get('/api/plans')).json()
  for (const p of all.plans.filter((x: { name: string }) => x.name.startsWith(tag))) await request.delete(`/api/plans/${p.id}`)
})
