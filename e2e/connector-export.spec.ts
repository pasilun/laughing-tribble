import { test, expect } from '@playwright/test'
import { connector, makePlan } from './connector-helpers'

test('export', async ({ request }) => {
  const { id } = await makePlan(request, 'Export test')
  const l = (await connector(request, 'export', { id, format: 'link' })).structuredContent!
  const links = (l.data as { links: Record<string, string> }).links
  expect(l.ok).toBe(true); expect(l.revision).toBe(1)
  expect(links.editor).toContain(`/plans/${id}`); expect(links.pdf).toContain('format=pdf'); expect(links.dxf).toContain('format=dxf')
  const png = (await connector(request, 'export', { id, format: 'png', options: { sheet: 'fore' } })).structuredContent!
  expect((png.data as { links: Record<string, string> }).links.png).toContain('view=fore&format=png')
  const pdf = (await connector(request, 'export', { id, format: 'pdf', options: { sheet: 'both' } })).structuredContent!
  expect((pdf.data as { links: Record<string, string> }).links.pdf).toContain('view=both&format=pdf')
  expect((await connector(request, 'export', { id, format: 'pdff' })).structuredContent!.findings![0].data!.nearest).toBe('pdf')
  expect((await connector(request, 'export', { id, format: 'pdf', options: { sheet: 'bth' } })).structuredContent!.findings![0].data!.nearest).toBe('both')
  expect((await connector(request, 'export', { id: 'no-such-plan', format: 'pdf' })).structuredContent!.findings![0].code).toBe('not-found')
  expect((await connector(request, 'export', { id })).structuredContent!.findings![0].code).toBe('bad-argument')
})
