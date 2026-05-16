# Feature: Situationsplan

## ID
`007-situationsplan`

## Status
`planned`

## Description
The situationsplan screen lets a user upload their fastighetskarta (property map), place a draggable rectangle representing the friggebod footprint on top of it, see computed distances to the four property edges, and export the annotated map as a scaled PDF with a north arrow and scale bar.

## User Stories

### As a homeowner
**I want** to upload my fastighetskarta and place my planned friggebod on it
**So that** I can see whether it respects the 4.5 m distance-to-boundary rule

### As a homeowner
**I want** to export the annotated situationsplan as a PDF
**So that** I can include it in my bygglov packet

## Acceptance Criteria

All criteria must be browser-observable (testable via Playwright).

### Scenario 1: Page exists and is reachable

**Given** the user navigates to `/situationsplan`
**When** the page loads
**Then** a heading with the text "Situationsplan" is visible

### Scenario 2: Upload fastighetskarta

**Given** the user is on `/situationsplan`
**When** the user uploads a PNG or PDF file via the upload control (data-testid="map-upload")
**Then** the uploaded image is displayed inside the canvas area (data-testid="map-canvas")

### Scenario 3: Place building footprint

**Given** a map image has been uploaded
**When** the user clicks "Lägg till byggnad" (data-testid="add-building-btn")
**Then** a resizable rectangle appears on the canvas (data-testid="building-rect")

### Scenario 4: Distance readouts update

**Given** a building rectangle is placed on the canvas
**When** the rectangle is visible
**Then** four distance labels are shown (data-testid="dist-north", "dist-south", "dist-east", "dist-west") each displaying a value in metres (e.g. "6.2 m")

### Scenario 5: Export PDF

**Given** a building rectangle is placed on the canvas
**When** the user clicks "Exportera PDF" (data-testid="export-pdf-btn")
**Then** a file download is triggered (the button is not disabled and a download occurs)

## Out of Scope

- Automatic detection of property boundary from the uploaded image (boundaries are inferred from image edges at a user-set scale)
- Multiple buildings on one plan
- North arrow rotation by the user
- Real georeferenced coordinates

## Dependencies

- No other specs must be completed first
- `pdf-lib` or `jsPDF` for PDF export

## Notes

- Use image edges as a proxy for property boundary for now (scale 1 px = user-defined metres).
- The north arrow can be a static SVG pointing up.
- Scale bar should show a fixed "10 m" segment calculated from the user-set scale.
- Distance labels = distance from rectangle edge to nearest image edge, in metres.
- Keep the canvas implementation simple: a plain `<canvas>` element or an absolutely-positioned `<div>` overlay on the image — no WebGL required.
