import { BuildingModelV2 } from '@/types/building-v2'

/**
 * Hardcoded 4×3m friggebod fixture for IFC pipeline spike.
 * Coordinate system: X = east, Y = north, Z = up
 * Walls form a clockwise rectangle when viewed from above.
 */
export const friggebodFixture: BuildingModelV2 = {
  id: 'friggebod-spike-001',
  name: 'Friggebod 4×3m',
  flowType: 'friggebod',

  walls: [
    // South wall: (0,0) → (4,0)
    {
      id: 'wall-south',
      start: { x: 0, y: 0 },
      end: { x: 4, y: 0 },
      height: 2.4,
      thickness: 0.12,
    },
    // East wall: (4,0) → (4,3)
    {
      id: 'wall-east',
      start: { x: 4, y: 0 },
      end: { x: 4, y: 3 },
      height: 2.4,
      thickness: 0.12,
    },
    // North wall: (4,3) → (0,3)
    {
      id: 'wall-north',
      start: { x: 4, y: 3 },
      end: { x: 0, y: 3 },
      height: 2.4,
      thickness: 0.12,
    },
    // West wall: (0,3) → (0,0)
    {
      id: 'wall-west',
      start: { x: 0, y: 3 },
      end: { x: 0, y: 0 },
      height: 2.4,
      thickness: 0.12,
    },
  ],

  openings: [
    // Door: south wall, 0.9m wide, 2.1m high, centred at 4/2 - 0.9/2 = 1.55m from start
    {
      id: 'door-south',
      wallId: 'wall-south',
      type: 'door',
      width: 0.9,
      height: 2.1,
      offsetFromStart: 1.55, // centred on 4m wall
      sillHeight: 0,
    },
    // Window: east wall, 0.8m wide, 1.2m high, sill 0.9m, centred at 3/2 - 0.8/2 = 1.1m from start
    {
      id: 'window-east',
      wallId: 'wall-east',
      type: 'window',
      width: 0.8,
      height: 1.2,
      offsetFromStart: 1.1, // centred on 3m wall
      sillHeight: 0.9,
    },
  ],

  rooms: [
    {
      id: 'room-storage',
      name: 'Förvaringsutrymme',
      // Inner wall outline (inset by 0.12m thickness)
      polygon: [
        { x: 0.12, y: 0.12 },
        { x: 3.88, y: 0.12 },
        { x: 3.88, y: 2.88 },
        { x: 0.12, y: 2.88 },
        { x: 0.12, y: 0.12 }, // closed
      ],
    },
  ],

  roof: {
    type: 'sadel',
    pitch: 22,
    overhang: 0.3,
  },

  slabThickness: 0.2,

  site: {
    plotWidth: 20,
    plotLength: 15,
    buildingOffsetX: 8,
    buildingOffsetY: 6,
    northAngle: 0,
  },
}
