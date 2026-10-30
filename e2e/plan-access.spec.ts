import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { accessMode, authenticate, cookieFor, denied, hashKey, userFromKey } from '@/lib/plan/access'
import { allowed, fail, ok, resetLimits } from '../app/api/plans/login/limit'

test.describe.configure({ mode: 'serial' })

const ENV = ['PLAN_USERS', 'PLAN_PASSWORD', 'VERCEL']
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

test('open locally without any configuration, closed on Vercel', async () => {
  expect(accessMode()).toBe('open')
  expect(authenticate(req())).toEqual({ id: 'local', legacy: true })
  process.env.VERCEL = '1'
  expect(accessMode()).toBe('locked')
  expect(authenticate(req())).toBeNull()
  expect(authenticate(req('http://x/api/plans?key=nagot'))).toBeNull()
  expect((await denied().json()).errors[0]).toContain('PLAN_USERS')
  expect(denied().status).toBe(503)
})

test('each person has their own key: bearer, ?key= or cookie, nothing else', () => {
  process.env.PLAN_USERS = users()
  expect(accessMode()).toBe('users')
  expect(authenticate(req())).toBeNull()
  expect(authenticate(req('http://x/api/mcp?key=fel'))).toBeNull()
  expect(authenticate(req('http://x/api/mcp?key=annas-nyckel'))?.id).toBe('anna')
  expect(authenticate(req('http://x/api/plans', { authorization: 'Bearer bos-nyckel' }))?.id).toBe('bo')
  expect(userFromKey('bos-nyckel')?.id).toBe('bo')
  expect(userFromKey('bos-nyckel ')).toBeNull()
  const anna = authenticate(req('http://x/?key=annas-nyckel'))!
  const cookie = cookieFor(anna)
  expect(authenticate(req('http://x/api/plans', { cookie: `a=1; plan_access=${cookie}` }))?.id).toBe('anna')
  // a cookie can't be made by knowing the person's id, or the key itself
  expect(authenticate(req('http://x/api/plans', { cookie: 'plan_access=anna.abc' }))).toBeNull()
  expect(authenticate(req('http://x/api/plans', { cookie: 'plan_access=annas-nyckel' }))).toBeNull()
  // a cookie from one person never opens another's data
  expect(authenticate(req('http://x/api/plans', { cookie: `plan_access=${cookie.replace('anna.', 'bo.')}` }))).toBeNull()
})

test('removing someone from PLAN_USERS ends their sessions; broken entries are ignored', () => {
  process.env.PLAN_USERS = users()
  const cookie = cookieFor(authenticate(req('http://x/?key=bos-nyckel'))!)
  process.env.PLAN_USERS = `anna:${hashKey('annas-nyckel')}, Fel Id:abc, bo:inte-en-hash`
  expect(authenticate(req('http://x/api/plans', { cookie: `plan_access=${cookie}` }))).toBeNull()
  expect(authenticate(req('http://x/?key=bos-nyckel'))).toBeNull()
  expect(authenticate(req('http://x/?key=annas-nyckel'))?.id).toBe('anna')
  // set but unusable = nobody gets in
  process.env.PLAN_USERS = 'bara-skräp'
  expect(authenticate(req('http://x/?key=annas-nyckel'))).toBeNull()
})

test('single-password mode still works and keeps the old shared layout', () => {
  process.env.PLAN_PASSWORD = 'hemligt'
  expect(accessMode()).toBe('legacy')
  expect(authenticate(req())).toBeNull()
  expect(authenticate(req('http://x/api/mcp?key=hemligt'))).toEqual({ id: 'legacy', legacy: true })
  expect(authenticate(req('http://x/api/plans', { authorization: 'Bearer hemligt' }))?.legacy).toBe(true)
  // PLAN_USERS wins when both are set
  process.env.PLAN_USERS = users()
  expect(authenticate(req('http://x/api/mcp?key=hemligt'))).toBeNull()
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
  expect(out).toContain(`https://exempel.vercel.app/api/mcp?key=${key}`)
})
