import { test, expect } from '@playwright/test'
import { readFileSync } from 'fs'
import { connector } from './connector-helpers'

const FIXTURE = JSON.parse(readFileSync('e2e/fixtures/site/lovinge-doc.json', 'utf8'))
const text = (r: { content: Array<{ text?: string }> }) => r.content.map((c) => c.text ?? '').join('\n')

async function makeSite(request: Parameters<typeof connector>[0]): Promise<string> {
  const designation = `Testtomt ${Date.now()}-${Math.floor(Math.random() * 1e6)} 1:1`
  const res = await request.post('/api/sites', { data: { import: { ...FIXTURE, designation, slug: undefined } } })
  expect(res.status()).toBe(201)
  return `site:${(await res.json()).doc.slug}`
}

test('a site plan is listed, read, viewed and edited by its id', async ({ request }) => {
  const id = await makeSite(request)
  const listed = await connector(request, 'list', { what: 'sites' })
  expect((listed.structuredContent!.data!.items as Array<{ id: string }>).map((i) => i.id)).toContain(id)
  const plans = await connector(request, 'list', {})
  expect((plans.structuredContent!.data!.items as Array<{ id: string }>).map((i) => i.id)).not.toContain(id)

  const got = await connector(request, 'get', { id })
  expect(got.structuredContent!.revision).toBe(1)
  expect(text(got)).toContain('Tomt ')
  const v = await connector(request, 'view', { id })
  expect(v.content.at(-1)!.type).toBe('image')

  const op = { op: 'add', item: { type: 'area', name: 'Växthus', kind: 'byggnad', status: 'idé', rect: { x: 30, y: 112, w: 6, d: 4 } } }
  const dry = await connector(request, 'edit', { id, base_revision: 1, ops: [op], dry_run: true })
  expect(dry.structuredContent!.revision).toBe(1)
  const saved = await connector(request, 'edit', { id, base_revision: 1, ops: [op] })
  expect(saved.isError, text(saved)).toBeFalsy()
  expect(saved.structuredContent!.revision).toBe(2)
  expect(text(await connector(request, 'get', { id }))).toContain('Växthus')

  const stale = await connector(request, 'edit', { id, base_revision: 1, ops: [op] })
  expect(stale.structuredContent!.findings![0].code).toBe('stale-revision')
  const unknown = await connector(request, 'edit', { id, base_revision: 2, ops: [{ op: 'lägg_till' }] })
  expect(unknown.structuredContent!.findings![0].code).toBe('unknown-name')
  const bad = await connector(request, 'edit', { id, base_revision: 2, ops: [{ op: 'delete', id: 'finns-inte' }] })
  expect(bad.structuredContent!.findings![0].code).toBe('invalid-operation')
})

test('the tools for floor plans say wrong-kind to a site; a site can be deleted and restored', async ({ request }) => {
  const id = await makeSite(request)
  for (const [tool, args] of [['check', { id }], ['scan', { id, action: 'profile' }], ['source', { id, action: 'upload_link' }], ['export', { id, format: 'pdf' }]] as const) {
    const r = await connector(request, tool, args)
    expect(r.structuredContent!.findings![0].code, tool).toBe('wrong-kind')
  }
  const rename = await connector(request, 'manage', { action: 'rename', id, args: { name: 'x' } })
  expect(rename.structuredContent!.findings![0].code).toBe('wrong-kind')
  const del = await connector(request, 'manage', { action: 'delete', id })
  expect(del.isError, text(del)).toBeFalsy()
  expect((await connector(request, 'get', { id })).structuredContent!.ok).toBe(false)
  const restored = await connector(request, 'manage', { action: 'restore', id })
  expect(restored.isError, text(restored)).toBeFalsy()
  expect((await connector(request, 'get', { id })).structuredContent!.ok).toBe(true)
  const topic = text(await connector(request, 'guide', { topic: 'sites' }))
  expect(topic).toContain('set_building')
})
