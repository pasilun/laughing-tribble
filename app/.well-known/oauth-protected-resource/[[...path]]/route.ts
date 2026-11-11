export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// RFC 9728: which resource this is and who signs people in for it. Served at the
// root and with the resource path appended (…/oauth-protected-resource/api/mcp).
export async function GET(req: Request) {
  const url = new URL(req.url)
  const origin = url.origin
  // The connector at /api/connector, or the old one at /api/mcp (the path after the well-known prefix tells which).
  const rest = url.pathname.replace(/^\/\.well-known\/oauth-protected-resource/, '')
  const resource = rest.startsWith('/api/connector') ? `${origin}/api/connector` : `${origin}/api/mcp`
  return Response.json(
    { resource, authorization_servers: [origin], scopes_supported: ['plans'], bearer_methods_supported: ['header'], resource_name: 'Planritningar' },
    { headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' } },
  )
}
