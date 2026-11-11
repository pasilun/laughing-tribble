import { CONNECTOR_INSTRUCTIONS, callConnectorTool, connectorList } from '@/lib/plan/connector'
import { presentedCredential, resolveRequest } from '@/lib/plan/auth/access'
import { runAs } from '@/lib/plan/auth/user'
import { PublicError } from '@/lib/plan/storage/storage'

export const runtime = 'nodejs'
// Scans and renders can take a while.
export const maxDuration = 60

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Mcp-Session-Id, Authorization',
  'Access-Control-Expose-Headers': 'WWW-Authenticate',
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS })
}

function mcpResp(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return Response.json(body, { status, headers: { ...CORS, ...extra } })
}

const SESSION_ID = 'planstudio-stateless-1'

export async function GET() {
  return mcpResp({ name: 'planstudio', version: '1', transport: 'streamable-http' })
}

// Without a signed-in person the answer is 401 with a pointer to where Claude finds the sign-in
// (RFC 9728); a 200 would not start it. A key in the URL or a bearer token still works as before.
function unauthorized(request: Request) {
  const origin = new URL(request.url).origin
  const error = presentedCredential(request) ? ', error="invalid_token"' : ''
  return mcpResp({ error: 'unauthorized' }, 401, { 'WWW-Authenticate': `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/api/connector"${error}` })
}

export async function POST(request: Request) {
  const person = await resolveRequest(request)
  if (!person) return unauthorized(request)
  let body: { id?: string | number | null; method?: string; params?: Record<string, unknown> }
  try {
    body = await request.json()
  } catch {
    return mcpResp({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, 400)
  }

  const { id = null, method, params = {} } = body

  if (method === 'notifications/initialized') {
    return new Response(null, { status: 204, headers: CORS })
  }

  if (method === 'initialize') {
    return mcpResp({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2025-03-26',
        capabilities: { tools: {} },
        serverInfo: { name: 'planstudio', version: '1' },
        instructions: CONNECTOR_INSTRUCTIONS,
      },
    }, 200, { 'Mcp-Session-Id': SESSION_ID })
  }

  if (method === 'tools/list') {
    return mcpResp({ jsonrpc: '2.0', id, result: { tools: connectorList() } })
  }

  if (method === 'tools/call') {
    const { name, arguments: args = {} } = params as {
      name?: string
      arguments?: Record<string, unknown>
    }

    if (name) {
      try {
        // Tools run as the signed-in person (bearer token: an OAuth token or a personal key).
        const result = await runAs(person, () => callConnectorTool(name, args))
        if (result) return mcpResp({ jsonrpc: '2.0', id, result })
      } catch (err) {
        if (!(err instanceof PublicError)) console.error('[mcp]', name, err)
        return mcpResp({ jsonrpc: '2.0', id, error: { code: -32603, message: err instanceof PublicError ? err.message : 'Internal error' } })
      }
    }

    return mcpResp({ jsonrpc: '2.0', id, error: { code: -32602, message: 'Unknown tool' } })
  }

  return mcpResp({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } })
}
