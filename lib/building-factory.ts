import { BuildingModelV2, WallLoop, Opening, Room, Partition, Fixture } from '@/types/building-v2'

export interface BuildingParams {
  name?: string
  flowType?: BuildingModelV2['flowType']
  length: number        // east-west (X axis)
  width: number         // north-south (Y axis)
  wallHeight?: number   // default 2.4
  wallThickness?: number // default 0.12
  roof: {
    type: 'sadel' | 'pulpet' | 'flat'
    pitch?: number    // degrees, default 22
    overhang?: number // metres, default 0.3
    ridgeDirection?: 'ew' | 'ns'
  }
  openings?: Array<{
    wall: 'south' | 'north' | 'east' | 'west'
    type: 'door' | 'window'
    width?: number            // door default 0.9, window default 0.8
    height?: number           // door default 2.1, window default 1.2
    offsetFromStart?: number  // For south/north: metres from WEST end. For east/west: metres from SOUTH end. Default: centered.
    sillHeight?: number       // default 0 for door, 0.9 for window
    hinge?: 'start' | 'end'       // default 'start'
    openDirection?: 'in' | 'out'  // 'in'=ccw (default), 'out'=cw
    annotation?: string       // if set, adds a numbered marker at this opening in the floor plan
  }>
  slabThickness?: number  // default 0.2
  rooms?: Array<{ name: string }>  // names in room-generation order: column-major (west→east), row-major within each column (south→north)
  annotations?: Array<{ text: string; x: number; y: number }>
  fixtures?: Array<{
    type: Fixture['type']
    x: number
    y: number
    width: number
    depth: number
    height?: number
    rotation?: number
    label?: string
    annotation?: string  // if set, adds a numbered marker at this fixture in the floor plan
  }>
  partitions?: Array<{
    direction: 'ew' | 'ns'  // east-west (runs along X axis) or north-south (runs along Y axis)
    offset: number           // metres from south wall (ew) or west wall (ns)
    thickness?: number       // default 0.1
    height?: number          // default: same as wallHeight
    openings?: Array<{
      type: 'door' | 'window'
      offsetFromStart: number  // metres from start of partition (west end for NS, south end for EW)
      width?: number           // default 0.9 for door, 0.8 for window
      height?: number          // default 2.1 for door, 1.2 for window
      sillHeight?: number      // default 0 for door, 0.9 for window
      hinge?: 'start' | 'end' // default 'start'
      swing?: 'ccw' | 'cw'    // default 'ccw'
      annotation?: string      // if set, adds a numbered marker at this opening in the floor plan
    }>
  }>
}

type OpeningParam = NonNullable<BuildingParams['openings']>[0]

function universalToWallStart(o: OpeningParam, wl: number, opWidth: number): number {
  if (o.offsetFromStart === undefined) return (wl - opWidth) / 2
  if (o.wall === 'north' || o.wall === 'west') return wl - o.offsetFromStart - opWidth
  return o.offsetFromStart
}

function validateOpenings(params: BuildingParams, length: number, width: number) {
  const wallLength: Record<string, number> = { south: length, north: length, east: width, west: width }
  const { openings = [], partitions = [], wallThickness = 0.12 } = params
  const minClearance = 0.1  // metres minimum gap between opening edge and partition

  for (const op of openings) {
    const wl = wallLength[op.wall]
    const opWidth = op.width ?? (op.type === 'door' ? 0.9 : 0.8)
    const opStart = op.offsetFromStart ?? (wl - opWidth) / 2  // universal: from west (EW walls) or from south (NS walls)
    const opEnd = opStart + opWidth

    // Check opening doesn't go off the wall
    if (opStart < wallThickness || opEnd > wl - wallThickness) {
      throw new Error(
        `Öppning på ${op.wall}-väggen (${op.type}) går utanför väggen. ` +
        `Offset ${opStart.toFixed(2)}–${opEnd.toFixed(2)}m, vägg är ${wl}m lång (netto ${(wl - wallThickness * 2).toFixed(2)}m).`
      )
    }

    // Check opening doesn't overlap a partition wall junction
    for (const part of partitions) {
      let junctionPos: number | null = null

      if (op.wall === 'south' || op.wall === 'north') {
        // NS partition meets south/north wall at x = part.offset
        if (part.direction === 'ns') junctionPos = part.offset
      } else {
        // EW partition meets east/west wall at y = part.offset
        if (part.direction === 'ew') junctionPos = part.offset
      }

      if (junctionPos !== null) {
        const partThickness = part.thickness ?? 0.1
        const partStart = junctionPos - partThickness / 2
        const partEnd = junctionPos + partThickness / 2
        // Opening must be at least minClearance away from partition wall zone
        const overlap = opStart < partEnd + minClearance && opEnd > partStart - minClearance
        if (overlap) {
          throw new Error(
            `Öppning på ${op.wall}-väggen (${op.type}) kolliderar med en innervägg vid position ${junctionPos}m. ` +
            `Flytta öppningen minst ${minClearance * 100}cm från innerväggen.`
          )
        }
      }
    }
  }
}

export function buildingFromParams(p: BuildingParams): BuildingModelV2 {
  const wallHeight = p.wallHeight ?? 2.4
  const wallThickness = p.wallThickness ?? 0.12
  const slabThickness = p.slabThickness ?? 0.2

  // Validate openings before building the model
  validateOpenings(p, p.length, p.width)

  const ridgeDirection = p.roof.ridgeDirection ?? (p.length >= p.width ? 'ew' : 'ns')

  // CCW rectangle: SW → SE → NE → NW
  const wallLoop: WallLoop = {
    vertices: [
      { x: 0, y: 0 },           // SW
      { x: p.length, y: 0 },    // SE
      { x: p.length, y: p.width }, // NE
      { x: 0, y: p.width },     // NW
    ],
    edges: [
      { id: 'wall-south', thickness: wallThickness, height: wallHeight }, // SW→SE
      { id: 'wall-east',  thickness: wallThickness, height: wallHeight }, // SE→NE
      { id: 'wall-north', thickness: wallThickness, height: wallHeight }, // NE→NW
      { id: 'wall-west',  thickness: wallThickness, height: wallHeight }, // NW→SW
    ],
  }

  // Wall lengths by side
  const wallLengths: Record<string, number> = {
    south: p.length,
    north: p.length,
    east: p.width,
    west: p.width,
  }

  // Build openings
  const openings: Opening[] = (p.openings ?? []).map((o, idx) => {
    const isDoor = o.type === 'door'
    const defaultWidth = isDoor ? 0.9 : 0.8
    const defaultHeight = isDoor ? 2.1 : 1.2
    const defaultSillHeight = isDoor ? 0 : 0.9

    const openingWidth = o.width ?? defaultWidth
    const wallLen = wallLengths[o.wall]

    // Universal offset (from west for EW walls, from south for NS walls).
    // Convert to wall-specific offsetFromStart (which follows wall direction).
    let offsetFromStart: number
    if (o.offsetFromStart === undefined) {
      offsetFromStart = (wallLen - openingWidth) / 2  // centered
    } else if (o.wall === 'north') {
      // north wall runs NE→NW, so offsetFromStart=0 is at east end
      // universal offset is from west, so convert:
      offsetFromStart = wallLen - o.offsetFromStart - openingWidth
    } else if (o.wall === 'west') {
      // west wall runs NW→SW, so offsetFromStart=0 is at north end
      // universal offset is from south, so convert:
      offsetFromStart = wallLen - o.offsetFromStart - openingWidth
    } else {
      // south: SW→SE (from west) ✓
      // east:  SE→NE (from south) ✓
      offsetFromStart = o.offsetFromStart
    }

    return {
      id: `${o.type}-${o.wall}-${idx}`,
      wallId: `wall-${o.wall}`,
      type: o.type,
      width: openingWidth,
      height: o.height ?? defaultHeight,
      offsetFromStart,
      sillHeight: o.sillHeight ?? defaultSillHeight,
      hinge: o.hinge,
      swing: o.openDirection === 'out' ? 'cw' : o.openDirection === 'in' ? 'ccw' : undefined,
    }
  })

  // Rooms: split building into grid using partition offsets
  const t = wallThickness
  const nsOffsets = (p.partitions ?? [])
    .filter((part) => part.direction === 'ns')
    .map((part) => part.offset)
    .sort((a, b) => a - b)
  const ewOffsets = (p.partitions ?? [])
    .filter((part) => part.direction === 'ew')
    .map((part) => part.offset)
    .sort((a, b) => a - b)

  const xBreaks = [t, ...nsOffsets, p.length - t]
  const yBreaks = [t, ...ewOffsets, p.width - t]

  const totalRooms = (xBreaks.length - 1) * (yBreaks.length - 1)
  const rooms: Room[] = []
  let roomIndex = 1

  for (let i = 0; i < xBreaks.length - 1; i++) {
    for (let j = 0; j < yBreaks.length - 1; j++) {
      const x0 = xBreaks[i]
      const x1 = xBreaks[i + 1]
      const y0 = yBreaks[j]
      const y1 = yBreaks[j + 1]
      const roomName = p.rooms
        ? (p.rooms[roomIndex - 1]?.name ?? (totalRooms === 1 ? 'Rum' : `Rum ${roomIndex}`))
        : (totalRooms === 1 ? 'Rum' : `Rum ${roomIndex}`)
      rooms.push({
        id: `room-${roomIndex}`,
        name: roomName,
        polygon: [
          { x: x0, y: y0 },
          { x: x1, y: y0 },
          { x: x1, y: y1 },
          { x: x0, y: y1 },
          { x: x0, y: y0 }, // closed
        ],
      })
      roomIndex++
    }
  }

  const partitions: Partition[] = (p.partitions ?? []).map((part, index) => {
    if (part.direction === 'ew') {
      return {
        id: `partition-${index}`,
        start: { x: 0, y: part.offset },
        end: { x: p.length, y: part.offset },
        thickness: part.thickness ?? 0.1,
        height: part.height,
      }
    } else {
      return {
        id: `partition-${index}`,
        start: { x: part.offset, y: 0 },
        end: { x: part.offset, y: p.width },
        thickness: part.thickness ?? 0.1,
        height: part.height,
      }
    }
  })

  // Build partition openings and append to the openings array
  for (let index = 0; index < (p.partitions ?? []).length; index++) {
    const part = (p.partitions ?? [])[index]
    const partId = `partition-${index}`
    for (let opIdx = 0; opIdx < (part.openings ?? []).length; opIdx++) {
      const o = (part.openings ?? [])[opIdx]
      const isDoor = o.type === 'door'
      const defaultWidth = isDoor ? 0.9 : 0.8
      const defaultHeight = isDoor ? 2.1 : 1.2
      const defaultSillHeight = isDoor ? 0 : 0.9
      openings.push({
        id: `${partId}-op-${opIdx}`,
        partitionId: partId,
        type: o.type,
        width: o.width ?? defaultWidth,
        height: o.height ?? defaultHeight,
        offsetFromStart: o.offsetFromStart,
        sillHeight: o.sillHeight ?? defaultSillHeight,
        hinge: o.hinge,
        swing: o.swing,
      })
    }
  }

  const fixtures: Fixture[] = (p.fixtures ?? []).map((f, idx) => ({
    id: `fixture-${idx}`,
    type: f.type,
    x: f.x,
    y: f.y,
    width: f.width,
    depth: f.depth,
    height: f.height,
    rotation: f.rotation,
    label: f.label,
  }))

  // ── Resolve annotation positions ────────────────────────────────────────────
  // Compute center of an opening in model (world) coordinates
  function openingCenterXY(op: Opening): { x: number; y: number } {
    if (op.wallId) {
      const edgeIdx = wallLoop.edges.findIndex((e) => e.id === op.wallId)
      if (edgeIdx < 0) return { x: 0, y: 0 }
      const vs = wallLoop.vertices
      const s = vs[edgeIdx]
      const e = vs[(edgeIdx + 1) % vs.length]
      const len = Math.sqrt((e.x - s.x) ** 2 + (e.y - s.y) ** 2)
      const t = (op.offsetFromStart + op.width / 2) / len
      return { x: s.x + t * (e.x - s.x), y: s.y + t * (e.y - s.y) }
    }
    if (op.partitionId) {
      const part = partitions.find((p) => p.id === op.partitionId)
      if (!part) return { x: 0, y: 0 }
      const dx = part.end.x - part.start.x
      const dy = part.end.y - part.start.y
      const len = Math.sqrt(dx * dx + dy * dy)
      const t = (op.offsetFromStart + op.width / 2) / len
      return { x: part.start.x + t * dx, y: part.start.y + t * dy }
    }
    return { x: 0, y: 0 }
  }

  // Collect auto-annotations from opening.annotation and fixture.annotation fields
  const autoAnnotations: Array<{ text: string; x: number; y: number }> = []

  ;(p.openings ?? []).forEach((o, idx) => {
    if (!o.annotation) return
    const openingId = `${o.type}-${o.wall}-${idx}`
    const op = openings.find((op) => op.id === openingId)
    if (op) autoAnnotations.push({ text: o.annotation, ...openingCenterXY(op) })
  })

  for (let pi = 0; pi < (p.partitions ?? []).length; pi++) {
    const part = (p.partitions ?? [])[pi]
    ;(part.openings ?? []).forEach((o, opIdx) => {
      if (!o.annotation) return
      const openingId = `partition-${pi}-op-${opIdx}`
      const op = openings.find((op) => op.id === openingId)
      if (op) autoAnnotations.push({ text: o.annotation, ...openingCenterXY(op) })
    })
  }

  ;(p.fixtures ?? []).forEach((f, idx) => {
    if (!f.annotation) return
    autoAnnotations.push({ text: f.annotation, x: f.x + f.width / 2, y: f.y + f.depth / 2 })
  })

  const allAnnotations = [
    ...(p.annotations ?? []),
    ...autoAnnotations,
  ]

  return {
    id: `building-${Date.now()}`,
    name: p.name ?? 'Byggnad',
    flowType: p.flowType,
    walls: [wallLoop],
    openings,
    rooms,
    roof: {
      type: p.roof.type,
      pitch: p.roof.pitch ?? 22,
      overhang: p.roof.overhang ?? 0.3,
      ridgeDirection,
    },
    slabThickness,
    partitions,
    fixtures: fixtures.length > 0 ? fixtures : undefined,
    annotations: allAnnotations.length > 0 ? allAnnotations : undefined,
  }
}
