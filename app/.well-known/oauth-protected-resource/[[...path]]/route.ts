export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// RFC 9728: which resource this is and who signs people in for it. Served at the
// root and with the resource path appended (…/oauth-protected-resource/api/mcp).
export async function GET(req: Request) {
  const origin = new URL(req.url).origin
  return Response.json(
    { resource: `${origin}/api/mcp`, authorization_servers: [origin], scopes_supported: ['plans'], bearer_methods_supported: ['header'], resource_name: 'Planritningar' },
    { headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' } },
  )
}
