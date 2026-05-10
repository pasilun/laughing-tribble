# Feature: Planritning

## ID
`008-planritning`

## Status
`draft`

## Description
The planritning screen renders a dimensioned 2D floor plan for a friggebod based on user-supplied measurements. The user enters width, depth, and optionally wall height; the app draws an SVG floor plan with dimension arrows and displays the computed area. The plan can be exported as a PDF.

## User Stories

### As a homeowner
**I want** to enter my friggebod dimensions and see a floor plan
**So that** I have a planritning to include in my bygglov packet

### As a homeowner
**I want** to see the total area calculated automatically
**So that** I can confirm it stays within the 15 m² friggebod limit

### As a homeowner
**I want** to export the floor plan as a PDF
**So that** I can include it in my bygglov packet

## Acceptance Criteria

All criteria must be browser-observable (testable via Playwright).

### Scenario 1: Page exists and is reachable

**Given** the user navigates to `/planritning`
**When** the page loads
**Then** a heading with the text "Planritning" is visible
**And** input fields for width (data-testid="input-width") and depth (data-testid="input-depth") are visible

### Scenario 2: Floor plan renders from inputs

**Given** the user is on `/planritning`
**When** the user enters "3" in the width field and "4" in the depth field
**Then** an SVG element (data-testid="floor-plan-svg") is rendered on the page

### Scenario 3: Area calculated correctly

**Given** the user has entered width = 3 and depth = 4
**When** the floor plan is displayed
**Then** the area readout (data-testid="area-display") shows "12 m²"

### Scenario 4: Area updates when inputs change

**Given** width = 3 and depth = 4 are entered
**When** the user changes depth to "5"
**Then** the area readout shows "15 m²"

### Scenario 5: Area limit warning

**Given** width = 4 and depth = 4 are entered (area = 16 m²)
**When** the floor plan is displayed
**Then** a warning element (data-testid="area-warning") is visible containing the text "15 m²"

### Scenario 6: Export PDF

**Given** valid width and depth values are entered
**When** the user clicks "Exportera PDF" (data-testid="export-pdf-btn")
**Then** a file download is triggered (the button is not disabled)

## Out of Scope

- Doors, windows, or interior walls
- Non-rectangular footprints
- Multiple rooms
- Roof plan or section drawings
- Wall thickness rendering

## Dependencies

- No other specs must be completed first
- `pdf-lib` or `jsPDF` for PDF export

## Notes

- SVG dimensions should be proportional to input values with a fixed padding.
- Dimension arrows should label width and depth in metres (e.g. "3.0 m").
- Wall height input is optional and not required for the acceptance criteria — include it in the UI but it does not need to affect the 2D plan.
- The 15 m² warning should be styled visibly (e.g. amber/red text) but the exact styling is not tested.
- Scale can be fixed at 1:50 for now; the PDF should print at A4.
