import { deflateRawSync } from 'zlib'
import { buildingFromParams } from '@/lib/building-factory'

export const runtime = 'nodejs'

const TOOL_DEF = {
  name: 'generate_building_link',
  description:
    'Generate a 3D IFC building model from parameters and return a shareable viewer URL. The URL encodes the full building model — no server storage needed.',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Building name' },
      length: { type: 'number', description: 'Building length in metres (east-west)' },
      width: { type: 'number', description: 'Building width in metres (north-south)' },
      wallHeight: { type: 'number', description: 'Wall height in metres, default 2.4' },
      wallThickness: { type: 'number', description: 'Wall thickness in metres, default 0.12' },
      roof: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['sadel', 'pulpet', 'flat'],
            description: 'sadel=gable, pulpet=mono-pitch, flat=flat',
          },
          pitch: { type: 'number', description: 'Roof pitch in degrees, default 22' },
          overhang: { type: 'number', description: 'Roof overhang in metres, default 0.3' },
        },
        required: ['type'],
      },
      openings: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            wall: { type: 'string', enum: ['south', 'north', 'east', 'west'] },
            type: { type: 'string', enum: ['door', 'window'] },
            width: { type: 'number' },
            height: { type: 'number' },
            offsetFromStart: {
              type: 'number',
              description: 'Metres from start of wall; default: centered',
            },
            sillHeight: {
              type: 'number',
              description: 'Metres from floor; default 0 for door, 0.9 for window',
            },
          },
          required: ['wall', 'type'],
        },
      },
    },
    required: ['length', 'width', 'roof'],
  },
}

export async function GET() {
  return Response.json({
    name: 'ifc-building-generator',
    version: '1.0.0',
    transport: 'streamable-http',
  })
}

export async function POST(request: Request) {
  let body: { id?: string | number | null; method?: string; params?: Record<string, unknown> }
  try {
    body = await request.json()
  } catch {
    return Response.json(
      { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } },
      { status: 400 }
    )
  }

  const { id = null, method, params = {} } = body

  if (method === 'notifications/initialized') {
    return new Response(null, { status: 204 })
  }

  if (method === 'initialize') {
    return Response.json({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'ifc-building-generator', version: '1.0.0' },
      },
    })
  }

  if (method === 'tools/list') {
    return Response.json({
      jsonrpc: '2.0',
      id,
      result: { tools: [TOOL_DEF] },
    })
  }

  if (method === 'tools/call') {
    const { name, arguments: args = {} } = params as {
      name?: string
      arguments?: Record<string, unknown>
    }

    if (name !== 'generate_building_link') {
      return Response.json({
        jsonrpc: '2.0',
        id,
        error: { code: -32602, message: 'Unknown tool' },
      })
    }

    try {
      const model = buildingFromParams(args as unknown as Parameters<typeof buildingFromParams>[0])
      const json = JSON.stringify(model)
      const compressed = deflateRawSync(Buffer.from(json, 'utf-8'))
      const encoded = compressed
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '')

      const host = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'http://localhost:3000'
      const url = `${host}/view#${encoded}`

      return Response.json({
        jsonrpc: '2.0',
        id,
        result: { content: [{ type: 'text', text: url }] },
      })
    } catch (err) {
      return Response.json({
        jsonrpc: '2.0',
        id,
        error: {
          code: -32603,
          message: err instanceof Error ? err.message : 'Internal error',
        },
      })
    }
  }

  return Response.json({
    jsonrpc: '2.0',
    id,
    error: { code: -32601, message: 'Method not found' },
  })
}
