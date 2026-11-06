import { test, expect } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { hashKey, resolveCookie, resolveKey, resolveRequest } from '@/lib/plan/access'
import { createPlan } from '@/lib/plan/service'
import { listPlans } from '@/lib/plan/store'
import { createInvite, forgetPeople, inviteInfo, redeemInvite } from '@/lib/plan/people'
import { runAs } from '@/lib/plan/user'
import { takenByEnv } from '@/lib/plan/access'
import { DELETE as peopleDELETE, GET as peopleGET, POST as peoplePOST } from '../app/api/plans/people/route'
import { GET as inviteGET, POST as invitePOST } from '../app/api/plans/invite/route'
import { resetLimits } from '../app/api/plans/login/limit'

// Invitation links: an admin makes a link, a friend turns it into a person with a key, no redeploy.

test.describe.configure({ mode: 'serial' })

let dir = ''
const ENV = ['PLAN_USERS', 'PLAN_ADMINS', 'VERCEL', 'PLAN_DATA_DIR', 'PLAN_STORE']
const saved: Record<string, string | undefined> = {}

test.beforeEach(() => {
  for (const k of ENV) saved[k] = process.env[k]
  dir = mkdtempSync(path.join(tmpdir(), 'plan-invites-'))
  process.env.PLAN_DATA_DIR = dir
  process.env.PLAN_STORE = 'fs'
  delete process.env.VERCEL
  process.env.PLAN_USERS = `anna:${hashKey('ka')}, bo:${hashKey('kb')}`
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

const as = (key: string, init: RequestInit = {}, url = 'http://x/api/plans/people') => new Request(url, { ...init, headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', ...(init.headers ?? {}) } })
const redeem = (token: string, id: string) => invitePOST(new Request('http://x/api/plans/invite', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, id }) }))
const tokenOf = (link: string) => link.split('/').pop()!

async function invite(label = 'Cecilia', days = 7) {
  const res = await peoplePOST(as('ka', { method: 'POST', body: JSON.stringify({ label, days }) }))
  expect(res.status).toBe(201)
  return (await res.json()).link as string
}

test('only administrators see people and make invitations', async () => {
  expect((await peopleGET(as('kb'))).status).toBe(403)
  expect((await (await peopleGET(as('kb'))).json()).errors[0]).toContain('PLAN_ADMINS')
  expect((await peoplePOST(as('kb', { method: 'POST', body: '{}' }))).status).toBe(403)
  expect((await peopleGET(new Request('http://x/api/plans/people'))).status).toBe(401)
  expect((await peopleGET(as('ka'))).status).toBe(200)
  delete process.env.PLAN_ADMINS
  expect((await peopleGET(as('ka'))).status).toBe(403)
})

test('an invitation link becomes a person with a key, a login cookie and their own storage', async () => {
  const link = await invite()
  expect(link).toMatch(/^http:\/\/x\/plans\/invite\/inv_/)
  expect((await inviteInfo(tokenOf(link)))?.label).toBe('Cecilia')

  const res = await redeem(tokenOf(link), 'Cecilia-1')
  expect(res.status).toBe(201)
  const body = await res.json()
  expect(body.id).toBe('cecilia-1')
  expect(body.key).toMatch(/^pk_/)
  expect(body.connector).toBe('http://x/api/mcp')  // no key in the address: Claude signs in with OAuth
  const cookie = /plan_access=([^;]+)/.exec(res.headers.get('set-cookie') ?? '')![1]

  // The key works as a key, a bearer token and in the connector URL; the cookie works too.
  expect((await resolveKey(body.key))?.id).toBe('cecilia-1')
  expect((await resolveRequest(new Request(`http://x/api/mcp?key=${body.key}`)))?.id).toBe('cecilia-1')
  expect((await resolveRequest(new Request('http://x/api/plans', { headers: { cookie: `plan_access=${cookie}` } })))?.id).toBe('cecilia-1')
  expect(await resolveKey('fel-nyckel')).toBeNull()
  expect(await resolveCookie('cecilia-1.0000')).toBeNull()

  // Her plans are hers: nobody else sees them, and she sees nobody else's.
  const mine = await runAs({ id: 'cecilia-1' }, () => createPlan({ name: 'Ceciliaplan', template: 'empty', author: 'user' }))
  expect('errors' in mine).toBe(false)
  expect((await runAs({ id: 'cecilia-1' }, () => listPlans())).map((p) => p.name)).toEqual(['Ceciliaplan'])
  expect(await runAs({ id: 'anna' }, () => listPlans())).toEqual([])

  // The admin sees her, with the invitation gone from the pending list.
  const list = await (await peopleGET(as('ka'))).json()
  expect(list.people.map((p: { id: string }) => p.id)).toEqual(['cecilia-1'])
  expect(list.invites).toEqual([])
})

test('an invitation works once, and a taken name does not burn it', async () => {
  const token = tokenOf(await invite())
  // PLAN_USERS names and reserved names are taken; the invitation survives the attempt.
  for (const id of ['anna', 'bo', 'legacy']) {
    const r = await redeem(token, id)
    expect(r.status).toBe(400)
    expect((await r.json()).errors[0]).toContain('upptaget')
  }
  expect((await redeem(token, 'Inte giltigt!')).status).toBe(400)
  expect((await redeem(token, 'cecilia')).status).toBe(201)
  const again = await redeem(token, 'annan')
  expect(again.status).toBe(400)
  expect((await again.json()).errors[0]).toContain('Inbjudan')

  // A name another invited person holds is taken too, and then the invitation is still free.
  const second = tokenOf(await invite('Dan'))
  expect((await (await redeem(second, 'cecilia')).json()).errors[0]).toContain('upptaget')
  expect((await redeem(second, 'dan')).status).toBe(201)
})

test('two people redeeming one invitation at once: only one gets in', async () => {
  const token = tokenOf(await invite())
  const results = await Promise.all([redeem(token, 'ett'), redeem(token, 'tva')])
  expect(results.map((r) => r.status).sort()).toEqual([201, 400])
})

test('expired, withdrawn and made-up invitations are refused', async () => {
  const { token: old } = await createInvite('Gammal', 'anna', 1)
  expect(await inviteInfo(old)).not.toBeNull()
  // Expiry: rewrite the file with a date in the past.
  const { systemBackend } = await import('@/lib/plan/store')
  const { createHash } = await import('node:crypto')
  const h = createHash('sha256').update(`plan-invite:${old}`).digest('hex')
  const b = systemBackend()
  const body = JSON.parse((await b.read(`system/invites/${h}.json`))!.toString())
  await b.write(`system/invites/${h}.json`, JSON.stringify({ ...body, expiresAt: new Date(Date.now() - 1000).toISOString() }), 'application/json')
  expect(await inviteInfo(old)).toBeNull()
  expect((await redeem(old, 'sen')).status).toBe(400)

  const link = await invite('Tillbakadragen')
  const pending = (await (await peopleGET(as('ka'))).json()).invites
  expect(pending.map((i: { label: string }) => i.label)).toEqual(['Tillbakadragen'])
  const gone = await peopleDELETE(as('ka', { method: 'DELETE' }, `http://x/api/plans/people?invite=${pending[0].id}`))
  expect(gone.status).toBe(200)
  expect((await redeem(tokenOf(link), 'nyss')).status).toBe(400)

  expect(await inviteInfo('inv_hittepa')).toBeNull()
  expect((await redeem('inv_hittepa-hittepa-hittepa', 'x1')).status).toBe(400)
  expect(await redeemInvite('inv_hittepa-hittepa-hittepa', 'x1', takenByEnv)).toEqual({ ok: false, error: expect.stringContaining('Inbjudan') })
})

test('removing a person ends their access; people in PLAN_USERS are not removed here', async () => {
  const r = await redeem(tokenOf(await invite()), 'cecilia')
  const { key } = await r.json()
  expect((await resolveKey(key))?.id).toBe('cecilia')

  expect((await peopleDELETE(as('ka', { method: 'DELETE' }, 'http://x/api/plans/people?user=bo'))).status).toBe(400)
  expect((await peopleDELETE(as('ka', { method: 'DELETE' }, 'http://x/api/plans/people?user=anna'))).status).toBe(400)
  expect((await peopleDELETE(as('kb', { method: 'DELETE' }, 'http://x/api/plans/people?user=cecilia'))).status).toBe(403)
  expect((await peopleDELETE(as('ka', { method: 'DELETE' }, 'http://x/api/plans/people?user=cecilia'))).status).toBe(200)
  expect(await resolveKey(key)).toBeNull()
  expect((await peopleDELETE(as('ka', { method: 'DELETE' }, 'http://x/api/plans/people?user=cecilia'))).status).toBe(404)
  // Her name can be used again by a new invitation.
  expect((await redeem(tokenOf(await invite('Igen')), 'cecilia')).status).toBe(201)
})

test('a person who lost their key gets a new one from the admin: the old key dies, the plans stay', async () => {
  const first = await (await redeem(tokenOf(await invite()), 'cecilia')).json()
  const mine = await runAs({ id: 'cecilia' }, () => createPlan({ name: 'Ceciliaplan', template: 'empty', author: 'user' }))
  expect('errors' in mine).toBe(false)

  // Only an administrator makes the link, only for a person who joined by invitation.
  const bad = (who: string, key = 'ka') => peoplePOST(as(key, { method: 'POST', body: JSON.stringify({ resetFor: who }) }))
  expect((await bad('cecilia', 'kb')).status).toBe(403)
  expect((await bad('bo')).status).toBe(400)
  expect((await bad('finnsinte')).status).toBe(404)
  const res = await bad('cecilia')
  expect(res.status).toBe(201)
  const link = (await res.json()).link as string
  expect(await inviteInfo(tokenOf(link))).toMatchObject({ forUser: 'cecilia' })
  expect((await (await peopleGET(as('ka'))).json()).invites.map((i: { label: string }) => i.label)).toEqual(['Ny nyckel till cecilia'])

  // The old key still works until the link is used; then it does not, and the new one does.
  expect((await resolveKey(first.key))?.id).toBe('cecilia')
  const again = await redeem(tokenOf(link), 'ignoreras')
  expect(again.status).toBe(201)
  const body = await again.json()
  expect(body.id).toBe('cecilia')
  expect(body.key).toMatch(/^pk_/)
  expect(body.key).not.toBe(first.key)
  expect(await resolveKey(first.key)).toBeNull()
  expect((await resolveKey(body.key))?.id).toBe('cecilia')
  const cookie = /plan_access=([^;]+)/.exec(again.headers.get('set-cookie') ?? '')![1]
  expect((await resolveRequest(new Request('http://x/api/plans', { headers: { cookie: `plan_access=${cookie}` } })))?.id).toBe('cecilia')
  // Her plans are still hers, she is still one person in the list, and the link is spent.
  expect((await runAs({ id: 'cecilia' }, () => listPlans())).map((p) => p.name)).toEqual(['Ceciliaplan'])
  expect((await (await peopleGET(as('ka'))).json()).people.map((p: { id: string }) => p.id)).toEqual(['cecilia'])
  expect((await redeem(tokenOf(link), 'x1')).status).toBe(400)
  // A removed person cannot be given a key from an old link.
  const stale = (await (await bad('cecilia')).json()).link as string
  await peopleDELETE(as('ka', { method: 'DELETE' }, 'http://x/api/plans/people?user=cecilia'))
  expect((await (await redeem(tokenOf(stale), 'x1')).json()).errors[0]).toContain('finns inte')
})

test('the login page can check an invitation without spending it', async () => {
  const token = tokenOf(await invite('Hanna'))
  const res = await inviteGET(new Request(`http://x/api/plans/invite?token=${token}`))
  expect(res.status).toBe(200)
  expect(await res.json()).toMatchObject({ label: 'Hanna' })
  // The lookup does not claim the link: it can still be redeemed.
  expect(await inviteInfo(token)).not.toBeNull()
  expect((await inviteGET(new Request('http://x/api/plans/invite?token=inv_hittepa-hittepa-hittepa'))).status).toBe(404)
})

test('too many bad invitations from one address lock it out for a while', async () => {
  for (let i = 0; i < 5; i++) expect((await redeem('inv_fel-fel-fel-fel-fel-fel', 'x1')).status).toBe(400)
  expect((await redeem('inv_fel-fel-fel-fel-fel-fel', 'x1')).status).toBe(429)
})

test('invited people only count while PLAN_USERS is set (locked and legacy modes ignore the store)', async () => {
  const { key } = await (await redeem(tokenOf(await invite()), 'cecilia')).json()
  delete process.env.PLAN_USERS
  expect(await resolveKey(key)).toBeNull()
})

// The pages, against the running app (open locally: everyone is an administrator).
test.describe('pages', () => {
  test('make a link, open it as the friend, get a key; the admin can remove the person', async ({ page, browser }) => {
    const name = `ui${Date.now() % 1_000_000}`
    await page.goto('/plans/people')
    await page.getByTestId('invite-label').fill('Testvän')
    await page.getByTestId('invite-create').click()
    const link = await page.getByTestId('invite-link').inputValue()
    expect(link).toContain('/plans/invite/inv_')
    await expect(page.getByTestId('invite-row').filter({ hasText: 'Testvän' })).toBeVisible()

    // The friend opens the link in a fresh browser: no sign-in needed to see it.
    const friend = await browser.newContext()
    const fp = await friend.newPage()
    await fp.goto(link)
    await expect(fp.getByText('Du är inbjuden som')).toBeVisible()
    await fp.getByTestId('invite-id').fill('Inte giltigt!')
    await fp.getByTestId('invite-submit').click()
    await expect(fp.getByTestId('invite-error')).toBeVisible()
    await fp.getByTestId('invite-id').fill(name)
    await fp.getByTestId('invite-submit').click()
    // The connector leads: the address, the copy button and the way on are there at once.
    await expect(fp.getByTestId('invite-connector')).toHaveValue(/\/api\/mcp$/)
    await expect(fp.getByTestId('invite-connector-copy')).toBeVisible()
    await expect(fp.getByTestId('invite-open-claude')).toBeVisible()
    await expect(fp.getByTestId('invite-continue')).toBeVisible()
    await expect(fp.getByTestId('invite-saved')).toHaveCount(0)
    // The key waits in the collapsed disclosure.
    await expect(fp.getByTestId('invite-key')).toBeHidden()
    await fp.getByText('Bytte du enhet? Din nyckel').click()
    await expect(fp.getByTestId('invite-key')).toBeVisible()
    await expect(fp.getByTestId('invite-key')).toHaveValue(/^pk_/)
    await expect(fp.getByTestId('invite-key-copy')).toBeVisible()

    // The link is spent.
    await fp.goto(link)
    await expect(fp.getByTestId('invite-invalid')).toBeVisible()
    await friend.close()

    // The admin sees the person; a new-key link for them opens as a form without a name field.
    await page.goto('/plans/people')
    const row = page.getByTestId('person-row').filter({ hasText: name })
    await expect(row).toBeVisible()
    page.once('dialog', (d) => d.accept())
    await row.getByTestId('person-rekey').click()
    const rekeyLink = await page.getByTestId('invite-link').inputValue()
    const again = await browser.newContext()
    const ap = await again.newPage()
    await ap.goto(rekeyLink)
    await expect(ap.getByText(`Ny nyckel till ${name}`)).toBeVisible()
    await expect(ap.getByTestId('invite-id')).toHaveCount(0)
    await ap.getByTestId('invite-submit').click()
    await expect(ap.getByTestId('invite-key')).toHaveValue(/^pk_/)
    await again.close()
    // The admin removes them.
    page.once('dialog', (d) => d.accept())
    await row.getByTestId('person-remove').click()
    await expect(page.getByTestId('person-row').filter({ hasText: name })).toHaveCount(0)
  })

  test('the login page takes a pasted invitation link', async ({ page, browser }) => {
    await page.goto('/plans/people')
    await page.getByTestId('invite-label').fill('Klistra')
    await page.getByTestId('invite-create').click()
    const link = await page.getByTestId('invite-link').inputValue()
    const friend = await browser.newContext()
    const fp = await friend.newPage()
    await fp.goto('/plans/login')
    await fp.getByTestId('invite-lookup').fill(link)
    await fp.getByTestId('invite-lookup-submit').click()
    await fp.waitForURL(/\/plans\/invite\/inv_/)
    await expect(fp.getByText('Du är inbjuden som')).toBeVisible()
    await friend.close()
    // Leave no pending invitation behind: the tests in this file run in order and share the list.
    page.once('dialog', (d) => d.accept())
    await page.getByTestId('invite-row').filter({ hasText: 'Klistra' }).getByRole('button', { name: 'Dra tillbaka' }).click()
    await expect(page.getByTestId('invite-row').filter({ hasText: 'Klistra' })).toHaveCount(0)
  })
})
