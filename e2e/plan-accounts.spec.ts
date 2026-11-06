import { test, expect } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { hashKey } from '@/lib/plan/access'
import { createInvite, forgetPeople } from '@/lib/plan/people'
import { POST as loginPOST } from '../app/api/plans/login/route'
import { POST as invitePOST } from '../app/api/plans/invite/route'
import { DELETE as accountsDELETE, GET as accountsGET, POST as accountsPOST } from '../app/api/plans/accounts/route'
import { GET as listGET } from '../app/api/plans/route'
import { resetLimits } from '../app/api/plans/login/limit'

// Several people signed in on one browser: signing in as another keeps the first, a menu switches between them.

test.describe.configure({ mode: 'serial' })

let dir = ''
const ENV = ['PLAN_USERS', 'PLAN_ADMINS', 'VERCEL', 'PLAN_DATA_DIR', 'PLAN_STORE']
const saved: Record<string, string | undefined> = {}

test.beforeEach(() => {
  for (const k of ENV) saved[k] = process.env[k]
  dir = mkdtempSync(path.join(tmpdir(), 'plan-accounts-'))
  process.env.PLAN_DATA_DIR = dir
  process.env.PLAN_STORE = 'fs'
  delete process.env.VERCEL
  process.env.PLAN_USERS = `anna:${hashKey('ka')}, bo:${hashKey('kb')}, cy:${hashKey('kc')}`
  process.env.PLAN_ADMINS = 'anna'
  forgetPeople()
  resetLimits()
})
test.afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  rmSync(dir, { recursive: true, force: true })
})

// A browser: the cookies it holds, updated from every Set-Cookie the app sends.
class Browser {
  jar = new Map<string, string>()
  eat(res: Response) {
    for (const c of res.headers.getSetCookie()) {
      const [pair, ...attrs] = c.split(';')
      const [name, ...v] = pair.split('=')
      const gone = attrs.some((a) => /max-age=0/i.test(a)) || !v.join('=')
      if (gone) this.jar.delete(name.trim())
      else this.jar.set(name.trim(), v.join('='))
    }
    return res
  }
  get cookie() {
    return [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ')
  }
  req(url: string, init: RequestInit = {}) {
    return new Request(url, { ...init, headers: { cookie: this.cookie, 'content-type': 'application/json', ...(init.headers ?? {}) } })
  }
  async login(key: string) {
    const form = new FormData()
    form.set('password', key)
    form.set('next', '/plans')
    return this.eat(await loginPOST(new Request('http://x/api/plans/login', { method: 'POST', body: form, headers: { cookie: this.cookie } })))
  }
  async who() {
    return (await (await accountsGET(this.req('http://x/api/plans/accounts'))).json()) as { me: string | null; others: string[] }
  }
  async switchTo(id: string) {
    return this.eat(await accountsPOST(this.req('http://x/api/plans/accounts', { method: 'POST', body: JSON.stringify({ switchTo: id }) })))
  }
  async signOut(id = '') {
    return this.eat(await accountsDELETE(this.req(`http://x/api/plans/accounts${id ? `?id=${id}` : ''}`, { method: 'DELETE' })))
  }
  async plansAs() {
    return (await listGET(this.req('http://x/api/plans'))).status
  }
}

test('signing in as someone else keeps the first; the menu switches between them', async () => {
  const b = new Browser()
  expect(await b.who()).toMatchObject({ me: null, others: [], signIn: true, admin: false })
  await b.login('ka')
  expect(await b.who()).toMatchObject({ me: 'anna', others: [] })
  // anna tries an invitation login: bo becomes the one in use, anna stays
  await b.login('kb')
  expect(await b.who()).toMatchObject({ me: 'bo', others: ['anna'] })
  // a third
  await b.login('kc')
  expect(await b.who()).toMatchObject({ me: 'cy', others: expect.arrayContaining(['anna', 'bo']) })
  expect((await b.who()).others).toHaveLength(2)

  // back to anna without her key; the one in use moves to the list
  const sw = await b.switchTo('anna')
  expect(sw.status).toBe(200)
  expect(await b.who()).toMatchObject({ me: 'anna', others: expect.arrayContaining(['bo', 'cy']) })
  expect(await b.plansAs()).toBe(200)
  // someone not signed in here cannot be switched to
  const nope = await b.switchTo('finnsinte')
  expect(nope.status).toBe(404)
  expect(await b.who()).toMatchObject({ me: 'anna' })
})

test('signing in again as the same person does not duplicate them', async () => {
  const b = new Browser()
  await b.login('ka')
  await b.login('kb')
  await b.login('ka')
  expect(await b.who()).toMatchObject({ me: 'anna', others: ['bo'] })
})

test('signing out: the next person takes over; forgetting one leaves the others', async () => {
  const b = new Browser()
  await b.login('ka')
  await b.login('kb')
  await b.login('kc')
  // forget bo only
  await b.signOut('bo')
  expect(await b.who()).toMatchObject({ me: 'cy', others: ['anna'] })
  // sign out cy: anna takes over
  await b.signOut()
  expect(await b.who()).toMatchObject({ me: 'anna', others: [] })
  // sign out the last one: nobody
  await b.signOut()
  expect(await b.who()).toMatchObject({ me: null, others: [] })
  expect(await b.plansAs()).toBe(401)
})

test('a removed or wrong cookie in the list is dropped, not used', async () => {
  const b = new Browser()
  await b.login('ka')
  await b.login('kb')
  // bo's key is removed from PLAN_USERS: bo's saved/active cookie stops working, anna's stays
  process.env.PLAN_USERS = `anna:${hashKey('ka')}`
  expect(await b.who()).toMatchObject({ me: null, others: ['anna'] })
  // a forged entry is not accepted
  b.jar.set('plan_accounts', 'anna.0000|cy.1111')
  expect((await b.who()).others).toEqual([])
  expect((await b.switchTo('anna')).status).toBe(404)
})

test('accepting an invitation while signed in as the administrator keeps the administrator', async () => {
  const b = new Browser()
  await b.login('ka')
  const { token } = await createInvite('Testvän', 'anna', 7)
  const res = b.eat(await invitePOST(b.req('http://x/api/plans/invite', { method: 'POST', body: JSON.stringify({ token, id: 'ny-van' }) })))
  expect(res.status).toBe(201)
  expect(await b.who()).toMatchObject({ me: 'ny-van', others: ['anna'] })
  // one click back to the administrator
  await b.switchTo('anna')
  expect(await b.who()).toMatchObject({ me: 'anna', others: ['ny-van'] })
})
