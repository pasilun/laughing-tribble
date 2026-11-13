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
  exterior?: boolean         // outer wall of the building (facade): its openings are windows
  noAutoDim?: boolean        // a demolished wall's length is dimensioned automatically; true leaves that dimension out
}

// A solid with a sloping outline that a straight wall can't draw, e.g. the
// tapered masonry beside a stairwell. Convex, corners in order around it.
export type Mass = {
  id: string
  points: Pt[]
  phase: Phase
  loadBearing?: boolean
}

// A shaded area on the drawing, e.g. the apartment that is merged into another:
// a light grey under the walls, with a row in the legend. Any simple outline,
// corners in order; the walls cover its edges. `views` limits it to one sheet.
export type Zone = {
  id: string
  points: Pt[]
  label?: string
  views?: View[]
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
  inset?: number             // door: the leaf hangs this far (mm) in from the face it swings to; default 0 (at the face). In a thick wall the frame sits further in, so the leaf reaches less far into the room.
  through?: boolean          // an open passage: no wall, door or frame in this stretch, so the rooms either side are one space
  beam?: string              // a documented beam carrying the wall above, e.g. "INP 22 (K-ritning 1936)"
  evidence?: Evidence[]      // the drawings that show it, and how it was read
}

// One drawing's reading of an opening: which source, by what method, and
// where that drawing puts it (offset/width along the same wall).
export type Evidence = { source: string; method: string; offset: number; width: number }

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
  | 'balcony'                // slab outside the facade, w along it, d out from it

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
  goneAfter?: boolean        // the room disappears in "efter" (e.g. a closet that is torn out)
  newAfter?: boolean         // the room exists only in "efter" (a new corridor or room made by the change)
  at: Pt                     // label position
  apartment?: string
  polygon?: Pt[]             // optional outline, used for area
}

export type Dimension = {
  id: string
  a: Pt
  b: Pt
  offset: number             // perpendicular offset of the dimension line (positive = left of a → b)
  views?: View[]             // only on these sheets (e.g. a measure of what is demolished: efter); default both
}

export type Note = {
  id: string
  at: Pt
  text: string
  phase?: Phase
  badge?: boolean            // a number or short mark in a circle, centred on `at` (to number walls in a list)
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

// 1:50 and 1:100 for permit drawings; 1:150 and 1:200 fit a whole floor on one sheet.
export type SheetScale = 50 | 100 | 150 | 200

export type Sheet = {
  paper: 'A4' | 'A3'
  orientation: 'landscape' | 'portrait'
  scale: SheetScale
  northAngle: number         // degrees clockwise from sheet up
  doorSwings?: boolean       // false: doors drawn as a closed leaf, no swing arc (overview sheets); default true
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

// A drawing the plan is traced from (archive scan, owner's before/after
// drawing). Placed in plan coordinates like the underlay; the scan tools
// work on these.
export type Source = {
  id: string
  name: string
  role: 'archive' | 'before' | 'after' | 'other'
  src: string                // asset URL of the PNG
  widthPx: number
  heightPx: number
  dpi?: number               // scan/render resolution, when known
  mmPerPx: number
  x: number                  // plan position of the image's top-left corner
  y: number
  rotation: number           // degrees; scan tools require 0
  calibration?: string       // how mmPerPx was set, e.g. "pdf 1:50" or "3 mått, ±0,8 %"
  year?: number              // when the drawing was made: older ones show the building as it was
  view?: 'plan' | 'elevation' // elevation: a facade, x along the facade, y up the building
  primary?: boolean          // the source the plan is drawn against: used when a tool is not told which source
}

export type Plan = {
  id: string
  name: string
  sheet: Sheet
  walls: Wall[]
  masses?: Mass[]
  zones?: Zone[]
  openings: Opening[]
  fixtures: Fixture[]
  rooms: Room[]
  dimensions: Dimension[]
  notes: Note[]
  underlay?: Underlay
  sources?: Source[]
}

// före = today's layout, efter = the proposed layout with demolition and new work marked
export type View = 'fore' | 'efter'

export type Revision = {
  n: number
  author: 'user' | 'claude'
  message: string
  createdAt: string
  issued?: string            // revision letter when issued
  by?: string                // who saved it (the signed-in person; Claude's changes carry the person Claude acted for)
}
