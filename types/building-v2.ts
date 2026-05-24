export type Vector2 = { x: number; y: number }
export type Vector3 = { x: number; y: number; z: number }

export type Wall = {
  id: string
  start: Vector2
  end: Vector2
  height: number      // metres
  thickness: number   // metres, default 0.12
}

export type Opening = {
  id: string
  wallId: string
  type: 'door' | 'window'
  width: number
  height: number
  offsetFromStart: number  // metres along wall from start point
  sillHeight?: number      // metres from floor, default 0 for doors, 0.9 for windows
}

export type Room = {
  id: string
  name: string
  polygon: Vector2[]   // floor outline, closed
}

export type Roof = {
  type: 'sadel' | 'pulpet' | 'flat'
  pitch: number        // degrees
  overhang: number     // metres
}

export type Site = {
  plotWidth: number
  plotLength: number
  buildingOffsetX: number
  buildingOffsetY: number
  northAngle?: number
}

export type BuildingModelV2 = {
  id: string
  name: string
  flowType?: 'friggebod' | 'attefallshus' | 'komplementbyggnad' | 'komplementbostadshus' | 'attefallstillbyggnad'
  walls: Wall[]
  openings: Opening[]
  rooms: Room[]
  roof: Roof
  slabThickness: number   // floor slab, default 0.2
  site?: Site
}
