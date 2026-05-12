# Feature: SVG Floor Plan

## ID
`009c-floor-plan-svg`

## Status
`draft`

## Description

Render a dimensioned SVG floor plan derived from the BuildingModel (spec 009b). The plan updates live as the model changes. No user interaction with the drawing — it is always generated from the model, never drawn directly.

## User Stories

### As a homeowner
**I want** to see a dimensioned floor plan as I describe my building
**So that** I can visually confirm the dimensions before generating documents

## Acceptance Criteria

### Scenario 1: Floor plan appears after footprint is set

**Given** the user has described a building and the model has a footprint set
**Then** an SVG element is visible on the page
**And** the SVG contains a rectangle representing the building footprint
**And** dimension labels are visible showing the length and width in metres

### Scenario 2: Floor plan updates when dimensions change

**Given** an SVG floor plan is showing a 4.5 × 4.5m building
**When** the user sends a message that changes the width to 5m and the model updates
**Then** the SVG dimension label for width updates to "5.0 m" within 5 seconds
**And** the rectangle proportions change accordingly

### Scenario 3: BYA shown below plan

**Given** the SVG floor plan is visible
**Then** the text "Byggnadsarea:" followed by the area in m² is visible near the floor plan

### Scenario 4: Nockhöjd shown when roof is set

**Given** the model has a roof type and pitch set
**Then** the text "Nockhöjd:" followed by the computed value in metres is visible near the floor plan

### Scenario 5: No floor plan before footprint exists

**Given** the user has not yet described any dimensions
**Then** no SVG floor plan is visible
**And** a placeholder text such as "Beskriv din byggnad för att se en planritning" is shown in the floor plan area

## Out of Scope

- Windows, doors, internal walls
- Multiple rooms or non-rectangular footprints
- Fixed map scale (the SVG fits the available panel width)
- North arrow with real orientation (placeholder only)
- PDF export

## Dependencies

- Spec 009b completed (BuildingModel in React state)

## SVG Content Requirements

- One `<rect>` for the building footprint, sized proportionally to the panel
- Dimension lines and labels on all four sides (length and width in metres, one decimal)
- BYA text below the SVG: "Byggnadsarea: X.XX m²"
- Nockhöjd text below BYA (only if roof is set): "Nockhöjd: X.X m"
- A scale bar showing the real-world length it represents (e.g. "5 m")
- A north arrow glyph (fixed pointing up — real orientation comes in spec 007)
- Title block at the bottom: "Planritning — [purpose] — [datum]"

## Notes

- Render as a React component `<FloorPlanSVG model={buildingModel} />` in `components/FloorPlanSVG.tsx`
- All geometry is computed from model values; no hardcoded pixel dimensions
- SVG viewBox scales to fit available width; aspect ratio matches footprint proportions
- Use `data-testid="floor-plan-svg"` on the `<svg>` element and `data-testid="dim-label-width"` / `data-testid="dim-label-length"` on the dimension labels for verifier assertions
