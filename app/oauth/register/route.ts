import { registerClient } from '@/lib/plan/auth/oauth'
import { allowed, fail } from '../../api/plans/login/limit'

export const runtime = 'nodejs'

const H = { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' }
export async function OPTIONS() {
  return new Response(null, { status: 204, headers: { ...H, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' } })
}

// RFC 7591 Dynamic Client Registration. Public clients only, and only Claude's own redirect addresses.
export async function POST(req: Request) {
  const ip = `reg:${(req.headers.get('x-forwarded-for') ?? 'lokal').split(',')[0].trim()}`
  if (!allowed(ip)) return Response.json({ error: 'temporarily_unavailable', error_description: 'För många registreringar – vänta en stund.' }, { status: 429, headers: H })
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'invalid_client_metadata', error_description: 'JSON krävs' }, { status: 400, headers: H })
  }
  const res = await registerClient(body ?? {})
  if (!res.ok) {
    fail(ip)
    return Response.json({ error: res.error, error_description: res.description }, { status: 400, headers: H })
  }
  const c = res.client
  return Response.json(
    {
      client_id: c.id,
      client_id_issued_at: Math.floor(new Date(c.createdAt).getTime() / 1000),
      client_name: c.name,
      redirect_uris: c.redirectUris,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope: 'plans',
    },
    { status: 201, headers: H },
  )
}
