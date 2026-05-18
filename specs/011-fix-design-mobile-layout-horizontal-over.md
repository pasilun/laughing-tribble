# Feature: Fix /design Mobile Layout: Horizontal Overflow + Header Safe-Area on iPhone

## ID
`011-fix-design-mobile-layout-horizontal-over`

## Status
`chore`

## Description
Fix responsive layout bugs on the `/design` page at iPhone viewport width. The model-state card, the Floor Plan card, and the SVG currently overflow the viewport width (content clipped left, SVG/dimension labels overflow right). Additionally, the `Design` header does not respect the mobile safe area and sits under the iOS status bar. This is a pure layout fix with no functional changes.

## User Stories

### As a mobile user
**I want** the `/design` page to fit within my iPhone viewport without horizontal scrolling
**So that** I can use the interface without content being clipped off-screen

### As a mobile user
**I want** the page header to be visible and not hidden under the iOS status bar
**So that** I can always see which screen I'm on

## Acceptance Criteria

All criteria are browser-observable (Playwright).

### Scenario 1: No horizontal overflow on /design before sending any message

**Given** the user opens `/design` at iPhone viewport width
**Then** `document.scrollingElement.scrollWidth <= window.innerWidth + 1` (no horizontal scroll)
**And** the header, the model-state card (if present), the Floor Plan card placeholder, and any page chrome are fully within the viewport (not clipped at either edge)

### Scenario 2: No horizontal overflow on /design after sending the seam fixture

**Given** the user is on `/design` at iPhone viewport width
**When** they send the seam fixture prompt "Jag vill bygga en komplementbyggnad, 4.5 meter lång och 4.5 meter bred"
**Then** within 15 seconds `document.scrollingElement.scrollWidth <= window.innerWidth + 1` (no horizontal scroll)
**And** the header, the model-state card, the Floor Plan card with SVG, and the SVG itself are fully within the viewport (not clipped at either edge)
**And** the SVG scales to fit the available width without forcing page width

### Scenario 3: Header respects mobile safe-area

**Given** the user opens `/design` at iPhone viewport width
**Then** the viewport meta tag includes `viewport-fit=cover`
**And** the header has CSS `padding-top: env(safe-area-inset-top)` applied
**And** the header text is positioned below the iOS status bar safe area

### Scenario 4: No regression in existing active specs

**Given** all existing active specs run
**Then** [[design-screen]], [[009c-floor-plan-svg]], [[footer]], and [[deterministic-chat-seam]] all pass without regression

## Verifier Hints

- **Overflow check**: after navigating to `/design` (both before and after sending the seam fixture), execute `document.scrollingElement.scrollWidth <= window.innerWidth + 1` in the browser context — this MUST be true for no horizontal scroll
- **Clipping check**: use `getBoundingClientRect()` on the header, `[data-testid="model-state"]`, the floor-plan container, and `[data-testid="floor-plan-svg"]` — verify `left >= 0` and `right <= window.innerWidth` for all elements (no clipping at edges)
- **Safe-area verification**: check that `<meta name="viewport">` contains `viewport-fit=cover` and that the header element has computed style `padding-top` with value starting with `env(safe-area-inset-top)` (use `getComputedStyle(header).paddingTop`)
- **Negative assertion**: the page must NOT require horizontal scrolling at any point; `document.scrollingElement.scrollWidth` must never exceed `window.innerWidth + 1`
- **State transition**: after sending the seam fixture, the SVG must appear and scale to fit within the viewport width without triggering horizontal overflow — the SVG viewBox should scale responsively
- **Regression check**: run all referenced active spec tests (`e2e/design-screen.spec.ts`, `e2e/009c-floor-plan-svg.spec.ts`, `e2e/footer.spec.ts`, `e2e/deterministic-chat-seam.spec.ts`) — all must pass with the same selectors and data-testid values

## Out of Scope

- Any functional changes to chat, model extraction, or SVG rendering logic
- Adding new features or capabilities
- Changes to other pages or components beyond `/design` responsive layout

## Dependencies

- [[design-screen]] — the `/design` page UI
- [[009c-floor-plan-svg]] — the floor plan SVG component that must scale responsively
- [[deterministic-chat-seam]] — provides the fixture prompt for testing

## Notes

- This is a transient chore spec that will be auto-pruned from main after the fix PR merges
- The issue specifically states: "Touch nothing else; keep all current `data-testid`s and behaviour"
- The safe-area overlap cannot be asserted in CI since Playwright renders only the web viewport; spot-check on a real device is recommended but not required for CI verification
- The SVG must scale to fit the container width via responsive CSS (viewport meta, SVG viewBox, or max-width constraints) without hardcoding pixel dimensions
