import { test, expect } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createClient } from '@libsql/client'
import { unzipSync } from 'fflate'
import { forgetPeople } from '@/lib/plan/people'
import { hashKey } from '@/lib/plan/access'
import { copyPages, type Source } from '@/lib/plan/migrate-store'
import { createPlan, editPlan } from '@/lib/plan/service'
import { getAsset, getRevision, listPlansAndTrash, putAsset, saveRevision } from '@/lib/plan/store'
import { ConflictError, storageKind, storageProbe, systemBackend, useTursoForTests } from '@/lib/plan/storage'
import { forgetAccess } from '@/lib/plan/docs'
import { PLANS } from '@/lib/plan/docs'
import { addShare } from '@/lib/plan/shares'
import { TursoBackend } from '@/lib/plan/turso'
import { runAs } from '@/lib/plan/user'
import { DELETE as planDELETE } from '../app/api/plans/[id]/route'
import { POST as restorePOST } from '../app/api/plans/[id]/restore/route'
import { GET as backupGET } from '../app/api/plans/backup/route'

// The Turso store behaves like the file store, the whole app runs on it, and the Blob store can be copied into it.

test.describe.configure({ mode: 'serial' })

const ANNA = { id: 'anna' }
const BO = { id: 'bo' }
let dir = ''
const ENV = ['PLAN_USERS', 'PLAN_ADMINS', 'VERCEL', 'PLAN_DATA_DIR', 'PLAN_STORE']
const saved: Record<string, string | undefined> = {}

const newBackend = () => new TursoBackend(async () => createClient({ url: `file:${path.join(dir, 'turso.db')}` }))

test.beforeEach(() => {
  for (const k of ENV) saved[k] = process.env[k]
  dir = mkdtempSync(path.join(tmpdir(), 'plan-turso-'))
  process.env.PLAN_DATA_DIR = dir
  process.env.PLAN_STORE = 'turso'
  delete process.env.VERCEL
  process.env.PLAN_USERS = `anna:${hashKey('ka')}, bo:${hashKey('kb')}`
  process.env.PLAN_ADMINS = 'anna'
  useTursoForTests(newBackend())
  forgetPeople()
  forgetAccess()
})
test.afterEach(() => {
  useTursoForTests(null)
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  rmSync(dir, { recursive: true, force: true })
})

const as = (key: string, url: string, init: RequestInit = {}) => new Request(url, { ...init, headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', ...(init.headers ?? {}) } })
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

test('the store contract: read, write, write-only-if-new, remove, prefix listing, binary data', async () => {
  const b = systemBackend()
  expect(storageKind()).toBe('turso')
  expect(await b.read('a/x.json')).toBeNull()
  expect(await b.write('a/x.json', '{"n":1}', 'application/json')).toBe(true)
  expect((await b.read('a/x.json'))!.toString()).toBe('{"n":1}')
  // overwrite
  expect(await b.write('a/x.json', Buffer.from('två'), 'text/plain')).toBe(true)
  expect((await b.read('a/x.json'))!.toString()).toBe('två')
  // write-only-if-new: the first wins, the second is refused and changes nothing
  expect(await b.write('a/new.json', 'ett', 'text/plain', { createOnly: true })).toBe(true)
  expect(await b.write('a/new.json', 'två', 'text/plain', { createOnly: true })).toBe(false)
  expect((await b.read('a/new.json'))!.toString()).toBe('ett')
  // binary data survives
  const bin = Buffer.from(Array.from({ length: 300 }, (_, i) => i % 256))
  await b.write('a/y/z.png', bin, 'image/png')
  expect((await b.read('a/y/z.png'))!.equals(bin)).toBe(true)
  // a prefix is a folder: a/ has three files (also below a/y), ab/ and a-b are not in it
  await b.write('ab/x.json', '1', 'text/plain')
  await b.write('a-b.json', '1', 'text/plain')
  expect((await b.keys('a')).sort()).toEqual(['a/new.json', 'a/x.json', 'a/y/z.png'])
  expect(await b.keys('a/y')).toEqual(['a/y/z.png'])
  expect(await b.keys('finns-inte')).toEqual([])
  await b.remove(['a/x.json', 'a/new.json', 'finns/inte.json'])
  expect(await b.keys('a')).toEqual(['a/y/z.png'])
  await b.remove([])
})

test('the whole app on Turso: plans, revisions, assets, sharing, trash, backup, and the health probe', async () => {
  const made = await runAs(ANNA, () => createPlan({ name: 'På Turso', template: 'demo', author: 'user' }))
  if ('errors' in made) throw new Error('create')
  const id = made.plan.id
  expect((await runAs(ANNA, () => editPlan(id, [], 1, 'user', 'En ändring'))).status).toBe(200)
  // a stale save is a conflict, as with the other stores
  await expect(runAs(ANNA, () => saveRevision(made.plan, { author: 'user', message: 'x' }, 1))).rejects.toBeInstanceOf(ConflictError)
  await runAs(ANNA, () => putAsset(id, 'ritning.png', Buffer.from([1, 2, 3, 250]), 'image/png'))
  expect((await runAs(ANNA, () => getAsset(id, 'ritning.png')))!.equals(Buffer.from([1, 2, 3, 250]))).toBe(true)

  // sharing: bo sees it, makes a revision of it
  expect(await runAs(ANNA, () => addShare(PLANS, id, 'bo'))).toBeNull()
  expect((await runAs(BO, () => listPlansAndTrash())).plans.map((p) => p.id)).toEqual([id])
  expect((await runAs(BO, () => editPlan(id, [], 2, 'user', 'Bo')))!.status).toBe(200)
  expect((await runAs(ANNA, () => getRevision(id)))!.meta).toMatchObject({ n: 3, by: 'bo' })

  // trash and restore
  expect((await planDELETE(as('ka', `http://x/api/plans/${id}`, { method: 'DELETE' }), ctx(id))).status).toBe(200)
  expect((await runAs(ANNA, () => listPlansAndTrash())).trash.map((t) => t.id)).toEqual([id])
  expect((await restorePOST(as('ka', `http://x/api/plans/${id}/restore`, { method: 'POST' }), ctx(id))).status).toBe(200)
  expect((await runAs(ANNA, () => listPlansAndTrash())).plans.map((p) => p.id)).toEqual([id])

  // the backup reads the same store
  const files = unzipSync(new Uint8Array(await (await backupGET(as('ka', 'http://x/api/plans/backup'))).arrayBuffer()))
  expect(Object.keys(files)).toEqual(expect.arrayContaining([`planer/${id}/rev-0003.json`, `planer/${id}/assets/ritning.png`, 'LAS-MIG.txt']))

  const probe = await storageProbe()
  expect(probe).toMatchObject({ kind: 'turso', ok: true })
})

test('copying another store into Turso: every file, in pages, safe to repeat, resumable', async () => {
  // a source with a known set of files (the Blob store in production)
  const files = new Map<string, Buffer>()
  for (let i = 0; i < 23; i++) files.set(`u/anna/plans/p${i % 3}/rev-${String(i).padStart(4, '0')}.json`, Buffer.from(`{"i":${i}}`))
  files.set('u/anna/plans/p0/assets/skiss.png', Buffer.from([0, 255, 7, 8]))
  files.set('system/users/bo.json', Buffer.from('{"id":"bo"}'))
  const names = [...files.keys()].sort()
  const source: Source = {
    async page(cursor, limit = 10) {
      const from = cursor ? names.indexOf(cursor) : 0
      const keys = names.slice(from, from + limit)
      return { keys, cursor: names[from + limit] }
    },
    async read(k) {
      return files.get(k) ?? null
    },
  }
  const target = systemBackend() as TursoBackend

  // a first stretch that stops after one page, then the rest from the cursor
  const first = await copyPages(source, target, { limit: 10, budgetMs: 0 })
  expect(first.done).toBe(false)
  expect(first.copied).toBe(10)
  const rest = await copyPages(source, target, { limit: 10, cursor: first.cursor })
  expect(rest.done).toBe(true)
  expect(first.copied + rest.copied).toBe(files.size)
  expect(await target.count()).toBe(files.size)
  for (const [k, v] of files) expect((await target.read(k))!.equals(v)).toBe(true)

  // again: nothing is duplicated, changed files are overwritten, a file that vanishes is reported
  files.set('system/users/bo.json', Buffer.from('{"id":"bo","ny":true}'))
  const again = await copyPages(source, target, { limit: 50 })
  expect(again.done).toBe(true)
  expect(await target.count()).toBe(files.size)
  expect((await target.read('system/users/bo.json'))!.toString()).toContain('ny')
  files.delete(names[0])
  const gone = await copyPages({ ...source, read: async (k) => files.get(k) ?? null }, target, { limit: 50 })
  expect(gone.missing).toEqual([names[0]])
})
