# Feature: Design Page Split-Panel Layout

## ID
`design-page-split-panel-layout`

## Status
`obsolete`

## Regression Test
`e2e/_verified-design-page-split-panel-layout.spec.ts`

## Description
The `/design` page layout is reconfigured from a vertically stacked layout to a split-panel layout on desktop (≥ 768 px wide) with the chat panel on the left and the building model state panel on the right. The model state panel remains sticky in the viewport while the chat panel scrolls freely. The model state is displayed with human-readable Swedish labels for each field rather than raw JSON. On mobile (< 768 px), the layout stacks vertically with the model state panel on top and chat below. The chat input remains anchored to the bottom of the chat panel at all times.

Fields in the model state panel that have been extracted from the conversation display their values clearly, while fields that have not yet been set are shown in a muted/placeholder style so the user can see what information is still missing.

The mapping from JSON field keys to Swedish labels:
- `flowType` → "Byggnadstyp"
- `footprint` → "Grundplan" (displays `{length} m × {width} m`)
- `roof.type` → "Taktyp"
- `roof.pitch` → "Taklutning"
- `wallHeight` → "Vägghöjd"
- `installations` → "Installationer"
- `inomDetaljplan` → "Detaljplan"
- `distanceToGrans` → "Avstånd till tomtgräns"

The existing raw JSON display in `[data-testid="model-state"]` remains present for verification purposes (see [[building-model-fields]]), but users see the formatted labels panel as the primary interface.

## User Stories

### As a user iterating on a building design
**I want** to see the current model state at all times while scrolling through the conversation
**So that** I can make informed adjustments without losing context

### As a user reading the building model state
**I want** to see clear Swedish labels instead of JSON field names
**So that** I can quickly understand what information has been captured

### As a user with an incomplete model
**I want** to see which fields are still missing in a muted/placeholder style
**So that** I know what information I still need to provide

### As a mobile user
**I want** the layout to stack vertically so the model state is accessible at the top
**So that** I can check the current model state while still using the chat

## Acceptance Criteria

### Scenario 1: Desktop split-panel layout structure

**Given** the user is on the `/design` page on desktop (viewport width ≥ 768 px)
**Then** a split-panel layout is visible with the chat panel on the left and the model state panel on the right
**And** the model state panel is sticky (remains in viewport) while the chat panel scrolls

### Scenario 2: Model state panel shows formatted labels (empty state)

**Given** the user is on the `/design` page with no messages sent
**Then** the model state panel displays all field labels in Swedish
**And** all field values are shown in a muted/placeholder style indicating they have not been set
**And** the panel shows labels for "Byggnadstyp", "Grundplan", "Taktyp", "Taklutning", "Vägghöjd", "Installationer", "Detaljplan", "Avstånd till tomtgräns"

### Scenario 3: Model state panel updates with extracted values

**Given** the user has sent messages that extracted model fields (e.g., "Jag vill bygga en komplementbyggnad, 4.5 meter lång och 4.5 meter bred")
**When** the model state updates
**Then** the model state panel displays the extracted values with clear formatting (e.g., "Byggnadstyp: komplementbyggnad", "Grundplan: 4.5 m × 4.5 m")
**And** the extracted field labels are NOT in muted/placeholder style
**And** fields that have not been extracted remain in muted/placeholder style

### Scenario 4: Cumulative model state display

**Given** the user has sent multiple messages extracting different model fields
**When** all relevant messages have been sent (e.g., base model, roof, wall height, installations, site context)
**Then** the model state panel displays all extracted fields with their values
**And** only truly unset fields remain in muted/placeholder style
**And** the chat input remains anchored at the bottom of the chat panel

### Scenario 5: Model state panel remains sticky during chat scrolling

**Given** the user is on the `/design` page on desktop with an active conversation
**When** the user scrolls through the chat history
**Then** the model state panel stays visible in the viewport (sticky positioning)
**And** the model state panel does not scroll out of view
**And** the user can always see the current model state while reading the conversation

### Scenario 6: Mobile stacked layout

**Given** the user is on the `/design` page on mobile (viewport width < 768 px)
**Then** the layout is stacked vertically with the model state panel on top and chat below
**And** both panels are scrollable within the page
**And** the chat input remains anchored to the bottom of the chat panel
**And** the model state panel still displays formatted labels with muted/placeholder style for unset fields

### Scenario 7: Chat input remains anchored

**Given** the user is on the `/design` page (any viewport)
**When** the virtual keyboard opens or closes
**Then** the chat input remains anchored to the bottom of the chat panel
**And** the chat input does not jump or move unexpectedly

### Scenario 8: No regression to existing model extraction behaviour

**Given** the user sends messages that extract building model fields
**When** the extraction completes
**Then** the raw JSON in `[data-testid="model-state"]` matches the expected structure and values
**And** the test `_verified-building-model-fields.spec.ts` still passes

## Verifier Hints

- Use `[data-testid="model-state-panel"]` to locate the formatted model state panel; verify it contains Swedish labels for all expected fields
- For desktop split-panel verification: at viewport width ≥ 768 px, verify that the chat panel and model state panel are side-by-side (not stacked) and that the model state panel has `position: sticky` behavior
- For sticky positioning verification: scroll the chat panel and confirm that `[data-testid="model-state-panel"]` remains visible in the viewport
- For formatted labels verification: each extracted field should be displayed with its Swedish label (e.g., `[data-testid="field-flowType"]` shows "Byggnadstyp: komplementbyggnad") and NOT show raw JSON keys
- For muted/placeholder style verification: unset fields should have a muted color/opacity (e.g., `opacity: 0.5` or `color: #999`) and display placeholder text (e.g., "Ej angivet" or "—") to indicate they have not been set
- For mobile layout verification: at viewport width < 768 px, verify that the model state panel is on top and chat below, not side-by-side
- For chat input anchoring: verify `[data-testid="chat-input"]` is always at the bottom of the chat panel regardless of keyboard state; check that input value and focus are preserved
- For regression verification: after sending extraction messages, verify that `[data-testid="model-state"]` (raw JSON) still exists and contains the correct field values matching the formatted display
- Negative assertions: the formatted model state panel must NOT display raw JSON keys (e.g., must NOT show `flowType`, `footprint`, etc.); unset fields must NOT appear as if they have values; the chat input must NOT jump or lose position when the keyboard opens

## Out of Scope

- Changes to the underlying model extraction logic or field structure — handled by [[building-model-fields]]
- Changes to chat streaming behaviour or message composition — handled by [[design-screen]]
- New model fields or field types not already in the building model contract
- Real-LLM extraction quality evaluation — this is a separate non-blocking evaluation

## Dependencies

- [[building-model-fields]] — provides the building model data structure and extraction behaviour that this capability displays
- [[design-screen]] — provides the chat interface and message composition that this capability layouts around
- `[data-testid="model-state"]` — the raw JSON model state element that must remain for verification of building-model-fields

## Notes

- This capability adds a new display layer for the building model state while preserving the existing raw JSON display for backward compatibility with [[building-model-fields]] verification
- The Swedish label mapping should be implemented in a centralized location (e.g., a config object or constant) to ensure consistency
- Muted/placeholder style for unset fields should use a consistent visual treatment (e.g., opacity, color, italic text)
- Sticky positioning on desktop can be achieved with CSS `position: sticky; top: 0; height: 100vh; overflow-y: auto;` on the model state panel
- The split-panel layout can be implemented with CSS Grid or Flexbox, switching between side-by-side (desktop) and stacked (mobile) based on a media query at 768 px
- The chat input anchoring can be ensured with flexbox on the chat panel container and `flex-direction: column; justify-content: space-between;`