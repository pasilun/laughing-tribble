import { PLAN_TOOLS, handlePlanTool, instructionsFor, toolsFor } from '@/lib/plan/mcp-tools'
import { presentedCredential, resolveRequest } from '@/lib/plan/access'
import { runAs } from '@/lib/plan/user'

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

const SESSION_ID = 'plan-studio-stateless-1'

export async function GET() {
  return mcpResp({ name: 'plan-studio', version: '1.0.0', transport: 'streamable-http' })
}

// Without a signed-in person the answer is 401 with a pointer to where Claude finds the sign-in
// (RFC 9728); a 200 would not start it. A key in the URL or a bearer token still works as before.
function unauthorized(request: Request) {
  const origin = new URL(request.url).origin
  const error = presentedCredential(request) ? ', error="invalid_token"' : ''
  return mcpResp({ error: 'unauthorized' }, 401, { 'WWW-Authenticate': `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"${error}` })
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
        serverInfo: { name: 'plan-studio', version: '1.0.0' },
        instructions: instructionsFor(new URL(request.url).searchParams.get('tools')),
      },
    }, 200, { 'Mcp-Session-Id': SESSION_ID })
  }

  if (method === 'tools/list') {
    return mcpResp({ jsonrpc: '2.0', id, result: { tools: toolsFor(new URL(request.url).searchParams.get('tools')) } })
  }

  if (method === 'tools/call') {
    const { name, arguments: args = {} } = params as {
      name?: string
      arguments?: Record<string, unknown>
    }

    if (name) {
      try {
        // Plan tools need the plan password (connector URL ?key=… or bearer token).
        if (PLAN_TOOLS.some((t) => t.name === name)) {
          const planResult = await runAs(person, () => handlePlanTool(name, args))
          if (planResult) return mcpResp({ jsonrpc: '2.0', id, result: planResult })
        }
      } catch (err) {
        return mcpResp({ jsonrpc: '2.0', id, error: { code: -32603, message: err instanceof Error ? err.message : 'Internal error' } })
      }
    }

    return mcpResp({ jsonrpc: '2.0', id, error: { code: -32602, message: 'Unknown tool' } })
  }

  return mcpResp({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } })
}
