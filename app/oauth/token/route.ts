import { exchangeCode, refreshTokens, type TokenResult } from '@/lib/plan/oauth'

export const runtime = 'nodejs'

const H = { 'Cache-Control': 'no-store', Pragma: 'no-cache', 'Access-Control-Allow-Origin': '*' }
export async function OPTIONS() {
  return new Response(null, { status: 204, headers: { ...H, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } })
}

const err = (error: string, description: string, status = 400) => Response.json({ error, error_description: description }, { status, headers: H })

// The token endpoint: authorization_code (with PKCE) and refresh_token, as a form post (RFC 6749 §4.1.3).
export async function POST(req: Request) {
  // No attempt limit here: codes and tokens are long random strings, and Claude's requests all
  // come from a shared address range, where one failure must not lock everyone out.
  const type = req.headers.get('content-type') ?? ''
  const p = new Map<string, string>()
  try {
    if (type.includes('application/json')) for (const [k, v] of Object.entries((await req.json()) as Record<string, unknown>)) p.set(k, String(v))
    else for (const [k, v] of new URLSearchParams(await req.text())) p.set(k, v)
  } catch {
    return err('invalid_request', 'Kunde inte läsa förfrågan')
  }
  const grant = p.get('grant_type')
  let res: TokenResult
  if (grant === 'authorization_code') {
    res = await exchangeCode({ code: p.get('code') ?? '', clientId: p.get('client_id') ?? '', redirectUri: p.get('redirect_uri') ?? '', verifier: p.get('code_verifier') ?? '' })
  } else if (grant === 'refresh_token') {
    res = await refreshTokens({ refreshToken: p.get('refresh_token') ?? '', clientId: p.get('client_id') ?? '' })
  } else {
    return err('unsupported_grant_type', 'grant_type måste vara authorization_code eller refresh_token')
  }
  if (!res.ok) return err(res.error, res.description)
  return Response.json(res.tokens, { headers: H })
}
