# Feature: Situationsplan

## ID
`007-situationsplan`

## Status
`planned`

## Description
A desktop-first page (`/situationsplan`) where the user uploads their fastighetskarta
(property map), calibrates the scale, places a draggable building footprint on the map,
sees computed distances to the four property edges, and exports a PDF suitable for
inclusion in a bygglov packet.

The building footprint is pre-populated from the BuildingModel established in the design
conversation (passed via URL query params). The page is intentionally desktop-only —
drag-and-place interaction is impractical on small touchscreens. A notice is shown on
narrow viewports.

## User Stories

### As a homeowner at a desktop
**I want** to upload my fastighetskarta, place my planned building on it, and see
distances to the property boundary
**So that** I can verify the 4.5 m setback rule before submitting

### As a homeowner
**I want** to export the annotated situationsplan as a PDF
**So that** I can include it in my bygglov/anmälan packet

## Acceptance Criteria

All criteria must be browser-observable (testable via Playwright).

### Scenario 1: Page exists and is reachable

**Given** the user navigates to `/situationsplan`
**When** the page loads
**Then** a heading with the text "Situationsplan" is visible
**And** a narrow-viewport notice is shown on screens narrower than 768 px
(`data-testid="desktop-notice"`) and hidden on wider screens

### Scenario 2: Upload fastighetskarta

**Given** the user is on `/situationsplan`
**When** the user uploads a PNG or JPEG file via the upload control
(`data-testid="map-upload"`)
**Then** the uploaded image is displayed inside the canvas area
(`data-testid="map-canvas"`)

### Scenario 3: Calibrate scale

**Given** a map image has been uploaded
**When** the user types a value into the property-width input
(`data-testid="property-width-input"`, value in metres)
**Then** the pixel-per-metre ratio is derived from `image.naturalWidth / value`
**And** the building rect width and height update to reflect real-world dimensions

### Scenario 4: Building rect pre-populated from URL params

**Given** the user navigates to `/situationsplan?l=15&w=3`
**When** the page loads
**Then** a building rectangle is already visible on the canvas
(`data-testid="building-rect"`) sized proportionally to the given dimensions
**And** no "Lägg till byggnad" button press is required

### Scenario 5: Place building footprint manually

**Given** a map image has been uploaded and no URL params were given
**When** the user clicks "Lägg till byggnad" (`data-testid="add-building-btn"`)
**Then** a building rectangle appears on the canvas (`data-testid="building-rect"`)

### Scenario 6: Distance readouts

**Given** a building rectangle is on the canvas and the scale is calibrated
**When** the rectangle is visible
**Then** four distance labels are shown:
`data-testid="dist-north"`, `"dist-south"`, `"dist-east"`, `"dist-west"`
each displaying a numeric value followed by " m" (e.g. "6.2 m")
**And** any label showing a distance below 4.5 m has `data-testid="dist-warning"`
visible alongside it

### Scenario 7: Export PDF

**Given** a building rectangle is on the canvas
**When** the user clicks "Exportera PDF" (`data-testid="export-pdf-btn"`)
**Then** a file download is triggered

### Scenario 8: Link from design screen

**Given** the user is on `/design` and the building model has a footprint set
**Then** a link to `/situationsplan?l={length}&w={width}` is visible
(`data-testid="open-situationsplan-link"`)

## Out of Scope

- Automatic property boundary detection from the image
- Multiple buildings
- North arrow rotation by the user
- Real georeferenced coordinates / Lantmäteriet WMS API
- Touch drag on mobile (desktop mouse events only)
- Resizing the building rect after placement (drag to move only for now)

## Dependencies

- `jspdf` npm package for PDF export
- Building model fields spec (009b) — footprint from URL params

## Implementation Notes

- Map canvas: `<div>` with `position: relative` containing the image +
  an absolutely-positioned building rect div. No WebGL, no canvas element.
- Drag: standard `onMouseDown/Move/Up` on the rect div. No touch handling.
- Scale calibration: `pxPerM = image.naturalWidth / propertyWidthM`.
  Building rect size in px: `w = footprint.length * pxPerM`, `h = footprint.width * pxPerM`.
- Distance formula (in metres):
  - north = `rect.y / pxPerM`
  - south = `(imageH - rect.y - rect.h) / pxPerM`
  - west  = `rect.x / pxPerM`
  - east  = `(imageW - rect.x - rect.w) / pxPerM`
- PDF export: draw map image + rect + labels onto a hidden `<canvas>`, export
  via `canvas.toDataURL()` → `jspdf.addImage()`. Include north arrow (static
  "N ↑" text), scale bar ("10 m" segment), date footer.
- Narrow-viewport notice: shown when `window.innerWidth < 768` or via Tailwind
  `md:hidden` / `hidden md:block`.
- "Öppna situationsplan" link on `/design`: render when
  `buildingModel.footprint?.length && buildingModel.footprint?.width`.

## Verifier Hints

- Upload a real PNG fixture from `e2e/fixtures/` — add a small 400×300 px
  test image (`test-map.png`) so the upload scenario doesn't depend on a
  real fastighetskarta.
- For Scenario 3 (calibration): fill property-width-input with "30", check
  that `data-testid="building-rect"` has a `style.width` matching
  `(image.naturalWidth / 30) * length` px (within 1 px tolerance).
- For Scenario 6 (distances): after calibration, check that all four
  `dist-*` testids contain a number followed by " m".
- For Scenario 7 (PDF): listen for `page.on('download', ...)` before clicking
  export; assert the download filename ends with `.pdf`.
- For Scenario 8 (link on /design): navigate to `/design`, send the komplementbyggnad
  fixture prompt, wait for `open-situationsplan-link` to appear, assert
  `href` contains `l=4.5` and `w=4.5`.
