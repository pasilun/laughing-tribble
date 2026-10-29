import { PLAN_TOOLS, handlePlanTool } from '@/lib/plan/mcp-tools'
import { hasAccess } from '@/lib/plan/access'

export const runtime = 'nodejs'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Mcp-Session-Id',
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

export async function POST(request: Request) {
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
      },
    }, 200, { 'Mcp-Session-Id': SESSION_ID })
  }

  if (method === 'tools/list') {
    return mcpResp({ jsonrpc: '2.0', id, result: { tools: PLAN_TOOLS } })
  }

  if (method === 'tools/call') {
    const { name, arguments: args = {} } = params as {
      name?: string
      arguments?: Record<string, unknown>
    }

    if (name) {
      try {
        // Plan tools need the plan password (connector URL ?key=… or bearer token).
        if (PLAN_TOOLS.some((t) => t.name === name) && !hasAccess(request))
          return mcpResp({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: 'Planverktygen kräver lösenord: lägg till ?key=<PLAN_PASSWORD> i MCP-adressen.' }], isError: true } })
        const planResult = await handlePlanTool(name, args)
        if (planResult) return mcpResp({ jsonrpc: '2.0', id, result: planResult })
      } catch (err) {
        return mcpResp({ jsonrpc: '2.0', id, error: { code: -32603, message: err instanceof Error ? err.message : 'Internal error' } })
      }
    }

    return mcpResp({ jsonrpc: '2.0', id, error: { code: -32602, message: 'Unknown tool' } })
  }

  return mcpResp({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } })
}
