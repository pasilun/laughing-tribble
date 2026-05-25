import { BuildingModelV2, WallLoop, Opening, Room } from '@/types/building-v2'

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
}

export function buildingFromParams(p: BuildingParams): BuildingModelV2 {
  const wallHeight = p.wallHeight ?? 2.4
  const wallThickness = p.wallThickness ?? 0.12
  const slabThickness = p.slabThickness ?? 0.2

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

  // Room: inset rectangle by wallThickness on all sides
  const t = wallThickness
  const room: Room = {
    id: 'room-main',
    name: 'Rum',
    polygon: [
      { x: t, y: t },
      { x: p.length - t, y: t },
      { x: p.length - t, y: p.width - t },
      { x: t, y: p.width - t },
      { x: t, y: t }, // closed
    ],
  }

  return {
    id: `building-${Date.now()}`,
    name: p.name ?? 'Byggnad',
    flowType: p.flowType,
    walls: [wallLoop],
    openings,
    rooms: [room],
    roof: {
      type: p.roof.type,
      pitch: p.roof.pitch ?? 22,
      overhang: p.roof.overhang ?? 0.3,
    },
    slabThickness,
  }
}
