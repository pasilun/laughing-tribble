import { BuildingModelV2, WallLoop, Opening, Room, Partition } from '@/types/building-v2'

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
    offsetFromStart?: number  // default: centered on wall
    sillHeight?: number       // default 0 for door, 0.9 for window
  }>
  slabThickness?: number  // default 0.2
  partitions?: Array<{
    direction: 'ew' | 'ns'  // east-west (runs along X axis) or north-south (runs along Y axis)
    offset: number           // metres from south wall (ew) or west wall (ns)
    thickness?: number       // default 0.1
    height?: number          // default: same as wallHeight
  }>
}

function validateOpenings(params: BuildingParams, length: number, width: number) {
  const wallLength: Record<string, number> = { south: length, north: length, east: width, west: width }
  const { openings = [], partitions = [], wallThickness = 0.12 } = params
  const minClearance = 0.1  // metres minimum gap between opening edge and partition

  for (const op of openings) {
    const wl = wallLength[op.wall]
    const opWidth = op.width ?? (op.type === 'door' ? 0.9 : 1.2)
    const opStart = op.offsetFromStart ?? (wl - opWidth) / 2
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
  const openings: Opening[] = (p.openings ?? []).map((o) => {
    const isDoor = o.type === 'door'
    const defaultWidth = isDoor ? 0.9 : 0.8
    const defaultHeight = isDoor ? 2.1 : 1.2
    const defaultSillHeight = isDoor ? 0 : 0.9

    const openingWidth = o.width ?? defaultWidth
    const wallLen = wallLengths[o.wall]
    const offsetFromStart = o.offsetFromStart ?? (wallLen - openingWidth) / 2

    return {
      id: `${o.type}-${o.wall}`,
      wallId: `wall-${o.wall}`,
      type: o.type,
      width: openingWidth,
      height: o.height ?? defaultHeight,
      offsetFromStart,
      sillHeight: o.sillHeight ?? defaultSillHeight,
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
      rooms.push({
        id: `room-${roomIndex}`,
        name: totalRooms === 1 ? 'Rum' : `Rum ${roomIndex}`,
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
  }
}
