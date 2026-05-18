# Feature: Fix /design Mobile Layout: Horizontal Overflow on iPhone

## ID
`011-fix-design-mobile-layout-horizontal-over`

## Status
`chore`

## Description
Fix responsive layout bugs on the `/design` page at iPhone viewport width: the model-state card, the Floor Plan card, and the SVG overflow the viewport (content clipped left, SVG/dimension labels overflow right). The header should also respect the iOS safe area, but that is **not CI-verifiable** (see Out of Scope) — it is a manual real-device check, not a binding criterion. Pure layout fix, no functional changes.

## User Stories

### As a mobile user
**I want** the `/design` page to fit within my iPhone viewport without horizontal scrolling
**So that** I can use the interface without content being clipped off-screen

## Acceptance Criteria

All criteria are browser-observable (Playwright, iPhone viewport).

### Scenario 1: No horizontal overflow on /design before sending any message

**Given** the user opens `/design`
**Then** `document.scrollingElement.scrollWidth <= window.innerWidth + 1` (no horizontal scroll)
**And** the header, the model-state card, the Floor Plan placeholder, and page chrome are fully within the viewport (not clipped at either edge)

### Scenario 2: No horizontal overflow on /design after sending the seam fixture

**Given** the user is on `/design`
**When** they send the seam fixture prompt "Jag vill bygga en komplementbyggnad, 4.5 meter lång och 4.5 meter bred"
**Then** within 15 seconds `document.scrollingElement.scrollWidth <= window.innerWidth + 1` (no horizontal scroll)
**And** the header, the model-state card, the Floor Plan card with SVG, and the SVG itself are fully within the viewport (not clipped at either edge)
**And** the SVG scales to fit the available width without forcing page width

### Scenario 3: No regression in existing active specs

**Given** all existing active specs run
**Then** [[design-screen]], [[009c-floor-plan-svg]], [[footer]], and [[deterministic-chat-seam]] all pass without regression

## Verifier Hints

- **Overflow check**: after navigating to `/design` (both before and after sending the seam fixture), evaluate `document.scrollingElement.scrollWidth <= window.innerWidth + 1` — MUST be true
- **Clipping check**: `getBoundingClientRect()` on the header, `[data-testid="model-state"]`, the floor-plan container, and `[data-testid="floor-plan-svg"]` — verify `left >= 0` and `right <= window.innerWidth` for all
- **Negative assertion**: the page must NEVER require horizontal scrolling; `document.scrollingElement.scrollWidth` must not exceed `window.innerWidth + 1` in any state
- **Do NOT verify the header safe-area / `env(safe-area-inset-top)`**: it is out of scope for CI (see below). Do not assert computed `padding-top` or viewport-fit — those are not machine-verifiable here and must not fail the verdict
- **Regression check**: run `e2e/design-screen.spec.ts`, `e2e/009c-floor-plan-svg.spec.ts`, `e2e/footer.spec.ts`, `e2e/deterministic-chat-seam.spec.ts` — all must pass

## Out of Scope (and why)

- **Header iOS safe-area inset is NOT a CI-binding criterion.** The fix should still apply `viewport-fit=cover` + `padding-top: env(safe-area-inset-top)` to the header, but Playwright renders only the web viewport — `env(safe-area-inset-*)` resolves to `0px` and `getComputedStyle` returns the used px value, so the literal `env(...)` can never be observed in CI. This is a **manual real-device spot check**, not a verifier assertion.
- Any functional changes to chat, model extraction, or SVG rendering logic
- New features; changes to pages/components beyond `/design` responsive layout

## Dependencies

- [[design-screen]] — the `/design` page UI
- [[009c-floor-plan-svg]] — the floor plan SVG component that must scale responsively
- [[deterministic-chat-seam]] — provides the fixture prompt for testing

## Notes

- Transient chore spec — auto-pruned from main after the fix PR merges
- Keep all current `data-testid`s and behaviour
- Implement the safe-area CSS (viewport-fit=cover + `env(safe-area-inset-top)` header padding) as part of the fix even though it is not CI-verified — it is the correct fix for real iOS
- SVG must scale to fit container width via responsive CSS (no hardcoded pixel width)
