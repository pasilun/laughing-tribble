export type Vector2 = { x: number; y: number }
export type Vector3 = { x: number; y: number; z: number }

export type WallEdge = {
  id: string
  thickness: number
  height: number
}

export type WallLoop = {
  vertices: Vector2[]   // N vertices, CCW winding, implicitly closed (last→first)
  edges: WallEdge[]     // N edges — edge[i] goes vertex[i] → vertex[(i+1)%N]
}

export type Opening = {
  id: string
  wallId?: string          // set for exterior wall openings
  partitionId?: string     // set for partition wall openings
  type: 'door' | 'window'
  width: number
  height: number
  offsetFromStart: number  // metres along wall from start point
  sillHeight?: number      // metres from floor, default 0 for doors, 0.9 for windows
  hinge?: 'start' | 'end' // which end of the opening has the hinge, default 'start'
  swing?: 'ccw' | 'cw'    // swing direction viewed from above, default 'ccw'
}

export type Room = {
  id: string
  name: string
  polygon: Vector2[]   // floor outline, closed
}

export type Partition = {
  id: string
  start: Vector2   // metres from building origin
  end: Vector2
  thickness: number  // default 0.1
  height?: number    // default = same as exterior wall height
}

export type Roof = {
  type: 'sadel' | 'pulpet' | 'flat'
  pitch: number        // degrees
  overhang: number     // metres
  ridgeDirection?: 'ew' | 'ns'   // 'ew' = ridge runs east-west (pitches N-S), 'ns' = ridge runs north-south (pitches E-W)
}

export type Site = {
  plotWidth: number
  plotLength: number
  buildingOffsetX: number
  buildingOffsetY: number
  northAngle?: number
}

export type Fixture = {
  id: string
  type: 'sauna_heater' | 'bench' | 'stove' | 'toilet' | 'sink' | 'custom'
  x: number        // metres from SW corner (west wall inner face)
  y: number        // metres from SW corner (south wall inner face)
  width: number    // east-west extent in metres
  depth: number    // north-south extent in metres
  height?: number  // default: sauna_heater=0.6, bench=0.45, others=0.9
  rotation?: number // degrees CW from north, default 0
  label?: string   // override displayed text; default = type
  roomId?: string  // informational only
}

export type BuildingModelV2 = {
  id: string
  name: string
  flowType?: 'friggebod' | 'attefallshus' | 'komplementbyggnad' | 'komplementbostadshus' | 'attefallstillbyggnad'
  walls: WallLoop[]
  openings: Opening[]
  rooms: Room[]
  roof: Roof
  slabThickness: number   // floor slab, default 0.2
  site?: Site
  partitions?: Partition[]
  fixtures?: Fixture[]
  annotations?: Array<{ text: string; x: number; y: number }>
}
