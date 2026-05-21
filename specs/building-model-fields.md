# Feature: Building Model Fields

## ID
`building-model-fields`

## Status
`planned`

## Regression Test
`e2e/_verified-building-model-fields.spec.ts`

## Description
The building model extraction via the chat seam is extended to capture additional structural and regulatory fields beyond the base `flowType` and `footprint`. These fields provide the necessary inputs for the triage panel and validation loop capabilities to determine regulatory requirements and constraints.

The new fields are:
- `roof`: `{ type: "sadel" | "pulpet" | "flat", pitch?: number }` — roof shape and optional pitch in degrees
- `wallHeight`: number — wall height in metres
- `installations`: string[] — one or more of `["vatten", "avlopp", "eldstad", "rokkanal", "ventilation"]`
- `inomDetaljplan`: boolean — whether the building is within a detailed plan area
- `distanceToGrans`: number — distance to property boundary in metres

These fields are extracted incrementally from Swedish natural language via the chat seam and merged into the building model state. The chat seam's deterministic mock mode (preview/local) includes new fixture prompts that return scripted `set_building` tool-calls with these fields.

The model state is rendered as raw JSON in `[data-testid="model-state"]` for verification. Updates are partial: sending a message about one field does not overwrite others.

## User Stories

### As a user
**I want** to specify roof type, wall height, installations, and site context through natural Swedish chat
**So that** the system can assess regulatory requirements and building constraints

### As the triage panel
**I want** roof, wall height, installations, and site context data in the building model
**So that** I can determine the permit requirement (ANMÄLAN vs BYGGLOV) based on Sweden's building code

### As the validation loop
**I want** complete building model fields including structural and regulatory context
**So that** I can validate against area limits, setbacks, and installation requirements

## Acceptance Criteria

### Scenario 1: Base model state before any messages

**Given** the user is on the `/design` page with the chat interface
**When** no messages have been sent
**Then** `[data-testid="model-state"]` is visible
**And** `[data-testid="model-state"]` shows an empty/`null` model
**And** no fabricated values are present in the model state

### Scenario 2: Base building model extraction

**Given** the user is on the `/design` page with the chat interface
**When** the user sends "Jag vill bygga en komplementbyggnad, 4.5 meter lång och 4.5 meter bred"
**Then** within 15 seconds, `[data-testid="model-state"]` contains `flowType: "komplementbyggnad"` and `footprint: { length: 4.5, width: 4.5 }`
**And** an assistant text bubble appears
**And** `[data-testid="model-state"]` must NOT contain `roof`, `wallHeight`, `installations`, `inomDetaljplan`, or `distanceToGrans`

### Scenario 3: Roof type and pitch extraction

**Given** a building model exists with `flowType` and `footprint` fields
**When** the user sends "Sadeltak med 25 graders lutning"
**Then** within 10 seconds, `[data-testid="model-state"]` contains `roof: { type: "sadel", pitch: 25 }`
**And** `flowType` and `footprint` remain unchanged
**And** the page does NOT reload

### Scenario 4: Wall height extraction

**Given** a building model exists with `flowType`, `footprint`, and `roof` fields
**When** the user sends "Vägghöjd 2.4 meter"
**Then** within 10 seconds, `[data-testid="model-state"]` contains `wallHeight: 2.4`
**And** earlier fields (`flowType`, `footprint`, `roof`) remain unchanged
**And** the page does NOT reload

### Scenario 5: Installations extraction (multiple)

**Given** a building model exists with structural fields
**When** the user sends "Den ska ha dusch och avlopp"
**Then** within 10 seconds, `[data-testid="model-state"]` contains `installations: ["vatten", "avlopp"]`
**And** earlier fields remain unchanged
**And** `[data-testid="model-state"]` must NOT contain any installation values other than `vatten` and `avlopp`
**And** the page does NOT reload

### Scenario 6: Triage context extraction

**Given** a building model exists with structural fields
**When** the user sends "Den ligger inom detaljplan, 4 meter från tomtgränsen"
**Then** within 10 seconds, `[data-testid="model-state"]` contains `inomDetaljplan: true` and `distanceToGrans: 4`
**And** earlier fields remain unchanged
**And** the page does NOT reload

### Scenario 7: Cumulative model state after all updates

**Given** all extraction scenarios have been executed in sequence
**When** the building model is fully populated
**Then** `[data-testid="model-state"]` contains all fields: `flowType`, `footprint`, `roof`, `wallHeight`, `installations`, `inomDetaljplan`, `distanceToGrans`
**And** the chat history shows all user messages and all assistant responses
**And** no page reload occurred during any update

### Scenario 8: Mobile viewport constraint (all scenarios)

**Given** the browser is at iPhone viewport width
**When** any scenario state is reached
**Then** there is NO horizontal overflow (`document.scrollingElement.scrollWidth <= window.innerWidth + 1`)
**And** primary chrome (header, chat input, model state) is fully within viewport

## Verifier Hints

- Use `[data-testid="model-state"]` to locate the raw model JSON; it must contain the extracted field(s) with correct values and types
- Use `JSON.parse()` on `[data-testid="model-state"].textContent` to verify exact structure: `roof` must be an object with `type` string and optional `pitch` number; `wallHeight` and `distanceToGrans` must be numbers; `installations` must be an array of strings; `inomDetaljplan` must be a boolean
- After each message, wait up to 15s (first message) or 10s (subsequent) for `[data-testid="model-state"]` to update; the element must NOT contain "fel uppstod", "error", "undefined", or remain null
- For partial update verification: capture model JSON before the message, send message, wait for update, capture after; new fields must be present, and existing fields must have identical values
- The page must NOT reload during any scenario: verify by checking that chat history remains and no navigation occurs
- At iPhone viewport, verify `document.scrollingElement.scrollWidth <= window.innerWidth + 1` in every scenario state to ensure no horizontal overflow
- Negative assertions: `[data-testid="model-state"]` must NOT contain fabricated values before any message; must NOT contain installation values other than those specified; must NOT show `null` or missing fields after their extraction scenario
- These tests must pass on the Vercel preview with NO `ANTHROPIC_API_KEY` set (validates the fake path)
- On any failure, inspect the network: confirm `POST /api/design/chat` fired (status 200) and capture the streamed response body — a missing tool part or incorrectly shaped arguments is the expected failure signature

## Out of Scope

- Triage verdict logic (LOVFRI/ANMÄNAL/BYGGLOV determination) → covered by `[[009d-triage-panel]]`
- Validation/limit feedback loop with user guidance → covered by `[[009e-validation-loop]]`
- Formatted summary panel with user-friendly display of these fields → this is a later capability
- Floor-plan visual changes based on these fields → `[[009c-floor-plan-svg]]` uses footprint only
- Real-LLM extraction quality evaluation → this is a separate non-blocking evaluation
- Other building model fields (e.g., foundation type, exterior materials) → not in this capability

## Dependencies

- `[[deterministic-chat-seam]]` — provides the base seam with mock model, fixtures map, and model-state echo
- `POST /api/design/chat` endpoint — the chat route that will be extended with new fixture prompts
- `set_building` tool schema — must be extended to accept the new field types

## Notes

- Implementation location: `app/api/design/chat/route.ts` — extend the FIXTURES map with new prompts for roof, wallHeight, installations, and triage context
- Extend the `set_building` tool schema to accept the new field types
- Update client-side BuildingModel type definition to include the new fields
- Update client-side model merge logic to handle the new fields (partial merge)
- New fixture prompts to add:
  - "Sadeltak med 25 graders lutning" → `set_building({ roof: { type: "sadel", pitch: 25 } })`
  - "Vägghöjd 2.4 meter" → `set_building({ wallHeight: 2.4 })`
  - "Den ska ha dusch och avlopp" → `set_building({ installations: ["vatten", "avlopp"] })`
  - "Den ligger inom detaljplan, 4 meter från tomtgränsen" → `set_building({ inomDetaljplan: true, distanceToGrans: 4 })`
- Keep existing fixtures working: "Jag vill bygga en komplementbyggnad..." and "Ändra längden till 5 meter"
- The model state JSON echo in `[data-testid="model-state"]` is raw and unformatted — this is intentional for verification
- The mock model must continue to use the AI SDK's mock utilities (as per deterministic-chat-seam) — do not hand-author stream chunks
