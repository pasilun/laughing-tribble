import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { accessMode, cookieFor, cookieValue, denied, hashKey, isAdmin, reservedByEnv, resolveCookie, resolveKey, resolveRequest, userFromKey } from '@/lib/plan/auth/access'
import { bumpSessionVersion, createInvite, forgetPeople, redeemInvite } from '@/lib/plan/auth/people'
import { takenByEnv } from '@/lib/plan/auth/access'
import { allowed, fail, ok, resetLimits } from '../app/api/plans/login/limit'

test.describe.configure({ mode: 'serial' })

const ENV = ['PLAN_USERS', 'VERCEL', 'PLAN_DATA_DIR', 'PLAN_STORE']
const saved: Record<string, string | undefined> = {}
test.beforeEach(() => {
  for (const k of ENV) {
    saved[k] = process.env[k]
    delete process.env[k]
  }
})
test.afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  resetLimits()
})

const req = (url = 'http://x/api/plans', headers: Record<string, string> = {}) => new Request(url, { headers })
const users = () => `anna:${hashKey('annas-nyckel')}, bo:${hashKey('bos-nyckel')}`
const bearer = (key: string) => ({ authorization: `Bearer ${key}` })
const who = async (url: string, headers: Record<string, string> = {}) => resolveRequest(req(url, headers))

test('open locally without any configuration, closed on Vercel', async () => {
  expect(accessMode()).toBe('open')
  expect(await who('http://x/api/plans')).toEqual({ id: 'local', legacy: true })
  process.env.VERCEL = '1'
  expect(accessMode()).toBe('locked')
  expect(await who('http://x/api/plans')).toBeNull()
  expect(await who('http://x/api/plans?key=nagot')).toBeNull()
  expect((await denied().json()).errors[0]).toContain('PLAN_USERS')
  expect(denied().status).toBe(503)
})

test('each person has their own key: bearer or cookie, nothing else (not a key in the address)', async () => {
  process.env.PLAN_USERS = users()
  expect(accessMode()).toBe('users')
  expect(await who('http://x/api/plans')).toBeNull()
  expect(await who('http://x/api/plans', bearer('fel'))).toBeNull()
  expect((await who('http://x/api/plans', bearer('annas-nyckel')))?.id).toBe('anna')
  expect((await who('http://x/api/plans', bearer('bos-nyckel')))?.id).toBe('bo')
  // a key in the URL is no longer accepted: it ends up in logs and history
  expect(await who('http://x/api/mcp?key=annas-nyckel')).toBeNull()
  expect(userFromKey('bos-nyckel')?.id).toBe('bo')
  expect(userFromKey('bos-nyckel ')).toBeNull()
  const anna = userFromKey('annas-nyckel')!
  const cookie = cookieFor(anna)
  expect((await who('http://x/api/plans', { cookie: `a=1; plan_access=${cookie}` }))?.id).toBe('anna')
  // a cookie can't be made by knowing the person's id, or the key itself
  expect(await who('http://x/api/plans', { cookie: 'plan_access=anna.abc' })).toBeNull()
  expect(await who('http://x/api/plans', { cookie: 'plan_access=annas-nyckel' })).toBeNull()
  // a cookie from one person never opens another's data
  expect(await who('http://x/api/plans', { cookie: `plan_access=${cookie.replace('anna.', 'bo.')}` })).toBeNull()
})

test('removing someone from PLAN_USERS ends their sessions; broken entries are ignored', async () => {
  process.env.PLAN_USERS = users()
  const cookie = cookieFor(userFromKey('bos-nyckel')!)
  process.env.PLAN_USERS = `anna:${hashKey('annas-nyckel')}, Fel Id:abc, bo:inte-en-hash`
  expect(await who('http://x/api/plans', { cookie: `plan_access=${cookie}` })).toBeNull()
  expect(await who('http://x/api/plans', bearer('bos-nyckel'))).toBeNull()
  expect((await who('http://x/api/plans', bearer('annas-nyckel')))?.id).toBe('anna')
  // set but unusable = nobody gets in
  process.env.PLAN_USERS = 'bara-skräp'
  expect(await who('http://x/api/plans', bearer('annas-nyckel'))).toBeNull()
})

test('the old single password is gone: it opens nothing, with or without PLAN_USERS', async () => {
  process.env.PLAN_PASSWORD = 'hemligt'
  // On Vercel without PLAN_USERS nothing gets in, whatever else is set.
  process.env.VERCEL = '1'
  expect(accessMode()).toBe('locked')
  expect(await who('http://x/api/plans', bearer('hemligt'))).toBeNull()
  // With PLAN_USERS only personal keys count.
  process.env.PLAN_USERS = users()
  expect(accessMode()).toBe('users')
  expect(await who('http://x/api/plans', bearer('hemligt'))).toBeNull()
  expect((await who('http://x/api/plans', bearer('bos-nyckel')))?.id).toBe('bo')
  delete process.env.PLAN_PASSWORD
})

test('an administrator is a PLAN_USERS person named in PLAN_ADMINS; no name can be chosen into it', () => {
  process.env.PLAN_USERS = users()
  process.env.PLAN_ADMINS = 'anna, ghost'
  try {
    expect(isAdmin({ id: 'anna' })).toBe(true)
    expect(isAdmin({ id: 'bo' })).toBe(false)
    // named as an administrator but not a person in PLAN_USERS: nobody is, even if they join by an invitation as "ghost"
    expect(isAdmin({ id: 'ghost' })).toBe(false)
    // and the names are kept out of invitations, administrators' too
    expect(reservedByEnv('anna')).toBe(true)
    expect(reservedByEnv('ghost')).toBe(true)
    expect(reservedByEnv('cecilia')).toBe(false)
  } finally {
    delete process.env.PLAN_ADMINS
  }
})

test('login attempts: five wrong keys lock an address for ten minutes', () => {
  const t = 1_000_000
  for (let i = 0; i < 5; i++) {
    expect(allowed('1.2.3.4', t + i)).toBe(true)
    fail('1.2.3.4', t + i)
  }
  expect(allowed('1.2.3.4', t + 10)).toBe(false)
  expect(allowed('5.6.7.8', t + 10)).toBe(true)
  expect(allowed('1.2.3.4', t + 10 * 60 * 1000 + 100)).toBe(true)
  fail('9.9.9.9', t)
  ok('9.9.9.9')
  expect(allowed('9.9.9.9', t + 1)).toBe(true)
})

test('npm run user:add makes a key whose hash the app accepts', () => {
  const out = execFileSync('npx', ['tsx', 'scripts/user-add.ts', 'cecilia', 'https://exempel.vercel.app'], { encoding: 'utf8' })
  const key = /Nyckel:\s+(pk_\S+)/.exec(out)![1]
  const line = /^\s+(cecilia:[0-9a-f]{64})$/m.exec(out)![1]
  process.env.PLAN_USERS = line
  expect(userFromKey(key)?.id).toBe('cecilia')
  expect(out).toContain('https://exempel.vercel.app/api/mcp')
  expect(out).not.toContain('?key=')
})

test('a session version changes the cookie format: bumping it ends sessions, the key survives', async () => {
  process.env.PLAN_USERS = users()
  const dir = mkdtempSync(path.join(tmpdir(), 'plan-access-'))
  process.env.PLAN_DATA_DIR = dir
  process.env.PLAN_STORE = 'fs'
  try {
    const { token } = await createInvite('Version', 'anna', 7)
    const res = await redeemInvite(token, 'version', takenByEnv)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const { person, key } = res
    // No version yet: the cookie in the old derivation resolves.
    const oldCookie = cookieValue({ id: person.id, hash: person.keyHash })
    expect(oldCookie).not.toContain(':')
    expect((await resolveCookie(oldCookie))?.id).toBe(person.id)
    // Bump: the old cookie stops resolving, the new format resolves, the key still works.
    expect(await bumpSessionVersion(person.id)).toBe(1)
    forgetPeople()
    expect(await resolveCookie(oldCookie)).toBeNull()
    expect((await resolveCookie(cookieValue({ id: person.id, hash: person.keyHash, sessionVersion: 1 })))?.id).toBe(person.id)
    expect((await resolveKey(key))?.id).toBe(person.id)
    // The wrong version is somebody else's guess: it does not resolve either.
    expect(await resolveCookie(cookieValue({ id: person.id, hash: person.keyHash, sessionVersion: 2 }))).toBeNull()
  } finally {
    rmSync(dir, { recursive: true, force: true })
    forgetPeople()
  }
})
