import { deflateRawSync } from 'zlib'
import { list, put } from '@vercel/blob'
import { buildingFromParams } from '@/lib/building-factory'
import { assessPermitRequirement } from '@/lib/triage-engine'
import type { TriageInput } from '@/lib/triage-engine'
import type { BuildingModelV2 } from '@/types/building-v2'
import { generateFloorPlanSVG } from '@/lib/floor-plan-svg'
import { Resvg } from '@resvg/resvg-js'
import { validateBuilding } from '@/lib/validate-building'

function summariseModel(model: BuildingModelV2): string {
  const length = (model.walls[0]?.vertices[1]?.x ?? 0) - (model.walls[0]?.vertices[0]?.x ?? 0)
  const width = (model.walls[0]?.vertices[2]?.y ?? 0) - (model.walls[0]?.vertices[1]?.y ?? 0)
  const wallH = model.walls[0]?.edges[0]?.height ?? 2.4
  const wt = model.walls[0]?.edges[0]?.thickness ?? 0.12

  const wallLengths: Record<string, number> = {
    'wall-south': length, 'wall-north': length,
    'wall-east': width,   'wall-west': width,
  }
  const wallNames: Record<string, string> = {
    'wall-south': 'Sydvägg', 'wall-north': 'Nordvägg',
    'wall-east': 'Östvägg',  'wall-west': 'Västvägg',
  }

  const lines: string[] = []
  lines.push(`Byggnad: ${length.toFixed(2)} × ${width.toFixed(2)} m, väggshöjd ${wallH.toFixed(2)} m, väggtjocklek ${wt.toFixed(2)} m`)

  // Rooms
  for (const room of model.rooms) {
    const pts = room.polygon.filter((_, i, arr) =>
      !(i === arr.length - 1 && arr[i].x === arr[0].x && arr[i].y === arr[0].y))
    const xs = pts.map(p => p.x), ys = pts.map(p => p.y)
    const rw = Math.max(...xs) - Math.min(...xs)
    const rd = Math.max(...ys) - Math.min(...ys)
    const area = Math.abs(pts.reduce((s, p, i) => {
      const j = (i + 1) % pts.length
      return s + p.x * pts[j].y - pts[j].x * p.y
    }, 0) / 2)
    lines.push(`  ${room.name}: ${rw.toFixed(2)} × ${rd.toFixed(2)} m = ${area.toFixed(1)} m²`)
  }

  // Openings
  if (model.openings.length > 0) {
    lines.push('Öppningar:')
    for (const op of model.openings) {
      const typeLabel = op.type === 'door' ? 'Dörr' : 'Fönster'
      if (op.partitionId) {
        lines.push(`  ${typeLabel} (Innervägg ${op.partitionId}): offset ${op.offsetFromStart.toFixed(2)} m, bredd ${op.width.toFixed(2)} m`)
      } else {
        const wl = wallLengths[op.wallId ?? ''] ?? 0
        const wName = wallNames[op.wallId ?? ''] ?? (op.wallId ?? '')
        // Convert wall-specific offsetFromStart to universal coordinates
        // (always from west for EW walls, from south for NS walls)
        let uStart: number
        if (op.wallId === 'wall-north') {
          uStart = wl - op.offsetFromStart - op.width
        } else if (op.wallId === 'wall-west') {
          uStart = wl - op.offsetFromStart - op.width
        } else {
          uStart = op.offsetFromStart
        }
        const uEnd = uStart + op.width
        const fromOtherEnd = wl - uEnd
        lines.push(`  ${typeLabel} (${wName}): ${uStart.toFixed(2)}–${uEnd.toFixed(2)} m från väst/syd, ${fromOtherEnd.toFixed(2)} m till andra änden`)
      }
    }
  }

  // Partitions
  if ((model.partitions ?? []).length > 0) {
    lines.push('Innerväggar:')
    for (const part of model.partitions ?? []) {
      const isNS = Math.abs(part.end.x - part.start.x) < 0.01  // runs north-south
      const isEW = Math.abs(part.end.y - part.start.y) < 0.01  // runs east-west
      if (isNS) {
        lines.push(`  NS-vägg vid x=${part.start.x.toFixed(2)} m från väst (tjocklek ${(part.thickness ?? 0.1).toFixed(2)} m)`)
      } else if (isEW) {
        lines.push(`  ÖV-vägg vid y=${part.start.y.toFixed(2)} m från syd (tjocklek ${(part.thickness ?? 0.1).toFixed(2)} m)`)
      }
    }
  }

  // Roof
  const rd = model.roof.ridgeDirection ?? 'ew'
  const rdLabel = rd === 'ew' ? 'ö-v' : 'n-s'
  lines.push(`Tak: ${model.roof.type}, lutning ${model.roof.pitch}°, överhäng ${model.roof.overhang} m, nock ${rdLabel}`)

  return lines.join('\n')
}

function asciiFloorPlan(model: BuildingModelV2): string {
  const length = model.walls[0]?.vertices[1]?.x ?? 0   // east-west
  const width  = model.walls[0]?.vertices[2]?.y ?? 0   // north-south
  if (length <= 0 || width <= 0) return ''

  // Scale: target ~50 chars wide; chars are roughly 2:1 (h:w) so sy ≈ sx/2
  const sx = Math.max(2, Math.round(50 / length))
  const sy = Math.max(1, Math.round(sx / 2))

  // Grid: west wall at col 0, east wall at col gw-1
  //       north wall at row 0, south wall at row gh-1
  const gw = 1 + Math.round(length * sx)
  const gh = 1 + Math.round(width  * sy)

  const grid: string[][] = Array.from({ length: gh }, () => Array(gw).fill(' '))

  // Coordinate helpers (building coords → grid indices)
  const gc = (x: number) => Math.round((x / length) * (gw - 1))
  const gr = (y: number) => Math.round((1 - y / width) * (gh - 1))  // y=0 → bottom row, y=width → row 0

  // ── Exterior walls ──────────────────────────────────────────────────────
  for (let c = 0; c < gw; c++) { grid[0][c] = '-'; grid[gh-1][c] = '-' }
  for (let r = 0; r < gh; r++) { grid[r][0] = '|'; grid[r][gw-1] = '|' }
  grid[0][0] = grid[0][gw-1] = grid[gh-1][0] = grid[gh-1][gw-1] = '+'

  // ── Partition walls ─────────────────────────────────────────────────────
  for (const part of model.partitions ?? []) {
    const isNS = Math.abs(part.end.x - part.start.x) < 0.01  // constant X → vertical line
    if (isNS) {
      const c = gc(part.start.x)
      grid[0][c]    = '+'
      grid[gh-1][c] = '+'
      for (let r = 1; r < gh - 1; r++) grid[r][c] = '|'
    } else {
      const r = gr(part.start.y)
      grid[r][0]    = '+'
      grid[r][gw-1] = '+'
      for (let c = 1; c < gw - 1; c++) grid[r][c] = '-'
    }
  }

  // ── Openings (doors & windows) ──────────────────────────────────────────
  // Wall directions (from building-factory.ts wall loop: SW→SE→NE→NW):
  //   wall-south: SW→SE, offsetFromStart from x=0 (west), row = gh-1
  //   wall-east:  SE→NE, offsetFromStart from y=0 (south), col = gw-1
  //   wall-north: NE→NW, offsetFromStart from x=length (east), row = 0
  //   wall-west:  NW→SW, offsetFromStart from y=width (north), col = 0
  for (const op of model.openings) {
    const mark = op.type === 'door' ? 'D' : 'W'
    if (op.wallId === 'wall-south') {
      const c1 = gc(op.offsetFromStart), c2 = gc(op.offsetFromStart + op.width)
      for (let c = c1; c <= c2; c++) grid[gh-1][c] = mark
    } else if (op.wallId === 'wall-north') {
      const xEnd = length - op.offsetFromStart
      const c1 = gc(xEnd - op.width), c2 = gc(xEnd)
      for (let c = c1; c <= c2; c++) grid[0][c] = mark
    } else if (op.wallId === 'wall-east') {
      const r1 = gr(op.offsetFromStart + op.width), r2 = gr(op.offsetFromStart)
      for (let r = r1; r <= r2; r++) grid[r][gw-1] = mark
    } else if (op.wallId === 'wall-west') {
      const yTop = width - op.offsetFromStart
      const r1 = gr(yTop), r2 = gr(yTop - op.width)
      for (let r = r1; r <= r2; r++) grid[r][0] = mark
    } else if (op.partitionId) {
      // Find the partition and render opening mark along its line
      const part = (model.partitions ?? []).find(p => p.id === op.partitionId)
      if (part) {
        const isNS = Math.abs(part.end.x - part.start.x) < 0.01
        if (isNS) {
          const c = gc(part.start.x)
          const r1 = gr(op.offsetFromStart + op.width), r2 = gr(op.offsetFromStart)
          for (let r = r1; r <= r2; r++) if (r > 0 && r < gh - 1) grid[r][c] = mark
        } else {
          const r = gr(part.start.y)
          const c1 = gc(op.offsetFromStart), c2 = gc(op.offsetFromStart + op.width)
          for (let c = c1; c <= c2; c++) if (c > 0 && c < gw - 1) grid[r][c] = mark
        }
      }
    }
  }

  // ── Room labels ─────────────────────────────────────────────────────────
  for (const room of model.rooms) {
    const pts = room.polygon.filter((_, i, arr) =>
      !(i === arr.length - 1 && arr[i].x === arr[0].x && arr[i].y === arr[0].y))
    if (pts.length === 0) continue
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length
    const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length
    const r = gr(cy), startC = Math.max(1, gc(cx) - Math.floor(room.name.length / 2))
    const structural = new Set(['+', '-', '|'])
    for (let i = 0; i < room.name.length; i++) {
      const c = startC + i
      if (c > 0 && c < gw - 1 && !structural.has(grid[r][c])) grid[r][c] = room.name[i]
    }
  }

  // ── Assemble with compass ───────────────────────────────────────────────
  const rows = grid.map(row => row.join(''))
  return ['N', '^', ...rows, ' '.repeat(Math.max(0, gw - 4)) + '→ E'].join('\n')
}

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
          ridgeDirection: {
            type: 'string',
            enum: ['ew', 'ns'],
            description: 'Ridge direction: ew = ridge runs east-west (default for wider-than-tall buildings), ns = ridge runs north-south',
          },
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
              description: 'For south/north walls: metres from WEST end. For east/west walls: metres from SOUTH end. Default: centered. Always measured from the building SW corner.',
            },
            sillHeight: {
              type: 'number',
              description: 'Metres from floor; default 0 for door, 0.9 for window',
            },
            hinge: {
              type: 'string',
              enum: ['start', 'end'],
              description: "Which end of the opening has the hinge. 'start' = closer to west (EW walls) or south (NS walls). Default: 'start'",
            },
            openDirection: {
              type: 'string',
              enum: ['in', 'out'],
              description: 'Whether the door opens inward (into the building, default) or outward',
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
            openings: {
              type: 'array',
              description: 'Doors or windows in this partition wall',
              items: {
                type: 'object',
                properties: {
                  type: { type: 'string', enum: ['door', 'window'] },
                  offsetFromStart: { type: 'number', description: 'Metres from start of partition (west end for NS partitions, south end for EW partitions)' },
                  width: { type: 'number', description: 'Opening width in metres, default 0.9 for door, 0.8 for window' },
                  height: { type: 'number', description: 'Opening height in metres, default 2.1 for door, 1.2 for window' },
                  sillHeight: { type: 'number', description: 'Metres from floor, default 0 for door, 0.9 for window' },
                  hinge: {
                    type: 'string',
                    enum: ['start', 'end'],
                    description: "Which end of the opening has the hinge. Default: 'start'",
                  },
                  swing: {
                    type: 'string',
                    enum: ['ccw', 'cw'],
                    description: 'Swing direction viewed from above. Default: \'ccw\'',
                  },
                },
                required: ['type', 'offsetFromStart'],
              },
            },
          },
          required: ['direction', 'offset'],
        },
      },
      fixtures: {
        type: 'array',
        description: 'Furniture and equipment placed inside rooms, positioned from SW corner in metres',
        items: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['sauna_heater', 'bench', 'stove', 'toilet', 'sink', 'custom'] },
            x: { type: 'number', description: 'Metres from west wall inner face' },
            y: { type: 'number', description: 'Metres from south wall inner face' },
            width: { type: 'number', description: 'East-west size in metres' },
            depth: { type: 'number', description: 'North-south size in metres' },
            height: { type: 'number' },
            rotation: { type: 'number', description: 'Degrees CW from north' },
            label: { type: 'string' },
          },
          required: ['type', 'x', 'y', 'width', 'depth'],
        },
      },
      rooms: {
        type: 'array',
        description: 'Room names in column-major order (west→east columns, south→north within each column). Match count to number of rooms created by partitions.',
        items: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
      },
      annotations: {
        type: 'array',
        description: 'Free-text notes placed at specific positions in the floor plan',
        items: {
          type: 'object',
          properties: {
            text: { type: 'string' },
            x: { type: 'number', description: 'Metres from west wall' },
            y: { type: 'number', description: 'Metres from south wall' },
          },
          required: ['text', 'x', 'y'],
        },
      },
    },
    required: ['length', 'width', 'roof'],
  },
}

const UPDATE_TOOL_DEF = {
  name: 'update_building',
  description:
    'Update an existing saved building model in-place. Takes the same parameters as generate_building_link plus the model_id to overwrite. The viewer URL stays the same — no new link is needed.',
  inputSchema: {
    ...(() => {
      // Reuse TOOL_DEF's inputSchema but add model_id as required
      const base = TOOL_DEF.inputSchema as { type: string; properties: Record<string, unknown>; required: string[] }
      return {
        type: 'object',
        properties: {
          model_id: { type: 'string', description: 'The ID of the building model to update (from a previous generate_building_link call)' },
          ...base.properties,
        },
        required: ['model_id', ...base.required],
      }
    })(),
  },
}

const PREVIEW_TOOL_DEF = {
  name: 'preview_building',
  description:
    'Returns a 2D floor plan SVG image of a saved building model so it can be reviewed visually.',
  inputSchema: {
    type: 'object',
    properties: {
      model_id: { type: 'string', description: 'The building model ID (from create_building)' },
    },
    required: ['model_id'],
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
    return mcpResp({ jsonrpc: '2.0', id, result: { tools: [TOOL_DEF, UPDATE_TOOL_DEF, TRIAGE_TOOL_DEF, PREVIEW_TOOL_DEF] } })
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

    if (name === 'preview_building') {
      try {
        const modelId = (args as { model_id?: string }).model_id
        if (!modelId) {
          return mcpResp({ jsonrpc: '2.0', id, error: { code: -32602, message: 'model_id is required' } })
        }

        const blobToken = process.env.public_READ_WRITE_TOKEN ?? process.env.BLOB_READ_WRITE_TOKEN
        const { blobs } = await list({ prefix: `buildings/${modelId}`, token: blobToken })
        const blob = blobs.find((b) => b.pathname === `buildings/${modelId}.json`)

        if (!blob) {
          return mcpResp({ jsonrpc: '2.0', id, error: { code: -32602, message: `Model not found: ${modelId}` } })
        }

        const res = await fetch(blob.url)
        const model = (await res.json()) as BuildingModelV2

        const svgString = generateFloorPlanSVG(model)
        const png = new Resvg(svgString, { fitTo: { mode: 'width', value: 1200 } }).render().asPng()
        const base64 = png.toString('base64')

        return mcpResp({
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'image', data: base64, mimeType: 'image/png' }],
          },
        })
      } catch (err) {
        return mcpResp({
          jsonrpc: '2.0',
          id,
          error: { code: -32603, message: err instanceof Error ? err.message : 'Internal error' },
        })
      }
    }

    if (name !== 'generate_building_link') {
      return mcpResp({ jsonrpc: '2.0', id, error: { code: -32602, message: 'Unknown tool' } })
    }

    try {
      const model = buildingFromParams(args as unknown as Parameters<typeof buildingFromParams>[0])
      const json = JSON.stringify(model)

      // VERCEL_PROJECT_PRODUCTION_URL is the stable alias; VERCEL_URL is deployment-specific
      const host = process.env.VERCEL_PROJECT_PRODUCTION_URL
        ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
        : process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'http://localhost:3000'

      let url: string
      const blobToken = process.env.public_READ_WRITE_TOKEN ?? process.env.BLOB_READ_WRITE_TOKEN
      if (blobToken) {
        // Store model in Vercel Blob and return a clean /view?id=<id> URL
        const id = model.id
        await put(`buildings/${id}.json`, json, {
          access: 'public',
          contentType: 'application/json',
          addRandomSuffix: false,
          token: blobToken,
        })
        url = `${host}/view?id=${id}`
      } else {
        // Fallback: encode model as deflate-raw+base64url hash in URL (local dev)
        const compressed = deflateRawSync(Buffer.from(json, 'utf-8'))
        const encoded = compressed
          .toString('base64')
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=/g, '')
        url = `${host}/view#${encoded}`
      }

      const argsJson = JSON.stringify(args, null, 2)
      const summary = summariseModel(model)
      const plan = asciiFloorPlan(model)
      const buildWarnings = validateBuilding(model)
      const warningBlock = buildWarnings.length > 0
        ? `\n⚠️ Valideringsvarningar:\n${buildWarnings.map(w => `- ${w}`).join('\n')}\n`
        : ''
      const text = `${url}${warningBlock}

⚠️ VIKTIGT: Återanvänd eller modifiera aldrig denna URL. Kalla alltid generate_building_link igen med uppdaterade parametrar om du behöver göra ändringar.

Modellsammanfattning (faktiska mått i den genererade modellen):
${summary}

Parametrar som användes:
${argsJson}`

      const svgPreview = generateFloorPlanSVG(model)
      const pngPreview = new Resvg(svgPreview, { fitTo: { mode: 'width', value: 1200 } }).render().asPng()
      const pngBase64 = pngPreview.toString('base64')

      return mcpResp({ jsonrpc: '2.0', id, result: { content: [
        { type: 'text', text },
        { type: 'image', data: pngBase64, mimeType: 'image/png' },
      ] } })
    } catch (err) {
      return mcpResp({
        jsonrpc: '2.0',
        id,
        error: { code: -32603, message: err instanceof Error ? err.message : 'Internal error' },
      })
    }

    if (name === 'update_building') {
      try {
        const { model_id, ...buildingArgs } = args as { model_id: string } & Record<string, unknown>
        if (!model_id) throw new Error('model_id is required')

        const model = buildingFromParams(buildingArgs as unknown as Parameters<typeof buildingFromParams>[0])
        model.id = model_id

        const blobToken = process.env.public_READ_WRITE_TOKEN ?? process.env.BLOB_READ_WRITE_TOKEN
        if (!blobToken) throw new Error('No blob token — update_building requires Vercel Blob storage')

        const host = process.env.VERCEL_PROJECT_PRODUCTION_URL
          ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
          : process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : 'http://localhost:3000'

        await put(`buildings/${model_id}.json`, JSON.stringify(model), {
          access: 'public',
          contentType: 'application/json',
          addRandomSuffix: false,
          token: blobToken,
        })

        const url = `${host}/view?id=${model_id}`
        const summary = summariseModel(model)
        const updateWarnings = validateBuilding(model)
        const updateWarningBlock = updateWarnings.length > 0
          ? `\n⚠️ Valideringsvarningar:\n${updateWarnings.map(w => `- ${w}`).join('\n')}\n`
          : ''
        const text = `Uppdaterat: ${url}${updateWarningBlock}\n\nModellsammanfattning:\n${summary}`

        const svgPreview = generateFloorPlanSVG(model)
        const pngPreview = new Resvg(svgPreview, { fitTo: { mode: 'width', value: 1200 } }).render().asPng()

        return mcpResp({ jsonrpc: '2.0', id, result: { content: [
          { type: 'text', text },
          { type: 'image', data: pngPreview.toString('base64'), mimeType: 'image/png' },
        ] } })
      } catch (err) {
        return mcpResp({ jsonrpc: '2.0', id, error: { code: -32603, message: `${err}` } })
      }
    }
  }

  return mcpResp({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } })
}
