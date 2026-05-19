# Feature: Add Scale Bar to Floor Plan SVG

## ID
`011-floor-plan-svg-add-a-scale-bar-so-the-dr`

## Status
`chore`

## Regression Test
`None` (chore specs are transient and do not own regression tests)

## Description

Add a visual scale bar to the existing floor plan SVG to make it immediately obvious what real-world scale the drawing represents. The scale bar appears below the floor plan rectangle within the same SVG viewBox.

## User Stories

### As a homeowner
**I want** to see a scale bar on the floor plan
**So that** I can quickly understand the real-world scale without having to read dimension numbers

## Canonical Test Interaction

All scenarios below are verified from **a single chat interaction**:

1. Navigate to `/design`
2. Send exactly one message: `"Jag vill bygga en komplementbyggnad, 8 meter lång och 6 meter bred"`
3. Wait up to 15s for `[data-testid="floor-plan-svg"]` to appear
4. Run all scenario checks against that state — do NOT send further messages or reload

## Acceptance Criteria

All criteria must be browser-observable (testable via Playwright).

### Scenario 1: Scale bar absent before any building is described

**Given** the user navigates to `/design` before sending any message
**Then** `[data-testid="floor-plan-svg"]` is NOT present
**And** the placeholder text is visible ("Beskriv dimensioner för att se ritning" or similar)

### Scenario 2: Scale bar appears after building is described

**Given** the canonical interaction has been performed (8 × 6m building)
**When** `[data-testid="floor-plan-svg"]` is present
**Then** `[data-testid="scale-bar"]` is present inside the SVG
**And** `[data-testid="scale-bar-label"]` is present and contains "2 m" (8m max dimension ≤ 10m → 2m scale)

### Scenario 3: Scale bar is mathematically proportional to the floor plan

**Given** the canonical interaction has been performed (8 × 6m building)
**When** `[data-testid="floor-plan-svg"]` is present
**Then** the `x1` and `x2` attributes of `[data-testid="scale-bar"]` satisfy:
  `(x2 - x1) / rectWidth ≈ 2 / 8` (within 1% tolerance)
  where `rectWidth` is the `width` attribute of `[data-testid="floor-plan-rect"]`

### Scenario 4: Dimension labels include the "m" unit suffix

**Given** the canonical interaction has been performed (8 × 6m building)
**Then** `[data-testid="dim-label-length"]` text content contains "m" (e.g. "8 m" or "8m")
**And** `[data-testid="dim-label-width"]` text content contains "m" (e.g. "6 m" or "6m")

### Scenario 5: Floor plan rectangle encodes exact real-world aspect ratio

**Given** the canonical interaction has been performed (8 × 6m building)
**Then** `getAttribute('width')` and `getAttribute('height')` on `[data-testid="floor-plan-rect"]`
  satisfy `Math.abs(parseFloat(width) / parseFloat(height) - 8 / 6) < 0.001`

**Note:** read SVG attributes directly via `getAttribute` — do NOT use `getBoundingClientRect()`.

## Verifier Hints

- **Single session**: perform the canonical interaction once; verify all 5 scenarios without reloading or sending additional messages
- **Scenario 1 check**: before sending any message, confirm `[data-testid="floor-plan-svg"]` does not exist in the DOM
- **Scenario 2 check**: `await page.getByTestId('scale-bar-label')` — assert `.textContent()` equals `"2 m"`
- **Scenario 3 check**: use `browser_evaluate` to read `x1`/`x2` from `[data-testid="scale-bar"]` and `width` from `[data-testid="floor-plan-rect"]`; assert `Math.abs((x2-x1)/rectWidth - 2/8) < 0.01`
- **Scenario 4 check**: `getByTestId('dim-label-length').textContent()` must include "m"; same for `dim-label-width`
- **Scenario 5 check**: `browser_evaluate('() => { const r = document.querySelector("[data-testid=floor-plan-rect]"); return parseFloat(r.getAttribute("width")) / parseFloat(r.getAttribute("height")); }')` — assert result is within 0.001 of `8/6 ≈ 1.3333`
- **Mobile check**: assert `document.scrollingElement.scrollWidth <= window.innerWidth + 1`

## Out of Scope

- Testing multiple building sizes (the adaptive scale logic is covered implicitly by the 8×6m → "2 m" case)
- Changes to chat, building model extraction, or any other component
- Changes to protected paths

## Notes

- Implementation target: `components/FloorPlanSVG.tsx`
- Scale bar adaptive logic: max(length, width) ≤ 4m → "1 m"; ≤ 10m → "2 m"; otherwise → "5 m"
- Scale bar drawn inside the SVG below the floor plan rect, with tick marks at both ends and a centred label
- The `width`/`height` SVG attributes of the rect must encode the exact real-world ratio
