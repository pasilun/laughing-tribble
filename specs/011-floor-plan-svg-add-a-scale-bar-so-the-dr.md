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

All scenarios below are verified from **a single deterministic chat interaction** using the scripted seam fixture. In preview (`VERCEL_ENV !== 'production'`) the chat route does NOT call a real LLM — it matches the exact message against a fixtures map in `app/api/design/chat/route.ts` and returns a scripted `set_building` tool-call.

1. Navigate to `/design`
2. Check Scenario 1 (no floor plan yet)
3. Send exactly this message (must match the fixture verbatim): `"Jag vill bygga en komplementbyggnad, 4.5 meter lång och 4.5 meter bred"`
4. Wait up to 15s for `[data-testid="floor-plan-svg"]` to appear
5. Run Scenario 2–5 checks against that state — do NOT send further messages or reload

## Acceptance Criteria

All criteria must be browser-observable (testable via Playwright).

### Scenario 1: Scale bar absent before any building is described

**Given** the user navigates to `/design` before sending any message
**Then** `[data-testid="floor-plan-svg"]` is NOT present
**And** the placeholder text is visible ("Beskriv dimensioner för att se ritning" or similar)

### Scenario 2: Scale bar appears after building is described

**Given** the canonical fixture interaction has been performed (4.5 × 4.5m komplementbyggnad)
**When** `[data-testid="floor-plan-svg"]` is present
**Then** `[data-testid="scale-bar"]` is present inside the SVG
**And** `[data-testid="scale-bar-label"]` text content equals `"2 m"` (max dimension 4.5m > 4m threshold → 2m scale)

### Scenario 3: Scale bar is mathematically proportional to the floor plan

**Given** the canonical fixture interaction has been performed (4.5 × 4.5m)
**When** `[data-testid="floor-plan-svg"]` is present
**Then** `(x2 - x1)` of `[data-testid="scale-bar"]` divided by the `width` attribute of `[data-testid="floor-plan-rect"]` equals `2 / 4.5` within 1% tolerance

### Scenario 4: Dimension labels include the "m" unit suffix

**Given** the canonical fixture interaction has been performed (4.5 × 4.5m)
**Then** `[data-testid="dim-label-length"]` text content contains "m" (e.g. "4.5 m" or "4.5m")
**And** `[data-testid="dim-label-width"]` text content contains "m" (e.g. "4.5 m" or "4.5m")

### Scenario 5: Floor plan rectangle encodes exact real-world aspect ratio

**Given** the canonical fixture interaction has been performed (4.5 × 4.5m — a square building)
**Then** the `width` and `height` attributes of `[data-testid="floor-plan-rect"]` are equal (`width === height`) within 0.001 absolute tolerance

**Note:** read SVG attributes directly via `getAttribute` — do NOT use `getBoundingClientRect()`.

## Verifier Hints

- **Seam**: the verifier deploys to a Vercel preview; `VERCEL_ENV=preview` so the chat route uses the fake model. The fixture phrase must be sent verbatim — any deviation returns "Jag förstår inte din förfrågan" with no tool-call, which is a test setup error not an implementation failure
- **Scenario 1**: before sending any message, assert `document.querySelector('[data-testid="floor-plan-svg"]') === null`
- **Scenario 2**: `await page.getByTestId('scale-bar-label').textContent()` must equal `"2 m"` exactly
- **Scenario 3**: `browser_evaluate('() => { const bar = document.querySelector("[data-testid=scale-bar]"); const rect = document.querySelector("[data-testid=floor-plan-rect]"); return (parseFloat(bar.getAttribute("x2")) - parseFloat(bar.getAttribute("x1"))) / parseFloat(rect.getAttribute("width")); }')` — assert result is within 0.01 of `2/4.5 ≈ 0.4444`
- **Scenario 4**: `getByTestId('dim-label-length').textContent()` must contain "m"; same for `dim-label-width`
- **Scenario 5**: `browser_evaluate('() => { const r = document.querySelector("[data-testid=floor-plan-rect]"); return Math.abs(parseFloat(r.getAttribute("width")) - parseFloat(r.getAttribute("height"))); }')` — assert result < 0.001
- **Mobile check**: assert `document.scrollingElement.scrollWidth <= window.innerWidth + 1`

## Out of Scope

- Testing multiple building sizes in one spec (adaptive logic: max ≤ 4m → "1 m", ≤ 10m → "2 m", else → "5 m"; the 4.5m case covers the middle band)
- Changes to chat, building model extraction, or any other component
- Changes to protected paths

## Notes

- Implementation target: `components/FloorPlanSVG.tsx`
- Scale bar adaptive logic: `max(length, width) ≤ 4 → 1m; ≤ 10 → 2m; else → 5m`
- Scale bar drawn inside the SVG below the floor plan rect, with tick marks at both ends and a centred label
- The `width`/`height` SVG attributes of the rect must encode the exact real-world ratio — for 4.5×4.5m the rect must be square
