import { createHash, randomBytes } from 'crypto'
import { cached, forgetPeople, personById, readJson, store, writeJson } from './people'

// OAuth 2.1 for the MCP connector, so Claude signs a person in instead of carrying a key in the URL.
// The person signs in with the key or invitation they already have; this only issues tokens.
//
//   Dynamic Client Registration (RFC 7591)  – Claude registers itself; ids are derived from what was registered
//   Authorization code + PKCE (S256)        – public clients, no client secret
//   Opaque tokens, stored hashed            – access 1 h, refresh 90 d, refresh tokens rotate
//
//   system/oauth/clients/<client id>.json   { name, redirectUris, createdAt }
//   system/oauth/codes/<hash>.json          { userId, clientId, redirectUri, challenge, expiresAt }   (single use)
//   system/oauth/access/<hash>.json         { userId, clientId, expiresAt }
//   system/oauth/refresh/<hash>.json        { userId, clientId, expiresAt, accessHash }

const sha = (s: string) => createHash('sha256').update(s).digest('hex')
const tokenHash = (t: string) => sha(`plan-oauth:${t}`)
const rand = (prefix: string) => `${prefix}${randomBytes(32).toString('base64url')}`

export const ACCESS_TTL_S = 3600
const REFRESH_TTL_S = 90 * 86_400
const CODE_TTL_S = 600

export type Client = { id: string; name: string; redirectUris: string[]; createdAt: string }

// ── registration ───────────────────────────────────────────────────────────

// Only Claude's own callbacks and loopback redirects (Claude Code) may be registered, so a
// stranger cannot register a client that sends a signed-in person's code to a site of theirs.
const FIXED_REDIRECTS = ['https://claude.ai/api/mcp/auth_callback', 'https://claude.com/api/mcp/auth_callback']

export function redirectAllowed(uri: string): boolean {
  let u: URL
  try {
    u = new URL(uri)
  } catch {
    return false
  }
  if (u.hash) return false
  if (FIXED_REDIRECTS.includes(uri)) return true
  if ((process.env.PLAN_OAUTH_REDIRECTS ?? '').split(/[\s,]+/).includes(uri)) return true
  return u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) && !u.username && !u.password
}

export async function registerClient(body: Record<string, unknown>): Promise<{ ok: true; client: Client } | { ok: false; error: string; description: string }> {
  const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris.map(String) : []
  if (uris.length === 0 || uris.length > 5) return { ok: false, error: 'invalid_redirect_uri', description: 'redirect_uris krävs (högst 5)' }
  if (!uris.every(redirectAllowed)) return { ok: false, error: 'invalid_redirect_uri', description: 'Den här servern tar bara emot Claudes egna återanrop och lokala (localhost) adresser.' }
  const method = body.token_endpoint_auth_method
  if (method !== undefined && method !== 'none') return { ok: false, error: 'invalid_client_metadata', description: 'Bara token_endpoint_auth_method "none" (publik klient med PKCE) stöds.' }
  const name = String(body.client_name ?? 'Claude').replace(/[\r\n<>]/g, ' ').trim().slice(0, 60) || 'Claude'
  // The same registration gives the same id: Claude registers again on every connection.
  const sorted = [...new Set(uris)].sort()
  const id = `c_${sha(JSON.stringify([name, sorted])).slice(0, 32)}`
  const existing = await readJson<Omit<Client, 'id'>>(clientKey(id))
  const client: Client = { id, name, redirectUris: sorted, createdAt: existing?.createdAt ?? new Date().toISOString() }
  if (!existing) await writeJson(clientKey(id), { name, redirectUris: sorted, createdAt: client.createdAt })
  return { ok: true, client }
}

const clientKey = (id: string) => `system/oauth/clients/${id}.json`

export async function getClient(id: string): Promise<Client | null> {
  if (!/^c_[0-9a-f]{32}$/.test(id)) return null
  const c = await cached(`oc:${id}`, () => readJson<Omit<Client, 'id'>>(clientKey(id)))
  return c ? { id, ...c } : null
}

// ── authorization ──────────────────────────────────────────────────────────

export type AuthRequest = { client: Client; redirectUri: string; state: string; challenge: string; resource: string }
export type AuthCheck = { ok: true; req: AuthRequest } | { ok: false; fatal: true; message: string } | { ok: false; fatal: false; message: string; redirectUri: string; state: string; error: string }

// A bad client or redirect is shown to the person, never redirected to; other mistakes go back to the client.
export async function checkAuthRequest(p: URLSearchParams | FormData): Promise<AuthCheck> {
  const get = (k: string) => String(p.get(k) ?? '')
  const client = await getClient(get('client_id'))
  if (!client) return { ok: false, fatal: true, message: 'Okänd klient. Lägg till kopplingen i Claude igen.' }
  const redirectUri = get('redirect_uri')
  if (!client.redirectUris.includes(redirectUri)) return { ok: false, fatal: true, message: 'Återanropsadressen stämmer inte med den registrerade.' }
  const state = get('state')
  const back = (error: string, message: string): AuthCheck => ({ ok: false, fatal: false, message, redirectUri, state, error })
  if (get('response_type') !== 'code') return back('unsupported_response_type', 'response_type måste vara code')
  const challenge = get('code_challenge')
  if (get('code_challenge_method') !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) return back('invalid_request', 'PKCE med S256 krävs')
  return { ok: true, req: { client, redirectUri, state, challenge, resource: get('resource') } }
}

export async function issueCode(userId: string, r: AuthRequest): Promise<string> {
  const code = rand('ac_')
  await writeJson(`system/oauth/codes/${tokenHash(code)}.json`, { userId, clientId: r.client.id, redirectUri: r.redirectUri, challenge: r.challenge, expiresAt: Date.now() + CODE_TTL_S * 1000 })
  return code
}

// ── tokens ─────────────────────────────────────────────────────────────────

type Issued = { access_token: string; token_type: 'Bearer'; expires_in: number; refresh_token: string; scope: string }
export type TokenResult = { ok: true; tokens: Issued } | { ok: false; error: string; description: string }

const accessKey = (h: string) => `system/oauth/access/${h}.json`
const refreshKey = (h: string) => `system/oauth/refresh/${h}.json`

async function issueTokens(userId: string, clientId: string): Promise<Issued> {
  const access = rand('at_')
  const refresh = rand('rt_')
  const ah = tokenHash(access)
  await writeJson(accessKey(ah), { userId, clientId, expiresAt: Date.now() + ACCESS_TTL_S * 1000 })
  await writeJson(refreshKey(tokenHash(refresh)), { userId, clientId, expiresAt: Date.now() + REFRESH_TTL_S * 1000, accessHash: ah })
  return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL_S, refresh_token: refresh, scope: 'plans' }
}

const bad = (error: string, description: string): TokenResult => ({ ok: false, error, description })

export async function exchangeCode(p: { code: string; clientId: string; redirectUri: string; verifier: string }): Promise<TokenResult> {
  if (!/^ac_[A-Za-z0-9_-]{20,80}$/.test(p.code)) return bad('invalid_grant', 'Ogiltig kod')
  const h = tokenHash(p.code)
  const rec = await readJson<{ userId: string; clientId: string; redirectUri: string; challenge: string; expiresAt: number }>(`system/oauth/codes/${h}.json`)
  if (!rec) return bad('invalid_grant', 'Koden finns inte eller är redan använd')
  // One use: whoever creates the marker first spends the code.
  const spent = await writeJson(`system/oauth/used/${h}.json`, { at: Date.now() }, true)
  if (!spent) return bad('invalid_grant', 'Koden är redan använd')
  await store().remove([`system/oauth/codes/${h}.json`])
  if (rec.expiresAt < Date.now()) return bad('invalid_grant', 'Koden har gått ut')
  if (rec.clientId !== p.clientId || rec.redirectUri !== p.redirectUri) return bad('invalid_grant', 'Koden hör till en annan klient eller adress')
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(p.verifier) || createHash('sha256').update(p.verifier).digest('base64url') !== rec.challenge) return bad('invalid_grant', 'PKCE-verifieringen stämde inte')
  return { ok: true, tokens: await issueTokens(rec.userId, rec.clientId) }
}

export async function refreshTokens(p: { refreshToken: string; clientId: string }): Promise<TokenResult> {
  if (!/^rt_[A-Za-z0-9_-]{20,80}$/.test(p.refreshToken)) return bad('invalid_grant', 'Ogiltig förnyelsetoken')
  const h = tokenHash(p.refreshToken)
  const rec = await readJson<{ userId: string; clientId: string; expiresAt: number; accessHash: string }>(refreshKey(h))
  if (!rec || rec.expiresAt < Date.now() || rec.clientId !== p.clientId) return bad('invalid_grant', 'Förnyelsetoken gäller inte längre')
  // Rotation with a single-use claim: whoever creates the marker first spends the token, so two
  // concurrent refreshes with the same token cannot both succeed (the same pattern as the code
  // exchange above).
  const spent = await writeJson(`system/oauth/used/rt/${h}.json`, { at: Date.now() }, true)
  if (!spent) return bad('invalid_grant', 'Förnyelsetoken är redan använd')
  // The old pair is gone before the new one is handed out, so a reused token fails.
  await store().remove([refreshKey(h), accessKey(rec.accessHash)])
  forgetPeople()
  return { ok: true, tokens: await issueTokens(rec.userId, rec.clientId) }
}

// The person behind an access token, while the token is valid and the person still exists.
export async function userFromAccessToken(token: string, isEnvUser: (id: string) => boolean): Promise<{ id: string } | null> {
  if (!/^at_[A-Za-z0-9_-]{20,80}$/.test(token)) return null
  const h = tokenHash(token)
  const rec = await cached(`ot:${h}`, () => readJson<{ userId: string; expiresAt: number }>(accessKey(h)))
  if (!rec || rec.expiresAt < Date.now()) return null
  if (isEnvUser(rec.userId) || (await personById(rec.userId))) return { id: rec.userId }
  return null
}
