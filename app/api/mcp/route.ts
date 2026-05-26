import { deflateRawSync } from 'zlib'
import { buildingFromParams } from '@/lib/building-factory'
import { assessPermitRequirement } from '@/lib/triage-engine'
import type { TriageInput } from '@/lib/triage-engine'

export const runtime = 'nodejs'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Mcp-Session-Id',
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS })
}

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
      partitions: {
        type: 'array',
        description: 'Interior partition walls that divide the building',
        items: {
          type: 'object',
          properties: {
            direction: {
              type: 'string',
              enum: ['ew', 'ns'],
              description: 'ew = runs east-west (divides building north/south), ns = runs north-south (divides building east/west)',
            },
            offset: {
              type: 'number',
              description: 'Distance in metres from the south wall (ew) or west wall (ns)',
            },
            thickness: { type: 'number', description: 'Wall thickness in metres, default 0.1' },
            height: { type: 'number', description: 'Wall height in metres, default same as exterior walls' },
          },
          required: ['direction', 'offset'],
        },
      },
    },
    required: ['length', 'width', 'roof'],
  },
}

const TRIAGE_TOOL_DEF = {
  name: 'assess_permit_requirement',
  description:
    'Assess whether a Swedish building project requires bygglov, anmälan, or is permit-free (lovfri). Returns a bucket verdict and the finding IDs that drove it. Regulatory version: PBL post-2025-12-01.',
  inputSchema: {
    type: 'object',
    properties: {
      flow_type: {
        type: 'string',
        enum: ['komplementbyggnad', 'komplementbostadshus', 'tillbyggnad', 'eldstad', 'plank', 'mur', 'other'],
        description: 'Type of building project',
      },
      inom_detaljplan: { type: 'boolean', description: 'Is the property within a detaljplan area?' },
      planned_area_m2: { type: 'number', description: 'Planned building footprint area in m² (BYA)' },
      planned_nockhoejd_m: { type: 'number', description: 'Planned ridge height in metres' },
      existing_lovfri_area_m2: { type: 'number', description: 'Sum of existing lovfri komplement building areas on the property (BYA), default 0' },
      planned_distance_to_grans_m: { type: 'number', description: 'Smallest distance to any property boundary in metres' },
      planned_distance_to_allman_plats_m: { type: 'number', description: 'Distance to nearest allmän plats (public space) in metres, omit if none nearby' },
      installations: {
        type: 'array',
        items: { type: 'string', enum: ['vatten', 'avlopp', 'eldstad', 'rökkanal', 'ventilation', 'ändrad_bärande_konstruktion'] },
        description: 'Planned installations that may trigger anmälan',
      },
      strandskyddsomrade: { type: 'boolean', description: 'Is the property within 300m of water (strandskyddsområde)?' },
      k_marking: { type: 'boolean', description: 'Is the building or area culturally protected (k-märkt)?' },
      huvudbyggnad_type: { type: 'string', description: 'Type of main building on the property, must be "en-/tvåbostadshus" for komplement/tillbyggnad to be allowed' },
      detaljplan_violated: { type: 'boolean', description: 'Does the planned building violate any detaljplan bestämmelse?' },
      utokad_lovplikt: { type: 'boolean', description: 'Does the detaljplan explicitly require bygglov for this type of building?' },
    },
    required: ['flow_type', 'inom_detaljplan', 'planned_area_m2', 'planned_nockhoejd_m', 'planned_distance_to_grans_m'],
  },
}

function mcpResp(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return Response.json(body, { status, headers: { ...CORS, ...extra } })
}

const SESSION_ID = 'ifc-stateless-1'

export async function GET() {
  return mcpResp({ name: 'ifc-building-generator', version: '1.0.0', transport: 'streamable-http' })
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
        serverInfo: { name: 'ifc-building-generator', version: '1.0.0' },
      },
    }, 200, { 'Mcp-Session-Id': SESSION_ID })
  }

  if (method === 'tools/list') {
    return mcpResp({ jsonrpc: '2.0', id, result: { tools: [TOOL_DEF, TRIAGE_TOOL_DEF] } })
  }

  if (method === 'tools/call') {
    const { name, arguments: args = {} } = params as {
      name?: string
      arguments?: Record<string, unknown>
    }

    if (name === 'assess_permit_requirement') {
      try {
        const result = assessPermitRequirement(args as unknown as TriageInput)
        const text = JSON.stringify(result, null, 2)
        return mcpResp({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }] } })
      } catch (err) {
        return mcpResp({ jsonrpc: '2.0', id, error: { code: -32603, message: err instanceof Error ? err.message : 'Internal error' } })
      }
    }

    if (name !== 'generate_building_link') {
      return mcpResp({ jsonrpc: '2.0', id, error: { code: -32602, message: 'Unknown tool' } })
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

      return mcpResp({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: url }] } })
    } catch (err) {
      return mcpResp({
        jsonrpc: '2.0',
        id,
        error: { code: -32603, message: err instanceof Error ? err.message : 'Internal error' },
      })
    }
  }

  return mcpResp({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } })
}
