import { test, expect } from '@playwright/test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { unzipSync } from 'fflate'
import { hashKey } from '@/lib/plan/auth/access'
import { forgetAccess, SITES } from '@/lib/plan/storage/docs'
import { forgetPeople } from '@/lib/plan/auth/people'
import { addShare } from '@/lib/plan/storage/shares'
import { importSite, editItems } from '@/lib/site/service'
import { getSite, listSites, listSitesAndTrash, purgeSite, restoreSite, deleteSite } from '@/lib/site/store'
import { runAs } from '@/lib/plan/auth/user'
import { GET as backupGET } from '../app/api/plans/backup/route'
import { POST as sharePOST } from '../app/api/sites/[slug]/share/route'
import { DELETE as siteDELETE } from '../app/api/sites/[slug]/route'
import { POST as restorePOST } from '../app/api/sites/[slug]/restore/route'

// Site plans (tomter) share, trash and restore through the same code as plans (lib/plan/storage/docs.ts). This checks
// the parts that are particular to sites: and that the backup carries them.

test.describe.configure({ mode: 'serial' })

const FIXTURE = JSON.parse(readFileSync('e2e/fixtures/site/lovinge-doc.json', 'utf8'))
const ANNA = { id: 'anna' }
const BO = { id: 'bo' }
let dir = ''
const ENV = ['PLAN_USERS', 'VERCEL', 'PLAN_DATA_DIR', 'PLAN_STORE']
const saved: Record<string, string | undefined> = {}

test.beforeEach(() => {
  for (const k of ENV) saved[k] = process.env[k]
  dir = mkdtempSync(path.join(tmpdir(), 'site-sharing-'))
  process.env.PLAN_DATA_DIR = dir
  process.env.PLAN_STORE = 'fs'
  delete process.env.VERCEL
  process.env.PLAN_USERS = `anna:${hashKey('ka')}, bo:${hashKey('kb')}`
  forgetPeople()
  forgetAccess()
})
test.afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  rmSync(dir, { recursive: true, force: true })
})

const as = (key: string, url: string, init: RequestInit = {}) => new Request(url, { ...init, headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', ...(init.headers ?? {}) } })
const ctx = (slug: string) => ({ params: Promise.resolve({ slug }) })

async function annaMakes() {
  const res = await runAs(ANNA, () => importSite({ ...FIXTURE, designation: 'Delad tomt 1:1' }, 'user'))
  if ('errors' in res) throw new Error(res.errors.join())
  return res.stored.doc.slug
}
const slugs = async (u: { id: string }) => (await runAs(u, () => listSites())).map((s) => s.slug)

test('a shared site is listed for both, both save revisions of it, and the check against stale saves holds', async () => {
  const slug = await annaMakes()
  expect(await slugs(BO)).toEqual([])
  expect((await sharePOST(as('ka', `http://x/api/sites/${slug}/share`, { method: 'POST', body: JSON.stringify({ user: 'bo' }) }), ctx(slug))).status).toBe(201)
  expect(await slugs(BO)).toEqual([slug])
  const listed = (await runAs(BO, () => listSites()))[0]
  expect(listed.owner).toBe('anna')
  expect((await runAs(ANNA, () => listSites()))[0].sharedWith).toEqual(['bo'])

  const got = (await runAs(BO, () => getSite(slug)))!
  expect(got.doc.designation).toBe('Delad tomt 1:1')
  const items = got.doc.items
  const byBo = await runAs(BO, () => editItems(slug, items, 1, 'user', 'Bo ritar'))
  expect('stored' in byBo && byBo.stored.meta.n).toBe(2)
  // anna saves against the old revision: refused; against the new one: fine
  const stale = await runAs(ANNA, () => editItems(slug, items, 1, 'user', 'Anna ritar'))
  expect('errors' in stale && stale.status).toBe(409)
  const ok = await runAs(ANNA, () => editItems(slug, items, 2, 'user', 'Anna ritar'))
  expect('stored' in ok && ok.stored.meta.n).toBe(3)
  // the files exist once, in anna's folder
  expect((await runAs(BO, () => getSite(slug, 3)))!.meta.message).toBe('Anna ritar')
})

test('delete: a member only leaves, the owner trashes; restore brings it back; purge waits for the others', async () => {
  const slug = await annaMakes()
  expect(await runAs(ANNA, () => addShare(SITES, slug, 'bo'))).toBeNull()
  // bo leaves: gone for bo, anna still has it, shared with nobody now
  const left = await siteDELETE(as('kb', `http://x/api/sites/${slug}`, { method: 'DELETE' }), ctx(slug))
  expect((await left.json()).how).toBe('left')
  expect(await slugs(BO)).toEqual([])
  expect(await slugs(ANNA)).toEqual([slug])
  expect(await runAs(BO, () => getSite(slug))).toBeNull()

  // anna deletes: trash, hidden, 30 days, restorable
  expect((await (await siteDELETE(as('ka', `http://x/api/sites/${slug}`, { method: 'DELETE' }), ctx(slug))).json()).how).toBe('trashed')
  expect(await slugs(ANNA)).toEqual([])
  const t = await runAs(ANNA, () => listSitesAndTrash())
  expect(t.trash).toMatchObject([{ id: slug, name: 'Delad tomt 1:1', daysLeft: 30 }])
  expect((await restorePOST(as('ka', `http://x/api/sites/${slug}/restore`, { method: 'POST' }), ctx(slug))).status).toBe(200)
  expect(await slugs(ANNA)).toEqual([slug])

  // trash it again and share it while it is in the trash: it cannot be purged while someone has it
  await runAs(ANNA, () => deleteSite(slug))
  expect(await runAs(ANNA, () => purgeSite(slug))).toBe('ok')
  expect(await runAs(ANNA, () => restoreSite(slug))).toBe(false)
  expect((await runAs(ANNA, () => listSitesAndTrash())).trash).toEqual([])
})

test('the backup carries sites, shared ones too', async () => {
  const slug = await annaMakes()
  await runAs(ANNA, () => addShare(SITES, slug, 'bo'))
  const res = await backupGET(as('kb', 'http://x/api/plans/backup'))
  expect(res.status).toBe(200)
  const files = Object.keys(unzipSync(new Uint8Array(await res.arrayBuffer())))
  expect(files.some((f) => f.includes(`delade-med-mig/anna/tomter/${slug}/head.json`))).toBe(true)
  const mine = await backupGET(as('ka', 'http://x/api/plans/backup'))
  const own = Object.keys(unzipSync(new Uint8Array(await mine.arrayBuffer())))
  expect(own.some((f) => f.includes(`tomter/${slug}/head.json`))).toBe(true)
})

test('Claude: site_share, site_list and doc_trash work for sites the same way as for plans', async () => {
  const { handlePlanTool } = await import('@/lib/plan/mcp/mcp-tools')
  const text = (r: Awaited<ReturnType<typeof handlePlanTool>>) => r!.content.filter((c) => c.type === 'text').map((c) => (c as { text: string }).text).join('\n')
  const slug = await annaMakes()
  expect(text(await runAs(ANNA, () => handlePlanTool('site_share', { slug, with: 'bo' })))).toContain('anna (ägare), bo')
  expect(text(await runAs(ANNA, () => handlePlanTool('site_list', {})))).toContain('delad med bo')
  expect(text(await runAs(BO, () => handlePlanTool('site_list', {})))).toContain('delad av anna')
  expect((await runAs(ANNA, () => handlePlanTool('site_share', { slug, with: 'ingen' })))!.isError).toBe(true)
  // the trash: bo leaves, anna trashes, both can list and restore
  expect(text(await runAs(BO, () => handlePlanTool('doc_trash', { kind: 'site', action: 'delete', id: slug })))).toContain('Du har tagit bort tomten')
  expect(text(await runAs(ANNA, () => handlePlanTool('doc_trash', { kind: 'site', action: 'delete', id: slug })))).toContain('papperskorgen')
  expect(text(await runAs(ANNA, () => handlePlanTool('doc_trash', { kind: 'site', action: 'list' })))).toContain(slug)
  expect(text(await runAs(ANNA, () => handlePlanTool('site_list', {})))).not.toContain(slug)
  expect(text(await runAs(ANNA, () => handlePlanTool('doc_trash', { kind: 'site', action: 'restore', id: slug })))).toContain('tillbaka')
  expect(text(await runAs(ANNA, () => handlePlanTool('site_list', {})))).toContain(slug)
  expect((await runAs(ANNA, () => handlePlanTool('doc_trash', { kind: 'site', action: 'restore', id: slug })))!.isError).toBe(true)
  expect((await runAs(ANNA, () => handlePlanTool('doc_trash', { kind: 'bil', action: 'list' })))!.isError).toBe(true)
})
