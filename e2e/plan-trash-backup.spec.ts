import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { unzipSync } from 'fflate'
import { forgetPeople } from '@/lib/plan/people'
import { hashKey } from '@/lib/plan/access'
import { createPlan } from '@/lib/plan/service'
import { listPlans, listTrash, putAsset } from '@/lib/plan/store'
import { systemBackend } from '@/lib/plan/storage'
import { forgetAccess } from '@/lib/plan/docs'
import { runAs } from '@/lib/plan/user'
import { DELETE as planDELETE, GET as planGET } from '../app/api/plans/[id]/route'
import { POST as restorePOST } from '../app/api/plans/[id]/restore/route'
import { POST as sharePOST } from '../app/api/plans/[id]/share/route'
import { GET as trashGET } from '../app/api/plans/trash/route'
import { GET as backupGET } from '../app/api/plans/backup/route'

// The trash (a deleted plan waits 30 days) and the backup (a zip of everything a person has).

test.describe.configure({ mode: 'serial' })

const ANNA = { id: 'anna' }
const BO = { id: 'bo' }
let dir = ''
const ENV = ['PLAN_USERS', 'PLAN_ADMINS', 'VERCEL', 'PLAN_DATA_DIR', 'PLAN_STORE']
const saved: Record<string, string | undefined> = {}

test.beforeEach(() => {
  for (const k of ENV) saved[k] = process.env[k]
  dir = mkdtempSync(path.join(tmpdir(), 'plan-trash-'))
  process.env.PLAN_DATA_DIR = dir
  process.env.PLAN_STORE = 'fs'
  delete process.env.VERCEL
  process.env.PLAN_USERS = `anna:${hashKey('ka')}, bo:${hashKey('kb')}`
  process.env.PLAN_ADMINS = 'anna'
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
const del = (key: string, id: string, q = '') => planDELETE(as(key, `http://x/api/plans/${id}${q}`, { method: 'DELETE' }), ctx(id))

async function make(user: { id: string }, name: string) {
  const res = await runAs(user, () => createPlan({ name, template: 'demo', author: 'user' }))
  if ('errors' in res) throw new Error((res.errors ?? []).join())
  return res.plan.id
}
const ids = async (u: { id: string }) => (await runAs(u, () => listPlans())).map((p) => p.id)

test('a deleted plan goes to the trash: hidden, restorable, removed for good only from there', async () => {
  const id = await make(ANNA, 'Min plan')
  expect(await (await del('ka', id)).json()).toEqual({ deleted: id, how: 'trashed' })
  expect(await ids(ANNA)).toEqual([])
  expect((await planGET(as('ka', `http://x/api/plans/${id}`), ctx(id))).status).toBe(404)
  expect((await del('ka', id)).status).toBe(404)
  const trash = await (await trashGET(as('ka', 'http://x/api/plans/trash'))).json()
  expect(trash.days).toBe(30)
  expect(trash.plans).toMatchObject([{ id, name: 'Min plan', daysLeft: 30 }])
  // nobody else sees it
  expect((await (await trashGET(as('kb', 'http://x/api/plans/trash'))).json()).plans).toEqual([])
  expect((await restorePOST(as('kb', `http://x/api/plans/${id}/restore`, { method: 'POST' }), ctx(id))).status).toBe(404)

  // restored, and it works as before
  expect((await restorePOST(as('ka', `http://x/api/plans/${id}/restore`, { method: 'POST' }), ctx(id))).status).toBe(200)
  expect(await ids(ANNA)).toEqual([id])
  expect((await planGET(as('ka', `http://x/api/plans/${id}`), ctx(id))).status).toBe(200)
  expect(existsSync(path.join(dir, 'u/anna/plans', id, 'shares.json'))).toBe(false)
  expect((await restorePOST(as('ka', `http://x/api/plans/${id}/restore`, { method: 'POST' }), ctx(id))).status).toBe(404)

  // for good: only from the trash
  expect((await del('ka', id, '?permanent=1')).status).toBe(400)
  await del('ka', id)
  expect((await del('ka', id, '?permanent=1')).status).toBe(200)
  expect(existsSync(path.join(dir, 'u/anna/plans', id))).toBe(false)
  expect((await del('ka', id, '?permanent=1')).status).toBe(404)
  expect(await runAs(ANNA, () => listTrash())).toEqual([])
})

test('after 30 days the trash removes a plan (not while someone else has it)', async () => {
  const id = await make(ANNA, 'Gammal')
  const shared = await make(ANNA, 'Delad')
  await sharePOST(as('ka', `http://x/api/plans/${shared}/share`, { method: 'POST', body: JSON.stringify({ user: 'bo' }) }), ctx(shared))
  await del('ka', id)
  await del('ka', shared)
  const old = new Date(Date.now() - 31 * 86_400_000).toISOString()
  for (const p of [id, shared]) {
    const b = systemBackend()
    const key = `u/anna/plans/${p}/shares.json`
    const sh = JSON.parse((await b.read(key))!.toString())
    await b.write(key, JSON.stringify({ ...sh, trashedAt: old }), 'application/json')
  }
  forgetAccess()
  const left = await runAs(ANNA, () => listTrash())
  expect(left.map((t) => t.id)).toEqual([shared])
  expect(left[0].daysLeft).toBe(0)
  expect(existsSync(path.join(dir, 'u/anna/plans', id))).toBe(false)
  expect(existsSync(path.join(dir, 'u/anna/plans', shared))).toBe(true)
})

test('the backup is a zip of everything the person has: revisions, drawings, PDF, trash, shared in', async () => {
  const mine = await make(ANNA, 'Annas lägenhet')
  await runAs(ANNA, () => putAsset(mine, 'ritning.png', Buffer.from('bild'), 'image/png'))
  const gone = await make(ANNA, 'Raderad')
  await del('ka', gone)
  const boPlan = await make(BO, 'Bos plan')
  await runAs(BO, () => putAsset(boPlan, 'kalla.png', Buffer.from('bos bild'), 'image/png'))
  await sharePOST(as('kb', `http://x/api/plans/${boPlan}/share`, { method: 'POST', body: JSON.stringify({ user: 'anna' }) }), ctx(boPlan))

  const res = await backupGET(as('ka', 'http://x/api/plans/backup'))
  expect(res.status).toBe(200)
  expect(res.headers.get('content-type')).toBe('application/zip')
  expect(res.headers.get('content-disposition')).toMatch(/attachment; filename="planer-backup-\d{4}-\d\d-\d\d\.zip"/)
  const files = unzipSync(new Uint8Array(await res.arrayBuffer()))
  const names = Object.keys(files)
  expect(names).toContain(`planer/${mine}/rev-0001.json`)
  expect(names).toContain(`planer/${mine}/head.json`)
  expect(Buffer.from(files[`planer/${mine}/assets/ritning.png`]).toString()).toBe('bild')
  expect(names.some((n) => new RegExp(`^planer/${mine}/pdf/annas-lagenhet-rev1\\.pdf$`).test(n))).toBe(true)
  const pdf = names.find((n) => n.endsWith('.pdf'))!
  expect(Buffer.from(files[pdf]).subarray(0, 4).toString()).toBe('%PDF')
  // the trashed plan is in it, marked
  expect(JSON.parse(Buffer.from(files[`planer/${gone}/shares.json`]).toString()).trashedAt).toBeTruthy()
  // what bo shares with anna is there, under bo's name
  expect(Buffer.from(files[`delade-med-mig/bo/${boPlan}/assets/kalla.png`]).toString()).toBe('bos bild')
  expect(Buffer.from(files['LAS-MIG.txt']).toString()).toContain('restore:backup')

  // bo's own backup holds bo's plan and nothing of anna's own
  const bos = Object.keys(unzipSync(new Uint8Array(await (await backupGET(as('kb', 'http://x/api/plans/backup'))).arrayBuffer())))
  expect(bos).toContain(`planer/${boPlan}/head.json`)
  expect(bos.some((n) => n.includes(mine))).toBe(false)
  expect((await backupGET(new Request('http://x/api/plans/backup'))).status).toBe(401)
})

test('only an administrator can download everyone’s data', async () => {
  const mine = await make(ANNA, 'A')
  const bos = await make(BO, 'B')
  expect((await backupGET(as('kb', 'http://x/api/plans/backup?all=1'))).status).toBe(403)
  const files = unzipSync(new Uint8Array(await (await backupGET(as('ka', 'http://x/api/plans/backup?all=1'))).arrayBuffer()))
  expect(Object.keys(files)).toEqual(expect.arrayContaining([`alla/u/anna/plans/${mine}/head.json`, `alla/u/bo/plans/${bos}/head.json`, 'LAS-MIG.txt']))
})

test('restore:backup puts the plans back for a person, skipping what exists', async () => {
  const id = await make(ANNA, 'Återställd')
  await runAs(ANNA, () => putAsset(id, 'ritning.png', Buffer.from([1, 2, 3]), 'image/png'))
  const zip = path.join(dir, 'backup.zip')
  writeFileSync(zip, Buffer.from(await (await backupGET(as('ka', 'http://x/api/plans/backup'))).arrayBuffer()))
  // a different store: nothing there yet
  const other = mkdtempSync(path.join(tmpdir(), 'plan-restore-'))
  try {
    const env = { ...process.env, PLAN_DATA_DIR: other, PLAN_STORE: 'fs' }
    const dry = execFileSync('npx', ['tsx', 'scripts/restore-backup.ts', zip, '--to', 'cecilia', '--dry-run'], { encoding: 'utf8', env })
    expect(dry).toContain('skulle skriva')
    expect(existsSync(path.join(other, 'u'))).toBe(false)
    const out = execFileSync('npx', ['tsx', 'scripts/restore-backup.ts', zip, '--to', 'cecilia'], { encoding: 'utf8', env })
    expect(out).toContain('skrev')
    expect(readFileSync(path.join(other, 'u/cecilia/plans', id, 'assets/ritning.png')).equals(Buffer.from([1, 2, 3]))).toBe(true)
    expect(existsSync(path.join(other, 'u/cecilia/plans', id, 'shares.json'))).toBe(false)
    expect(existsSync(path.join(other, 'u/cecilia/plans', id, 'pdf'))).toBe(false)
    // again: it exists, so it is skipped
    const again = execFileSync('npx', ['tsx', 'scripts/restore-backup.ts', zip, '--to', 'cecilia'], { encoding: 'utf8', env })
    expect(again).toContain('skrev 0 filer')
    process.env.PLAN_DATA_DIR = other
    process.env.PLAN_USERS = `cecilia:${hashKey('kc')}`
    expect((await planGET(as('kc', `http://x/api/plans/${id}`), ctx(id))).status).toBe(200)
  } finally {
    rmSync(other, { recursive: true, force: true })
  }
})

test('the plan list: delete moves a plan to the trash, restore brings it back, backup link is there', async ({ page, request }) => {
  const name = `Papperskorg ${Date.now()}`
  const made = await request.post('/api/plans', { data: { name } })
  const id = (await made.json()).plan.id as string
  await page.goto('/plans')
  await expect(page.getByTestId('backup-download')).toHaveAttribute('href', '/api/plans/backup')
  const row = page.getByTestId('plan-row').filter({ hasText: name })
  await row.getByTestId('delete-plan').click()
  await row.getByTestId('delete-yes').click()
  await expect(page.getByTestId('notice')).toContainText('30 dagar')
  await expect(page.getByTestId('plan-row').filter({ hasText: name })).toHaveCount(0)
  await page.getByTestId('trash').locator('summary').click()
  const t = page.getByTestId('trash-row').filter({ hasText: name })
  await expect(t).toContainText('30 dagar kvar')
  await t.getByTestId('restore-plan').click()
  await expect(page.getByTestId('plan-row').filter({ hasText: name })).toHaveCount(1)
  // clean up
  await request.delete(`/api/plans/${id}`)
  await request.delete(`/api/plans/${id}?permanent=1`)
})

test('over HTTP on the running app: the backup streams a zip', async ({ request }) => {
  // The local store holds a thousand test plans, so reading it all takes long: only the start of the stream
  // is checked here (a zip begins with "PK"), the content is covered above with a small store.
  test.setTimeout(20_000)
  const res = await fetch(`${process.env.BASE_URL || 'http://localhost:3000'}/api/plans/backup`)
  expect(res.status).toBe(200)
  expect(res.headers.get('content-type')).toBe('application/zip')
  expect(res.headers.get('transfer-encoding')).toBe('chunked')
  const reader = res.body!.getReader()
  const first = await reader.read()
  await reader.cancel()
  expect(Buffer.from(first.value!.subarray(0, 2)).toString()).toBe('PK')
  void request
})
