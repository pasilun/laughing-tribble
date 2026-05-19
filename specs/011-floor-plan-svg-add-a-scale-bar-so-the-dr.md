# Feature: Add Scale Bar to Floor Plan SVG

## ID
`011-floor-plan-svg-add-a-scale-bar-so-the-dr`

## Status
`chore`

## Regression Test
`None` (chore specs are transient and do not own regression tests)

## Description

Add a visual scale bar to the existing floor plan SVG to make it immediately obvious what real-world scale the drawing represents. The scale bar appears below the floor plan rectangle within the same SVG viewBox.

This is a transient chore spec that drives one dev+verify cycle to add the scale bar feature. After implementation, the scale bar requirements will be folded into the existing `009c-floor-plan-svg.md` capability spec, and this file will be auto-pruned.

## User Stories

### As a homeowner
**I want** to see a scale bar on the floor plan
**So that** I can quickly understand the real-world scale without having to read dimension numbers

## Acceptance Criteria

All criteria must be browser-observable (testable via Playwright).

### Scenario 1: Scale bar appears with floor plan

**Given** the user is on `/design` and describes a 4.5 × 4.5m building
**When** the floor plan SVG appears
**Then** a horizontal scale bar is visible below the floor plan rectangle
**And** the scale bar has tick marks at both ends
**And** a label underneath the bar shows the scale (e.g. "1 m")

### Scenario 2: Scale bar length adapts to building size

**Given** the user is on `/design` and describes a 4.5 × 4.5m building
**When** the floor plan appears
**Then** the scale bar shows "1 m" (for buildings ≤ 4m)

**Given** the user is on `/design` and describes a 8 × 6m building
**When** the floor plan appears
**Then** the scale bar shows "2 m" (for buildings ≤ 10m)

**Given** the user is on `/design` and describes a 12 × 8m building
**When** the floor plan appears
**Then** the scale bar shows "5 m" (for larger buildings)

### Scenario 3: Scale bar is mathematically proportional

**Given** the floor plan shows a building of known dimensions (e.g. 4.5 × 4.5m)
**When** the scale bar shows "1 m"
**Then** the scale bar's SVG length is exactly proportional to the floor plan rectangle (1m scale bar length = floor plan rectangle length / 4.5)

### Scenario 4: Dimension labels include unit suffix

**Given** the floor plan is showing any dimensions
**Then** the dimension labels on the axes include the "m" unit suffix (e.g. "4.5m" instead of "4.5")

### Scenario 5: Floor plan rectangle dimensions are mathematically exact

**Given** the user is on `/design` and describes a 10 × 3m building
**When** the floor plan SVG appears
**Then** the `width` and `height` attributes of `[data-testid="floor-plan-rect"]` satisfy `width / height === 10 / 3` exactly (i.e. `Math.abs(width / height - 10 / 3) < 0.001`)

**Given** the user is on `/design` and describes a 4 × 4m building
**When** the floor plan SVG appears
**Then** the `width` and `height` attributes of `[data-testid="floor-plan-rect"]` are identical (`width === height`)

**Note:** this criterion tests the SVG attribute values directly — not visual appearance. A visually similar rectangle is not sufficient; the ratio encoded in the markup must equal the real-world ratio.

## Verifier Hints

- **Selector hint**: after sending a dimension message, wait up to 15s for `[data-testid="floor-plan-svg"]` to appear; verify it contains a scale bar element (look for tick marks or a line element below the rect)
- **Scale bar label**: find the scale bar label element (`[data-testid="scale-bar-label"]`); it must contain a number followed by " m" (e.g. "1 m", "2 m", "5 m") and must NOT be empty
- **Proportional verification**: for a 4.5 × 4.5m building, verify the scale bar shows "1 m"; the scale bar's length should be approximately 1/4.5 of the floor plan rectangle's width (within 5% tolerance)
- **Dimension label units**: use `[data-testid="dim-label-length"]` and `[data-testid="dim-label-width"]` to verify they contain the "m" suffix (e.g., "4.5m" not "4.5")
- **Rectangle exact ratio**: read `width` and `height` from `[data-testid="floor-plan-rect"]` using `getAttribute('width')` and `getAttribute('height')`; parse as floats; assert `Math.abs(parseFloat(width) / parseFloat(height) - 10 / 3) < 0.001` for a 10 × 3m building; assert `parseFloat(width) === parseFloat(height)` for a 4 × 4m building. Do NOT use `getBoundingClientRect()` — read the SVG attributes directly.
- **Negative assertion**: the scale bar must NOT appear before the floor plan is set; only the placeholder should be visible initially

## Out of Scope

- Changes to chat, building model extraction, or any other component
- Changes to protected paths
- North arrow, title block, or other decorative elements (marked "later" in 009c-floor-plan-svg.md)

## Dependencies

- [[009c-floor-plan-svg]] — the active capability spec that will eventually incorporate these requirements

## Notes

- Implementation target: `components/FloorPlanSVG.tsx`
- The scale bar should be drawn inside the same SVG as the floor plan rectangle
- Scale bar adaptive logic:
  - If max dimension ≤ 4m: use 1m scale
  - If max dimension ≤ 10m: use 2m scale
  - Otherwise: use 5m scale
- Scale bar should be positioned below the floor plan rectangle, with tick marks at both ends
- Label text should be centered below the scale bar
- The `width` and `height` SVG attributes of the floor plan rect must encode the exact real-world ratio — `width / height` must equal `length / width_dimension` to within floating-point precision (< 0.001 absolute error)
