// Floor plan model for interior permit drawings (planritning före/efter).
// All lengths are integer millimetres. Coordinates are plan coordinates with
// x to the right and y downwards (same as SVG and scanned drawings).

export type Pt = { x: number; y: number }

// existing = kept as is, demolish = exists today and is removed,
// new = does not exist today and is added.
export type Phase = 'existing' | 'demolish' | 'new'

export type Wall = {
  id: string
  a: Pt
  b: Pt
  thickness: number
  phase: Phase
  loadBearing?: boolean
  fireRating?: string        // e.g. "EI60" for a fire-cell boundary
  fireRatingAfter?: string   // boundary in "efter" if it changes; "" = no longer a boundary
  apartmentBoundary?: boolean
}

export type OpeningKind = 'door' | 'window' | 'opening'

export type Opening = {
  id: string
  wallId: string
  kind: OpeningKind
  offset: number             // distance along the wall from wall.a to the opening's near edge
  width: number
  height?: number
  phase: Phase
  hinge?: 'a' | 'b'          // door hinge at the end nearest wall.a or wall.b
  swing?: 'left' | 'right'   // side of the wall the leaf swings to, seen from a → b
}

export type FixtureKind =
  | 'kitchen'
  | 'stove'
  | 'sink'
  | 'radiator'
  | 'exhaust'
  | 'shaft'
  | 'wc'
  | 'shower'
  | 'bath'
  | 'plug'
  | 'box'

export type Fixture = {
  id: string
  kind: FixtureKind
  x: number                  // centre
  y: number
  w: number
  d: number
  rotation?: number          // degrees clockwise
  phase: Phase
  label?: string
}

export type Room = {
  id: string
  name: string
  renamed?: string           // name in "efter" when the room changes use
  at: Pt                     // label position
  apartment?: string
  polygon?: Pt[]             // optional outline, used for area
}

export type Dimension = {
  id: string
  a: Pt
  b: Pt
  offset: number             // perpendicular offset of the dimension line (positive = left of a → b)
}

export type Note = {
  id: string
  at: Pt
  text: string
  phase?: Phase
}

export type TitleBlock = {
  project: string            // e.g. "Väggöppning mellan lgh 153 och 154"
  property: string           // fastighetsbeteckning, e.g. "Stockholm Gnejsen 6"
  address: string
  apartments: string         // e.g. "Lgh 1102, 1103 (brf 153, 154)"
  floor: string              // e.g. "Plan 1 tr"
  drawingNumber: string
  author: string
  date: string               // ISO date
  revision: string           // "", "A", "B", ...
}

export type Sheet = {
  paper: 'A4' | 'A3'
  orientation: 'landscape' | 'portrait'
  scale: 50 | 100
  northAngle: number         // degrees clockwise from sheet up
  titleBlock: TitleBlock
}

export type Underlay = {
  src: string                // URL or data URL of the scanned drawing
  widthPx: number
  heightPx: number
  mmPerPx: number            // calibration
  x: number                  // plan position of the image's top-left corner
  y: number
  rotation: number           // degrees clockwise around the top-left corner
  opacity: number
}

export type Plan = {
  id: string
  name: string
  sheet: Sheet
  walls: Wall[]
  openings: Opening[]
  fixtures: Fixture[]
  rooms: Room[]
  dimensions: Dimension[]
  notes: Note[]
  underlay?: Underlay
}

// före = today's layout, efter = the proposed layout with demolition and new work marked
export type View = 'fore' | 'efter'

export type Revision = {
  n: number
  author: 'user' | 'claude'
  message: string
  createdAt: string
  issued?: string            // revision letter when issued
}
