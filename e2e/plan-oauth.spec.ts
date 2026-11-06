import { test, expect } from '@playwright/test'
import { createHash, randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { cookieFor, hashKey } from '@/lib/plan/access'
import { createInvite, forgetPeople, redeemInvite, removePerson } from '@/lib/plan/people'
import { systemBackend } from '@/lib/plan/store'
import { takenByEnv } from '@/lib/plan/access'
import { GET as protectedGET } from '../app/.well-known/oauth-protected-resource/[[...path]]/route'
import { GET as serverGET } from '../app/.well-known/oauth-authorization-server/route'
import { POST as registerPOST } from '../app/oauth/register/route'
import { POST as decisionPOST } from '../app/oauth/authorize/decision/route'
import { POST as tokenPOST } from '../app/oauth/token/route'
import { POST as mcpPOST } from '../app/api/mcp/route'
import { resetLimits } from '../app/api/plans/login/limit'
import { checkAuthRequest } from '@/lib/plan/oauth'

// Claude signs a person in with OAuth (dynamic registration, authorization code + PKCE, rotating tokens).

test.describe.configure({ mode: 'serial' })

let dir = ''
const ENV = ['PLAN_USERS', 'PLAN_ADMINS', 'VERCEL', 'PLAN_DATA_DIR', 'PLAN_STORE']
const saved: Record<string, string | undefined> = {}
const HOST = 'https://plan.example'
const CALLBACK = 'https://claude.ai/api/mcp/auth_callback'

test.beforeEach(() => {
  for (const k of ENV) saved[k] = process.env[k]
  dir = mkdtempSync(path.join(tmpdir(), 'plan-oauth-'))
  process.env.PLAN_DATA_DIR = dir
  process.env.PLAN_STORE = 'fs'
  delete process.env.VERCEL
  process.env.PLAN_USERS = `anna:${hashKey('ka')}, bo:${hashKey('kb')}`
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

const json = (url: string, body: unknown) => new Request(`${HOST}${url}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const pkce = () => {
  const verifier = randomBytes(32).toString('base64url')
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') }
}
const mcp = (headers: Record<string, string> = {}, url = `${HOST}/api/mcp`) =>
  mcpPOST(new Request(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'plan_list', arguments: {} } }) }))

async function register(uris = [CALLBACK]) {
  const res = await registerPOST(json('/oauth/register', { client_name: 'Claude', redirect_uris: uris, token_endpoint_auth_method: 'none' }))
  expect(res.status).toBe(201)
  return (await res.json()).client_id as string
}

function authForm(clientId: string, challenge: string, extra: Record<string, string> = {}) {
  return new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: CALLBACK, state: 'st4te', code_challenge: challenge, code_challenge_method: 'S256', ...extra })
}

async function decide(form: URLSearchParams, decision: 'approve' | 'deny', cookie?: string) {
  form.set('decision', decision)
  return decisionPOST(new Request(`${HOST}/oauth/authorize/decision`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', ...(cookie ? { cookie: `plan_access=${cookie}` } : {}) }, body: form.toString() }))
}

const tokenReq = (params: Record<string, string>) => tokenPOST(new Request(`${HOST}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params).toString() }))

async function signIn(cookie: string, clientId?: string) {
  const id = clientId ?? (await register())
  const { verifier, challenge } = pkce()
  const res = await decide(authForm(id, challenge), 'approve', cookie)
  expect(res.status).toBe(303)
  const loc = new URL(res.headers.get('location')!)
  expect(loc.origin + loc.pathname).toBe(CALLBACK)
  expect(loc.searchParams.get('state')).toBe('st4te')
  const code = loc.searchParams.get('code')!
  return { id, verifier, code }
}

const annaCookie = () => cookieFor({ id: 'anna' })

test('discovery documents point at the sign-in endpoints', async () => {
  const pr = await (await protectedGET(new Request(`${HOST}/.well-known/oauth-protected-resource`))).json()
  expect(pr.resource).toBe(`${HOST}/api/mcp`)
  expect(pr.authorization_servers).toEqual([HOST])
  const as = await (await serverGET(new Request(`${HOST}/.well-known/oauth-authorization-server`))).json()
  expect(as.issuer).toBe(HOST)
  expect(as.authorization_endpoint).toBe(`${HOST}/oauth/authorize`)
  expect(as.token_endpoint).toBe(`${HOST}/oauth/token`)
  expect(as.registration_endpoint).toBe(`${HOST}/oauth/register`)
  expect(as.code_challenge_methods_supported).toEqual(['S256'])
  expect(as.token_endpoint_auth_methods_supported).toContain('none')
})

test('the connector answers 401 with a pointer to the sign-in; keys as bearer tokens and OAuth tokens get in, a key in the address does not', async () => {
  const none = await mcp()
  expect(none.status).toBe(401)
  expect(none.headers.get('www-authenticate')).toBe(`Bearer resource_metadata="${HOST}/.well-known/oauth-protected-resource"`)
  const wrong = await mcp({ authorization: 'Bearer at_inte-giltig-token-alls-nej' })
  expect(wrong.status).toBe(401)
  expect(wrong.headers.get('www-authenticate')).toContain('error="invalid_token"')
  expect((await mcp({}, `${HOST}/api/mcp?key=ka`)).status).toBe(401)
  expect((await mcp({ authorization: 'Bearer ka' })).status).toBe(200)
  expect((await mcp({ authorization: 'Bearer kb' })).status).toBe(200)
  // initialize and tools/list need it too: that is what starts the sign-in.
  const init = await mcpPOST(new Request(`${HOST}/api/mcp`, { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }) }))
  expect(init.status).toBe(401)
})

test('registration: Claude and local addresses only, public client, the same registration gives the same id', async () => {
  const a = await register()
  expect(await register()).toBe(a)
  expect(await register(['http://localhost:3118/callback'])).not.toBe(a)
  for (const uris of [['https://evil.example/cb'], [CALLBACK, 'https://evil.example/cb'], ['http://evil.example/cb'], ['javascript:alert(1)'], []]) {
    const res = await registerPOST(json('/oauth/register', { redirect_uris: uris }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_redirect_uri')
  }
  // Five refused registrations in a row from one address lock it for a while.
  expect((await registerPOST(json('/oauth/register', { redirect_uris: ['https://evil.example/cb'] }))).status).toBe(429)
  resetLimits()
  const secret = await registerPOST(json('/oauth/register', { redirect_uris: [CALLBACK], token_endpoint_auth_method: 'client_secret_post' }))
  expect(secret.status).toBe(400)
  expect((await secret.json()).error).toBe('invalid_client_metadata')
})

test('authorization: the person must be signed in; a bad client or address is never redirected to', async () => {
  const id = await register()
  const { challenge } = pkce()
  expect((await decide(authForm(id, challenge), 'approve')).status).toBe(401)
  expect((await decide(authForm(id, challenge), 'approve', 'anna.fel')).status).toBe(401)

  // Fatal mistakes show an error to the person instead of redirecting.
  expect((await decide(authForm('c_00000000000000000000000000000000', challenge), 'approve', annaCookie())).status).toBe(400)
  expect((await decide(authForm(id, challenge, { redirect_uri: 'https://evil.example/cb' }), 'approve', annaCookie())).status).toBe(400)
  const fatal = await checkAuthRequest(authForm(id, challenge, { redirect_uri: 'https://evil.example/cb' }))
  expect(fatal.ok === false && fatal.fatal).toBe(true)

  // Other mistakes go back to the client with an error.
  const noPkce = await decide(authForm(id, challenge, { code_challenge_method: 'plain' }), 'approve', annaCookie())
  expect(noPkce.status).toBe(303)
  expect(new URL(noPkce.headers.get('location')!).searchParams.get('error')).toBe('invalid_request')
  const denied = await decide(authForm(id, challenge), 'deny', annaCookie())
  const dl = new URL(denied.headers.get('location')!)
  expect(dl.searchParams.get('error')).toBe('access_denied')
  expect(dl.searchParams.get('state')).toBe('st4te')
  expect(dl.searchParams.get('code')).toBeNull()

  // Another site cannot post for the person.
  const cross = await decisionPOST(new Request(`${HOST}/oauth/authorize/decision`, { method: 'POST', headers: { origin: 'https://evil.example', cookie: `plan_access=${annaCookie()}`, 'content-type': 'application/x-www-form-urlencoded' }, body: authForm(id, challenge).toString() + '&decision=approve' }))
  expect(cross.status).toBe(403)
})

test('the whole flow: code, PKCE, tokens, MCP call as that person, rotating refresh', async () => {
  const { id, verifier, code } = await signIn(annaCookie())
  const exch = await tokenReq({ grant_type: 'authorization_code', code, client_id: id, redirect_uri: CALLBACK, code_verifier: verifier })
  expect(exch.status).toBe(200)
  expect(exch.headers.get('cache-control')).toBe('no-store')
  const t1 = await exch.json()
  expect(t1.token_type).toBe('Bearer')
  expect(t1.expires_in).toBe(3600)
  expect(t1.access_token).toMatch(/^at_/)
  expect(t1.refresh_token).toMatch(/^rt_/)

  // A Claude call with the token runs as anna: it lists anna's plans, not bo's.
  const ok = await mcp({ authorization: `Bearer ${t1.access_token}` })
  expect(ok.status).toBe(200)
  expect((await ok.json()).result.content[0].text).toContain('Inga planer')

  // The code cannot be used twice.
  const again = await tokenReq({ grant_type: 'authorization_code', code, client_id: id, redirect_uri: CALLBACK, code_verifier: verifier })
  expect(again.status).toBe(400)
  expect((await again.json()).error).toBe('invalid_grant')

  // Refresh: new pair; the old refresh token and the old access token stop working.
  const ref = await tokenReq({ grant_type: 'refresh_token', refresh_token: t1.refresh_token, client_id: id })
  expect(ref.status).toBe(200)
  const t2 = await ref.json()
  expect(t2.access_token).not.toBe(t1.access_token)
  expect((await tokenReq({ grant_type: 'refresh_token', refresh_token: t1.refresh_token, client_id: id })).status).toBe(400)
  forgetPeople()
  expect((await mcp({ authorization: `Bearer ${t1.access_token}` })).status).toBe(401)
  expect((await mcp({ authorization: `Bearer ${t2.access_token}` })).status).toBe(200)
  // A refresh token belongs to its client.
  const other = await register(['http://localhost:4000/cb'])
  expect((await tokenReq({ grant_type: 'refresh_token', refresh_token: t2.refresh_token, client_id: other })).status).toBe(400)
})

test('the token endpoint refuses a wrong verifier, a wrong address, another client and unknown grants', async () => {
  // Wrong verifier: refused, and the code is spent.
  const a = await signIn(annaCookie())
  const wrong = await tokenReq({ grant_type: 'authorization_code', code: a.code, client_id: a.id, redirect_uri: CALLBACK, code_verifier: pkce().verifier })
  expect(wrong.status).toBe(400)
  expect((await wrong.json()).error_description).toContain('PKCE')
  expect((await tokenReq({ grant_type: 'authorization_code', code: a.code, client_id: a.id, redirect_uri: CALLBACK, code_verifier: a.verifier })).status).toBe(400)

  const b = await signIn(annaCookie())
  expect((await tokenReq({ grant_type: 'authorization_code', code: b.code, client_id: b.id, redirect_uri: 'https://claude.com/api/mcp/auth_callback', code_verifier: b.verifier })).status).toBe(400)
  const c = await signIn(annaCookie())
  const other = await register(['http://localhost:5000/cb'])
  expect((await tokenReq({ grant_type: 'authorization_code', code: c.code, client_id: other, redirect_uri: CALLBACK, code_verifier: c.verifier })).status).toBe(400)

  const grant = await tokenReq({ grant_type: 'client_credentials' })
  expect(grant.status).toBe(400)
  expect((await grant.json()).error).toBe('unsupported_grant_type')
  expect((await tokenReq({ grant_type: 'authorization_code', code: 'ac_hittepa-hittepa-hittepa', client_id: a.id, redirect_uri: CALLBACK, code_verifier: a.verifier })).status).toBe(400)
  // JSON bodies work too.
  const d = await signIn(annaCookie())
  const viaJson = await tokenPOST(json('/oauth/token', { grant_type: 'authorization_code', code: d.code, client_id: d.id, redirect_uri: CALLBACK, code_verifier: d.verifier }))
  expect(viaJson.status).toBe(200)
})

test('an expired access token is refused; removing the person ends their tokens', async () => {
  const s = await signIn(annaCookie())
  const t = await (await tokenReq({ grant_type: 'authorization_code', code: s.code, client_id: s.id, redirect_uri: CALLBACK, code_verifier: s.verifier })).json()
  // Expire it in the store.
  const h = createHash('sha256').update(`plan-oauth:${t.access_token}`).digest('hex')
  const b = systemBackend()
  const rec = JSON.parse((await b.read(`system/oauth/access/${h}.json`))!.toString())
  await b.write(`system/oauth/access/${h}.json`, JSON.stringify({ ...rec, expiresAt: Date.now() - 1000 }), 'application/json')
  forgetPeople()
  expect((await mcp({ authorization: `Bearer ${t.access_token}` })).status).toBe(401)

  // A person who joined by invitation, signed in through Claude, then removed.
  const { token } = await createInvite('Cecilia', 'anna', 7)
  const joined = await redeemInvite(token, 'cecilia', takenByEnv)
  if (!joined.ok) throw new Error(joined.error)
  const cookie = cookieFor({ id: 'cecilia' }) || `cecilia.${createHash('sha256').update(`plan-access:${joined.person.keyHash}`).digest('hex')}`
  const c = await signIn(cookie)
  const ct = await (await tokenReq({ grant_type: 'authorization_code', code: c.code, client_id: c.id, redirect_uri: CALLBACK, code_verifier: c.verifier })).json()
  expect((await mcp({ authorization: `Bearer ${ct.access_token}` })).status).toBe(200)
  await removePerson('cecilia')
  expect((await mcp({ authorization: `Bearer ${ct.access_token}` })).status).toBe(401)
})

test('without personal keys configured, nobody can authorize', async () => {
  const id = await register()
  delete process.env.PLAN_USERS
  expect((await decide(authForm(id, pkce().challenge), 'approve', 'anna.x')).status).toBe(403)
})
