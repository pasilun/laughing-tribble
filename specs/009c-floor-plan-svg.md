# Feature: SVG Floor Plan

## ID
`009c-floor-plan-svg`

## Status
`active`

## Regression Test
`e2e/009c-floor-plan-svg.spec.ts`

## Description

Render a dimensioned SVG floor plan derived from the BuildingModel (provided by [[deterministic-chat-seam]]). The plan updates live as the model changes via chat messages. No user interaction with the drawing — it is always generated from the model, never drawn directly.

The component renders at `<FloorPlanSVG model={buildingModel} />` in `components/FloorPlanSVG.tsx`.

## User Stories

### As a homeowner
**I want** to see a dimensioned floor plan as I describe my building
**So that** I can visually confirm the dimensions before generating documents

## Acceptance Criteria

All criteria must be browser-observable (testable via Playwright).

### Scenario 1: Placeholder before footprint is set

**Given** the user is on `/design` and has not yet described any dimensions
**Then** no `[data-testid="floor-plan-svg"]` element is visible
**And** a placeholder text is visible in the floor-plan area

### Scenario 2: Floor plan appears after footprint is set

**Given** the user is on `/design`
**When** the user sends "Jag vill bygga en komplementbyggnad, 4.5 meter lång och 4.5 meter bred"
**Then** within 15 seconds an `<svg data-testid="floor-plan-svg">` appears
**And** the SVG contains a `<rect>` proportional to `footprint.length × footprint.width`
**And** dimension labels `[data-testid="dim-label-length"]` and `[data-testid="dim-label-width"]` show "4.5"
**And** the text "Byggnadsarea:" shows "20.25" (4.5 × 4.5)

### Scenario 3: Floor plan updates live when dimensions change

**Given** a floor plan is showing a 4.5 × 4.5m building
**When** the user sends "Ändra längden till 5 meter"
**Then** within 5 seconds `[data-testid="dim-label-length"]` updates to show "5"
**And** `[data-testid="dim-label-width"]` still shows "4.5"
**And** the text "Byggnadsarea:" shows "22.5" (5 × 4.5)
**And** the `<rect>` proportions change accordingly
**And** there is no page reload

### Scenario 4: BYA displayed correctly

**Given** the SVG floor plan is visible with any dimensions
**Then** the text "Byggnadsarea:" followed by the calculated area in m² is visible near the floor plan

## Verifier Hints

- **Selector hint**: use `[data-testid="floor-plan-svg"]` to find the SVG element; it must contain a `<rect>` element representing the footprint
- **Negative assertion**: before any footprint is set, `[data-testid="floor-plan-svg"]` must NOT exist in the DOM; only placeholder text is visible
- **Selector hint**: use `[data-testid="dim-label-length"]` and `[data-testid="dim-label-width"]` to find dimension labels; they must contain numeric values (e.g. "4.5", "5") — if empty or missing, dimension rendering is broken
- **Async hint**: after sending "Jag vill bygga en komplementbyggnad, 4.5 meter lång och 4.5 meter bred", wait up to 15s for `[data-testid="floor-plan-svg"]` to appear; content must be >10 chars and must NOT contain "fel uppstod" / "error" / "undefined"
- **State transition**: after sending "Ändra längden till 5 meter", `[data-testid="dim-label-length"]` must update to show "5" within 5s WITHOUT a page reload; if the old value persists, the reactive update is broken
- **Area verification**: check that the page contains "Byggnadsarea:" followed by a number; the number must be approximately correct (4.5 × 4.5 = 20.25, 5 × 4.5 = 22.5)

## Out of Scope

- Nockhöjd / roof pitch (the seam extracts no roof/pitch — separate later spec)
- Scale bar, north arrow, title block (decorative; later)
- PDF export
- Windows, doors, internal walls
- Non-rectangular footprints (only single rectangle supported)

## Dependencies

- [[deterministic-chat-seam]] — provides the `buildingModel` React state with `flowType`, `footprint{length,width}`

## Notes

- Implemented as `<FloorPlanSVG model={buildingModel} />` in `components/FloorPlanSVG.tsx`
- SVG viewBox scales to fit available width; aspect ratio matches footprint proportions
- Live updates: dimension changes via chat update the SVG within ~5s without page reload
