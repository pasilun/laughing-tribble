export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// RFC 8414: where to register, authorize and get tokens. Public clients with PKCE only.
export async function GET(req: Request) {
  const origin = new URL(req.url).origin
  return Response.json(
    {
      issuer: origin,
      authorization_endpoint: `${origin}/oauth/authorize`,
      token_endpoint: `${origin}/oauth/token`,
      registration_endpoint: `${origin}/oauth/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      scopes_supported: ['plans'],
    },
    { headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' } },
  )
}
