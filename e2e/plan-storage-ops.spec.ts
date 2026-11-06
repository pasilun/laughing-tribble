import { test, expect } from '@playwright/test'
import { promises as fsp } from 'node:fs'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { forgetPeople } from '@/lib/plan/people'
import { hashKey } from '@/lib/plan/access'
import { createPlan } from '@/lib/plan/service'
import { forgetAccess, listPlansAndTrash } from '@/lib/plan/store'
import { addShare, removeShare } from '@/lib/plan/shares'
import { runAs } from '@/lib/plan/user'
import { GET as accountsGET } from '../app/api/plans/accounts/route'

// Listing a folder is a billed "advanced operation" on Vercel Blob (2 000 a month on Hobby, as are all
// writes). The plan list, the trash and the admin check must not list more than they have to.

test.describe.configure({ mode: 'serial' })

const ANNA = { id: 'anna' }
const BO = { id: 'bo' }
let dir = ''
const ENV = ['PLAN_USERS', 'PLAN_ADMINS', 'VERCEL', 'PLAN_DATA_DIR', 'PLAN_STORE']
const saved: Record<string, string | undefined> = {}

test.beforeEach(() => {
  for (const k of ENV) saved[k] = process.env[k]
  dir = mkdtempSync(path.join(tmpdir(), 'plan-ops-'))
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

// Counts the folder listings the store makes while fn runs (the file store lists with readdir).
const count = async (fn: () => Promise<unknown>) => {
  const real = fsp.readdir
  let n = 0
  ;(fsp as unknown as { readdir: unknown }).readdir = (...a: unknown[]) => {
    n++
    return (real as (...x: unknown[]) => unknown)(...a)
  }
  try {
    await fn()
  } finally {
    ;(fsp as unknown as { readdir: unknown }).readdir = real
  }
  return n
}
async function make(user: { id: string }, name: string) {
  const res = await runAs(user, () => createPlan({ name, template: 'demo', author: 'user' }))
  if ('errors' in res) throw new Error('create')
  return res.plan.id
}

test('the plan list and the trash come from one listing, and shared plans need no listing once indexed', async () => {
  const id = await make(ANNA, 'Annas')
  // the first list builds the index of shared plans (one more listing); after that one listing is enough
  await runAs(ANNA, () => listPlansAndTrash())
  const n = await count(() => runAs(ANNA, () => listPlansAndTrash()))
  expect(n).toBe(1)
  const both = await runAs(ANNA, () => listPlansAndTrash())
  expect(both.plans.map((p) => p.id)).toEqual([id])
  expect(both.trash).toEqual([])

  // sharing keeps the index right without another listing for the person who gets the plan
  await runAs(BO, () => listPlansAndTrash()) // builds bo's index (bo has nothing yet)
  expect(await runAs(ANNA, () => addShare(id, 'bo'))).toBeNull()
  const m = await count(async () => {
    const l = await runAs(BO, () => listPlansAndTrash())
    expect(l.plans.map((p) => p.id)).toEqual([id])
  })
  expect(m).toBeLessThanOrEqual(1)
  // leaving is seen at once too
  expect(await runAs(ANNA, () => removeShare(id, 'bo'))).toBeNull()
  expect((await runAs(BO, () => listPlansAndTrash())).plans).toEqual([])
})

test('an index that is missing or a day old is rebuilt from the pointers', async () => {
  const id = await make(ANNA, 'Delad')
  await runAs(ANNA, () => addShare(id, 'bo')) // bo has no index yet: nothing to update
  expect((await runAs(BO, () => listPlansAndTrash())).plans.map((p) => p.id)).toEqual([id])
  // make the index look old and stale (missing the plan): the next list finds the pointer again
  const idx = path.join(dir, 'u/bo/shared.json')
  await fsp.writeFile(idx, JSON.stringify({ ids: [], checkedAt: new Date(Date.now() - 2 * 86_400_000).toISOString() }))
  expect((await runAs(BO, () => listPlansAndTrash())).plans.map((p) => p.id)).toEqual([id])
})

test('the admin check costs no listing: the accounts answer carries it', async () => {
  const req = (key: string) => new Request('http://x/api/plans/accounts', { headers: { cookie: `plan_access=${cookieOf(key)}` } })
  const { cookieFor, userFromKey } = await import('@/lib/plan/access')
  const cookieOf = (key: string) => cookieFor(userFromKey(key)!)
  let res: Response | undefined
  const n = await count(async () => {
    res = await accountsGET(req('ka'))
  })
  expect(n).toBe(0)
  expect(await res!.json()).toMatchObject({ me: 'anna', admin: true })
  expect(await (await accountsGET(req('kb'))).json()).toMatchObject({ me: 'bo', admin: false })
})
