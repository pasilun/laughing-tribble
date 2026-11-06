import { test, expect } from '@playwright/test'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { forgetPeople } from '@/lib/plan/people'
import { hashKey } from '@/lib/plan/access'
import { handlePlanTool } from '@/lib/plan/mcp-tools'
import { createPlan, editPlan } from '@/lib/plan/service'
import { forgetAccess, getAsset, getRevision, listPlans, putAsset, saveRevision, ConflictError } from '@/lib/plan/store'
import { runAs } from '@/lib/plan/user'
import { DELETE as planDELETE, GET as planGET, PUT as planPUT } from '../app/api/plans/[id]/route'
import { GET as listGET } from '../app/api/plans/route'
import { GET as revisionsGET } from '../app/api/plans/[id]/revisions/route'
import { DELETE as shareDELETE, GET as shareGET, POST as sharePOST } from '../app/api/plans/[id]/share/route'

// Sharing a plan: both make revisions of the same plan, and "delete" only removes it for the one who deletes.

test.describe.configure({ mode: 'serial' })

const ANNA = { id: 'anna' }
const BO = { id: 'bo' }
let dir = ''
const ENV = ['PLAN_USERS', 'VERCEL', 'PLAN_DATA_DIR', 'PLAN_STORE']
const saved: Record<string, string | undefined> = {}

test.beforeEach(() => {
  for (const k of ENV) saved[k] = process.env[k]
  dir = mkdtempSync(path.join(tmpdir(), 'plan-sharing-'))
  process.env.PLAN_DATA_DIR = dir
  process.env.PLAN_STORE = 'fs'
  delete process.env.VERCEL
  process.env.PLAN_USERS = `anna:${hashKey('ka')}, bo:${hashKey('kb')}, cy:${hashKey('kc')}`
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
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })
const text = (r: Awaited<ReturnType<typeof handlePlanTool>>) => r!.content.filter((c) => c.type === 'text').map((c) => (c as { text: string }).text).join('\n')
const own = (user: string, id: string) => path.join(dir, 'u', user, 'plans', id)

async function annaMakes() {
  const res = await runAs(ANNA, () => createPlan({ name: 'Delad lägenhet', template: 'demo', author: 'user' }))
  if ('errors' in res) throw new Error((res.errors ?? []).join())
  return res.plan.id
}
const share = (key: string, id: string, user: string) => sharePOST(as(key, `http://x/api/plans/${id}/share`, { method: 'POST', body: JSON.stringify({ user }) }), ctx(id))
const ids = async (u: { id: string }) => (await runAs(u, () => listPlans())).map((p) => p.id)

test('sharing: unknown person, yourself, a plan that is not yours and a stranger are refused', async () => {
  const id = await annaMakes()
  expect((await share('ka', id, 'finnsinte')).status).toBe(400)
  expect((await share('ka', id, 'anna')).status).toBe(400)
  expect((await share('ka', id, '')).status).toBe(400)
  // bo has no part in it: 404, and cannot share it either
  expect((await share('kb', id, 'cy')).status).toBe(404)
  expect((await shareGET(as('kb', `http://x/api/plans/${id}/share`), ctx(id))).status).toBe(404)
  expect(await ids(BO)).toEqual([])
})

test('a shared plan is listed for both, and both make revisions of the same plan', async () => {
  const id = await annaMakes()
  const r = await share('ka', id, 'Bo')
  expect(r.status).toBe(201)
  expect(await r.json()).toMatchObject({ owner: 'anna', members: ['bo'], me: 'anna', role: 'owner' })
  // sharing twice is harmless
  expect((await share('ka', id, 'bo')).status).toBe(201)

  const forAnna = (await (await listGET(as('ka', 'http://x/api/plans'))).json()).plans
  const forBo = (await (await listGET(as('kb', 'http://x/api/plans'))).json()).plans
  expect(forAnna).toHaveLength(1)
  expect(forAnna[0]).toMatchObject({ id, sharedWith: ['bo'] })
  expect(forAnna[0].owner).toBeUndefined()
  expect(forBo).toHaveLength(1)
  expect(forBo[0]).toMatchObject({ id, owner: 'anna', name: 'Delad lägenhet' })

  // bo opens it, changes it, and anna sees the new version
  expect((await planGET(as('kb', `http://x/api/plans/${id}`), ctx(id))).status).toBe(200)
  const edited = await runAs(BO, () => editPlan(id, [], 1, 'user', 'Bos ändring'))
  expect(edited.status).toBe(200)
  expect((await runAs(ANNA, () => getRevision(id)))!.meta).toMatchObject({ n: 2, by: 'bo', message: 'Bos ändring' })
  // everything is stored once, under the owner
  expect(existsSync(own('anna', id))).toBe(true)
  expect(existsSync(own('bo', id))).toBe(false)

  // anna still on revision 1 meets the other person's version as a conflict, not an overwrite
  const mine = (await runAs(ANNA, () => getRevision(id, 1)))!.plan
  const put = await planPUT(as('ka', `http://x/api/plans/${id}`, { method: 'PUT', body: JSON.stringify({ plan: { ...mine, name: 'Annas namn' }, baseRevision: 1 }) }), ctx(id))
  expect(put.status).toBe(409)
  const ok = await planPUT(as('ka', `http://x/api/plans/${id}`, { method: 'PUT', body: JSON.stringify({ plan: { ...mine, name: 'Annas namn' }, baseRevision: 2 }) }), ctx(id))
  expect(ok.status).toBe(200)
  const revs = (await (await revisionsGET(as('kb', `http://x/api/plans/${id}/revisions`), ctx(id))).json()).revisions
  expect(revs.map((x: { n: number; by?: string }) => [x.n, x.by])).toEqual([[1, 'anna'], [2, 'bo'], [3, 'anna']])
  expect((await runAs(BO, () => getRevision(id)))!.plan.name).toBe('Annas namn')

  // drawings added by one are there for the other
  await runAs(BO, () => putAsset(id, 'ritning.png', Buffer.from('bild'), 'image/png'))
  expect((await runAs(ANNA, () => getAsset(id, 'ritning.png')))!.toString()).toBe('bild')
  // and a third person sees nothing
  expect(await ids({ id: 'cy' })).toEqual([])
  expect(await runAs({ id: 'cy' }, () => getRevision(id))).toBeNull()
})

test('deleting a shared plan only removes it for the one who deletes', async () => {
  const id = await annaMakes()
  await share('ka', id, 'bo')
  // the member leaves: the owner keeps it, and the data stays
  expect((await planDELETE(as('kb', `http://x/api/plans/${id}`, { method: 'DELETE' }), ctx(id))).status).toBe(200)
  expect(await ids(BO)).toEqual([])
  expect((await planGET(as('kb', `http://x/api/plans/${id}`), ctx(id))).status).toBe(404)
  expect((await planGET(as('ka', `http://x/api/plans/${id}`), ctx(id))).status).toBe(200)
  expect((await runAs(ANNA, () => listPlans()))[0].sharedWith).toBeUndefined()
  expect(existsSync(own('anna', id))).toBe(true)
  // bo can no longer write to it
  const plan = (await runAs(ANNA, () => getRevision(id)))!.plan
  // bo's save now starts a history of bo's own (the plan is not there for bo any more); anna's is untouched
  await expect(runAs(BO, () => saveRevision(plan, { author: 'user', message: 'x' }, 1))).rejects.toBeInstanceOf(ConflictError)
  expect((await runAs(ANNA, () => getRevision(id)))!.meta.n).toBe(1)
})

test('the owner deleting a shared plan hides it for them; the data goes when the last person is gone', async () => {
  const id = await annaMakes()
  await share('ka', id, 'bo')
  expect((await planDELETE(as('ka', `http://x/api/plans/${id}`, { method: 'DELETE' }), ctx(id))).status).toBe(200)
  // gone for anna ...
  expect(await ids(ANNA)).toEqual([])
  expect((await planGET(as('ka', `http://x/api/plans/${id}`), ctx(id))).status).toBe(404)
  // ... but bo has it, still sees what anna made, and can make new versions
  expect(await ids(BO)).toEqual([id])
  const forBo = (await (await listGET(as('kb', 'http://x/api/plans'))).json()).plans
  expect(forBo[0]).toMatchObject({ id, owner: 'anna' })
  expect((await runAs(BO, () => editPlan(id, [], 1, 'user', 'Bo jobbar vidare'))).status).toBe(200)
  expect(existsSync(own('anna', id))).toBe(true)
  // anna cannot share it from the outside, but bo can put anna back
  expect((await shareGET(as('ka', `http://x/api/plans/${id}/share`), ctx(id))).status).toBe(404)
  expect((await share('kb', id, 'anna')).status).toBe(201)
  expect(await ids(ANNA)).toEqual([id])
  // anna deletes again, then bo, the last one: everything is removed
  await planDELETE(as('ka', `http://x/api/plans/${id}`, { method: 'DELETE' }), ctx(id))
  expect(existsSync(own('anna', id))).toBe(true)
  expect((await planDELETE(as('kb', `http://x/api/plans/${id}`, { method: 'DELETE' }), ctx(id))).status).toBe(200)
  expect(existsSync(own('anna', id))).toBe(false)
  expect(existsSync(path.join(dir, 'u/bo/shared', `${id}.json`))).toBe(false)
  expect(await ids(BO)).toEqual([])
  expect((await planDELETE(as('kb', `http://x/api/plans/${id}`, { method: 'DELETE' }), ctx(id))).status).toBe(404)
})

test('the owner can take a person out; a member can share on and only remove themselves', async () => {
  const id = await annaMakes()
  await share('ka', id, 'bo')
  // bo shares with cy
  expect((await share('kb', id, 'cy')).status).toBe(201)
  expect(await ids({ id: 'cy' })).toEqual([id])
  // bo cannot remove cy, anna can
  const no = await shareDELETE(as('kb', `http://x/api/plans/${id}/share?user=cy`, { method: 'DELETE' }), ctx(id))
  expect(no.status).toBe(400)
  expect((await shareDELETE(as('ka', `http://x/api/plans/${id}/share?user=cy`, { method: 'DELETE' }), ctx(id))).status).toBe(200)
  expect(await ids({ id: 'cy' })).toEqual([])
  expect((await planGET(as('kc', `http://x/api/plans/${id}`), ctx(id))).status).toBe(404)
  // removing a person who is not in it
  expect((await shareDELETE(as('ka', `http://x/api/plans/${id}/share?user=cy`, { method: 'DELETE' }), ctx(id))).status).toBe(400)
  // bo removes themselves
  expect((await shareDELETE(as('kb', `http://x/api/plans/${id}/share?user=bo`, { method: 'DELETE' }), ctx(id))).status).toBe(200)
  expect(await ids(BO)).toEqual([])
  const who = await (await shareGET(as('ka', `http://x/api/plans/${id}/share`), ctx(id))).json()
  expect(who.members).toEqual([])
})

test("Claude's tools: plan_share, and plan_list tells who a plan is shared with", async () => {
  const id = await annaMakes()
  expect(text(await runAs(ANNA, () => handlePlanTool('plan_share', { plan_id: id, with: 'bo' })))).toContain('anna (ägare), bo')
  expect(text(await runAs(ANNA, () => handlePlanTool('plan_list', {})))).toContain('delad med bo')
  expect(text(await runAs(BO, () => handlePlanTool('plan_list', {})))).toContain('delad av anna')
  const bad = await runAs(ANNA, () => handlePlanTool('plan_share', { plan_id: id, with: 'ingen' }))
  expect(bad!.isError).toBe(true)
  const stranger = await runAs({ id: 'cy' }, () => handlePlanTool('plan_share', { plan_id: id }))
  expect(stranger!.isError).toBe(true)
  expect(text(await runAs(BO, () => handlePlanTool('plan_share', { plan_id: id, remove: 'bo' })))).toContain('De andra har kvar den')
  expect(await ids(BO)).toEqual([])
})

test('local development without sign-in has no sharing', async () => {
  delete process.env.PLAN_USERS
  forgetAccess()
  const legacy = { id: 'legacy', legacy: true }
  const res = await runAs(legacy, () => createPlan({ name: 'Gammal', template: 'demo', author: 'user' }))
  if ('errors' in res) throw new Error('create')
  const r = await runAs(legacy, () => handlePlanTool('plan_share', { plan_id: res.plan.id, with: 'bo' }))
  expect(r!.isError).toBe(true)
  expect(text(r)).toContain('personliga nycklar')
  expect((await runAs(legacy, () => listPlans()))).toHaveLength(1)
})

test('the plan list: a Dela form per plan; without personal keys it says why it cannot share', async ({ page, request }) => {
  const made = await request.post('/api/plans', { data: { name: 'Delningstest UI', template: 'empty' } })
  expect(made.status()).toBe(201)
  await page.goto('/plans')
  const row = page.getByTestId('plan-row').filter({ hasText: 'Delningstest UI' }).first()
  await row.getByTestId('share-plan').click()
  await row.getByTestId('share-user').fill('emil')
  await row.getByTestId('share-save').click()
  await expect(row.getByTestId('share-msg')).toContainText('personliga nycklar')
  await expect(row.getByTestId('share-form')).toContainText('försvinner den bara för den personen')
})
