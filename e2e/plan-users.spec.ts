import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { hashKey } from '@/lib/plan/access'
import { handlePlanTool } from '@/lib/plan/mcp-tools'
import { createPlan } from '@/lib/plan/service'
import { getAsset, getRevision, listPlans, putAsset, saveRevision, ConflictError } from '@/lib/plan/store'
import { runAs } from '@/lib/plan/user'
import { GET as listGET, POST as createPOST } from '../app/api/plans/route'
import { DELETE as planDELETE, GET as planGET, PUT as planPUT } from '../app/api/plans/[id]/route'
import { GET as sheetGET } from '../app/api/plans/[id]/sheet/route'
import { GET as assetGET } from '../app/api/plans/[id]/assets/[name]/route'
import { GET as revisionsGET } from '../app/api/plans/[id]/revisions/route'
import { POST as opsPOST } from '../app/api/plans/[id]/ops/route'
import { POST as sourcesPOST } from '../app/api/plans/[id]/sources/route'
import { POST as loginPOST } from '../app/api/plans/login/route'
import { resetLimits } from '../app/api/plans/login/limit'

// Two people, one store: what one makes is invisible and untouchable for the other.

test.describe.configure({ mode: 'serial' })

const ANNA = { id: 'anna' }
const BO = { id: 'bo' }
let dir = ''
const ENV = ['PLAN_USERS', 'PLAN_PASSWORD', 'VERCEL', 'PLAN_DATA_DIR', 'PLAN_STORE']
const saved: Record<string, string | undefined> = {}

test.beforeEach(() => {
  for (const k of ENV) saved[k] = process.env[k]
  dir = mkdtempSync(path.join(tmpdir(), 'plan-users-'))
  process.env.PLAN_DATA_DIR = dir
  process.env.PLAN_STORE = 'fs'
  delete process.env.PLAN_PASSWORD
  delete process.env.VERCEL
  process.env.PLAN_USERS = `anna:${hashKey('ka')}, bo:${hashKey('kb')}`
})
test.afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  rmSync(dir, { recursive: true, force: true })
})

const as = (key: string, url = 'http://x/api/plans', init: RequestInit = {}) => new Request(url, { ...init, headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', ...(init.headers ?? {}) } })
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })
const assetCtx = (id: string, name: string) => ({ params: Promise.resolve({ id, name }) })

async function annaMakes(name = 'Annas lägenhet') {
  const res = await runAs(ANNA, () => createPlan({ name, template: 'demo', author: 'user' }))
  if ('errors' in res) throw new Error((res.errors ?? []).join())
  return res.plan.id
}

test('plans are stored under the person and never listed for anyone else', async () => {
  const id = await annaMakes()
  expect(existsSync(path.join(dir, 'u/anna/plans', id, 'head.json'))).toBe(true)
  expect(existsSync(path.join(dir, 'plans'))).toBe(false)
  expect((await runAs(ANNA, () => listPlans())).map((p) => p.id)).toEqual([id])
  expect(await runAs(BO, () => listPlans())).toEqual([])
  expect(await runAs(BO, () => getRevision(id))).toBeNull()
})

test("one person cannot read, change, overwrite or fetch assets of another's plan", async () => {
  const id = await annaMakes()
  await runAs(ANNA, () => putAsset(id, 'ritning.png', Buffer.from('hemlig'), 'image/png'))
  expect(await runAs(BO, () => getAsset(id, 'ritning.png'))).toBeNull()
  // bo "creating" the same id starts an empty history in bo's own space; anna's is untouched
  const plan = (await runAs(ANNA, () => getRevision(id)))!.plan
  await expect(runAs(BO, () => saveRevision(plan, { author: 'user', message: 'x' }, 1))).rejects.toBeInstanceOf(ConflictError)
  await runAs(BO, () => saveRevision({ ...plan, name: 'Bos kopia' }, { author: 'user', message: 'x' }, null))
  expect((await runAs(ANNA, () => getRevision(id)))!.plan.name).toBe('Annas lägenhet')
  expect((await runAs(ANNA, () => getRevision(id)))!.meta.n).toBe(1)
})

test('storage without a person is refused when sign-in is on', async () => {
  await expect(listPlans()).rejects.toThrow('ingen användare')
  await expect(getRevision('abc')).rejects.toThrow('ingen användare')
})

test('over HTTP: wrong key 401, other persons plan 404 on every route, delete only own', async () => {
  const created = await createPOST(as('ka', 'http://x/api/plans', { method: 'POST', body: JSON.stringify({ name: 'Hemma', template: 'demo' }) }))
  expect(created.status).toBe(201)
  const id = (await created.json()).plan.id as string

  expect((await listGET(as('fel'))).status).toBe(401)
  expect((await listGET(new Request('http://x/api/plans'))).status).toBe(401)
  expect((await (await listGET(as('ka'))).json()).plans).toHaveLength(1)
  expect((await (await listGET(as('kb'))).json()).plans).toEqual([])

  for (const [i, r] of [
    await planGET(as('kb', `http://x/api/plans/${id}`), ctx(id)),
    await sheetGET(as('kb', `http://x/api/plans/${id}/sheet?view=fore&format=pdf`), ctx(id)),
    await revisionsGET(as('kb', `http://x/api/plans/${id}/revisions`), ctx(id)),
    await assetGET(as('kb', `http://x/api/plans/${id}/assets/ritning.png`), assetCtx(id, 'ritning.png')),
    await opsPOST(as('kb', `http://x/api/plans/${id}/ops`, { method: 'POST', body: JSON.stringify({ ops: [], baseRevision: 1 }) }), ctx(id)),
    await sourcesPOST(as('kb', `http://x/api/plans/${id}/sources?id=a&filename=a.png`, { method: 'POST', body: new Uint8Array([137, 80, 78, 71]) }), ctx(id)),
    await planDELETE(as('kb', `http://x/api/plans/${id}`, { method: 'DELETE' }), ctx(id)),
  ].entries())
    expect([i, r.status]).toEqual([i, 404])
  // bo saving over the id with a made-up base revision gets a conflict, not anna's plan
  const mine = (await (await planGET(as('ka', `http://x/api/plans/${id}`), ctx(id))).json()).plan
  const put = await planPUT(as('kb', `http://x/api/plans/${id}`, { method: 'PUT', body: JSON.stringify({ plan: mine, baseRevision: 1 }) }), ctx(id))
  expect(put.status).toBe(409)

  const pdf = await sheetGET(as('ka', `http://x/api/plans/${id}/sheet?view=fore&format=pdf`), ctx(id))
  expect(pdf.status).toBe(200)
  expect(Buffer.from(await pdf.arrayBuffer()).subarray(0, 4).toString()).toBe('%PDF')

  expect((await planDELETE(as('ka', `http://x/api/plans/${id}`, { method: 'DELETE' }), ctx(id))).status).toBe(200)
  expect((await planGET(as('ka', `http://x/api/plans/${id}`), ctx(id))).status).toBe(404)
  expect(existsSync(path.join(dir, 'u/anna/plans', id))).toBe(false)
})

test("Claude's tools see only the connected person's plans", async () => {
  const id = await annaMakes()
  const text = (r: Awaited<ReturnType<typeof handlePlanTool>>) => r!.content.filter((c) => c.type === 'text').map((c) => (c as { text: string }).text).join('\n')
  expect(text(await runAs(ANNA, () => handlePlanTool('plan_list', {})))).toContain(id)
  expect(text(await runAs(BO, () => handlePlanTool('plan_list', {})))).not.toContain(id)
  const r = await runAs(BO, () => handlePlanTool('plan_get', { plan_id: id }))
  expect(r!.isError).toBe(true)
  expect(text(r)).toContain('finns inte')
  const chk = await runAs(BO, () => handlePlanTool('plan_review', { plan_id: id }))
  expect(chk!.isError).toBe(true)
})

test('migration moves the old shared plans to one person and verifies the copy', async () => {
  // as before: single-password layout under plans/
  delete process.env.PLAN_USERS
  process.env.PLAN_PASSWORD = 'gammalt'
  const res = await runAs({ id: 'legacy', legacy: true }, () => createPlan({ name: 'Gammal plan', template: 'demo', author: 'user' }))
  if ('errors' in res) throw new Error('create')
  const id = res.plan.id
  await runAs({ id: 'legacy', legacy: true }, () => putAsset(id, 'a.png', Buffer.from([1, 2, 3]), 'image/png'))
  expect(existsSync(path.join(dir, 'plans', id, 'head.json'))).toBe(true)
  const env = { ...process.env, PLAN_DATA_DIR: dir, PLAN_STORE: 'fs' }
  const dry = execFileSync('npx', ['tsx', 'scripts/migrate-to-users.ts', '--to', 'anna', '--dry-run'], { encoding: 'utf8', env })
  expect(dry).toContain('skulle kopiera')
  expect(existsSync(path.join(dir, 'u'))).toBe(false)
  const out = execFileSync('npx', ['tsx', 'scripts/migrate-to-users.ts', '--to', 'anna', '--delete-legacy'], { encoding: 'utf8', env })
  expect(out).toContain('tog bort')
  expect(existsSync(path.join(dir, 'plans', id, 'head.json'))).toBe(false)
  // now with real users: anna has it, bo doesn't
  delete process.env.PLAN_PASSWORD
  process.env.PLAN_USERS = `anna:${hashKey('ka')}, bo:${hashKey('kb')}`
  expect((await runAs(ANNA, () => getRevision(id)))!.plan.name).toBe('Gammal plan')
  expect((await runAs(ANNA, () => getAsset(id, 'a.png')))!.equals(Buffer.from([1, 2, 3]))).toBe(true)
  expect(await runAs(BO, () => getRevision(id))).toBeNull()
})

test('the login form: the right key gives a cookie for that person only; guessing is slowed', async () => {
  resetLimits()
  const login = (key: string, ip = '9.9.9.9') => {
    const body = new FormData()
    body.set('password', key)
    body.set('next', '/plans/abc')
    return loginPOST(new Request('http://x/api/plans/login', { method: 'POST', body, headers: { 'x-forwarded-for': ip } }))
  }
  const ok = await login('kb')
  expect(ok.status).toBe(303)
  expect(ok.headers.get('location')).toBe('http://x/plans/abc')
  const cookie = /plan_access=([^;]+)/.exec(ok.headers.get('set-cookie')!)![1]
  expect(ok.headers.get('set-cookie')).toContain('HttpOnly')
  expect(cookie).not.toContain('kb')
  // the cookie opens bo's plans and nobody else's
  const mine = await createPOST(new Request('http://x/api/plans', { method: 'POST', headers: { cookie: `plan_access=${cookie}`, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Bos' }) }))
  expect(mine.status).toBe(201)
  expect((await (await listGET(new Request('http://x/api/plans', { headers: { cookie: `plan_access=${cookie}` } }))).json()).plans).toHaveLength(1)
  expect((await (await listGET(as('ka'))).json()).plans).toEqual([])
  // wrong keys: back to the form; the sixth try from the same address is refused even with the right key
  for (let i = 0; i < 5; i++) expect((await login('fel', '1.1.1.1')).headers.get('location')).toContain('fel=1')
  expect((await login('ka', '1.1.1.1')).headers.get('location')).toContain('fel=for-manga')
  expect((await login('ka', '2.2.2.2')).status).toBe(303)
  resetLimits()
})
