# Feature: BuildingModel Tool Extraction

## ID
`009b-building-model-tools`

## Status
`draft`

## Description

Extend the design chat (spec 009a) with LLM tool calls that extract a structured BuildingModel from the conversation. The model state is displayed as a summary panel so the user can see what the system has understood. No floor plan rendering yet.

## User Stories

### As a homeowner
**I want** the app to understand the dimensions and type of building I describe
**So that** I can verify it has captured my intent correctly before drawings are generated

## Acceptance Criteria

### Scenario 1: Building dimensions extracted from description

**Given** the user is on `/design`
**When** the user sends "Jag vill bygga en komplementbyggnad, 4.5 meter lång och 4.5 meter bred"
**Then** a model summary panel is visible on the page
**And** the panel shows length "4.5" and width "4.5"

### Scenario 2: Model updates on correction

**Given** a model summary panel showing length 4.5m
**When** the user sends "Ändra längden till 5 meter"
**Then** the model summary panel updates to show length "5"
**And** the width remains unchanged

### Scenario 3: Roof type extracted

**Given** the user has established a footprint in the model
**When** the user sends "Sadeltak med 25 graders lutning"
**Then** the model summary panel shows roof type "sadel" and pitch "25"

### Scenario 4: Installations extracted

**Given** a conversation about a sauna
**When** the user sends "Den ska ha dusch och avlopp"
**Then** the model summary panel shows "vatten" and "avlopp" in the installations list

### Scenario 5: Computed values shown

**Given** a model with footprint 4.5 × 4.5 and roof sadel 25°, wall height 2.4m
**Then** the model summary panel shows BYA "20.25 m²"
**And** shows nockhöjd as a computed value (approximately 3.5m)

## Verifier Hints

- Send "Jag vill bygga en komplementbyggnad, 4.5 meter lång och 4.5 meter bred" and wait up to 15s for a model summary panel to appear; the panel must contain "4.5" at least twice (for length and width) and must NOT show "–" for both fields
- After the panel shows 4.5m length, send "Ändra längden till 5 meter" — within 15s the panel must show "5" for length while still showing "4.5" for width; if both values change or neither changes, the tool call or state update is broken
- Send "Den ska ha dusch och avlopp" — the panel must list both "vatten" and "avlopp" in an installations section; it must NOT remain empty or unchanged after this message
- To verify computed BYA: with footprint 4.5 × 4.5, the panel must show "20.25" somewhere (BYA = length × width); if it shows a different number the computation is wrong
- The model panel must update WITHOUT a page reload — verify by checking that the conversation messages remain visible after the panel updates

## Out of Scope

- SVG floor plan (spec 009c)
- Triage panel (spec 009d)
- Validation/limit warnings (spec 009e)

## Dependencies

- Spec 009a completed (chat UI and `POST /api/design/chat` route exist)

## Data Model

```typescript
interface BuildingModel {
  purpose: string | null
  flowType: 'komplementbyggnad' | 'komplementbostadshus' | 'tillbyggnad' | null
  footprint: { length: number; width: number } | null   // metres
  wallHeight: number | null
  roof: { type: 'sadel' | 'pulpet' | 'flat' | null; pitch: number | null }
  inomDetaljplan: boolean | null
  distanceToGrans: number | null
  installations: Array<'vatten' | 'avlopp' | 'eldstad' | 'rokkanal' | 'ventilation'>
  existingPottM2: number | null
}
```

Computed (derived, never stored):
- `bya = footprint.length × footprint.width`
- `nockhöjd`: wallHeight + `(footprint.length / 2) × tan(pitch° in radians)` for sadel; wallHeight + `footprint.length × tan(pitch°)` for pulpet; equals wallHeight for flat

## LLM Tools (added to `POST /api/design/chat`)

```
set_building(purpose?, flowType?, footprint?, wallHeight?, roof?)
  — partial update: only provided fields are changed

set_triage_context(inomDetaljplan?, distanceToGrans?, existingPottM2?)
  — partial update of property context

add_installation(type: 'vatten'|'avlopp'|'eldstad'|'rokkanal'|'ventilation')

remove_installation(type)
```

Tool results return the updated model state as JSON so the LLM can confirm what changed.

## Model Summary Panel

A compact panel (right side on desktop, below conversation on mobile) showing:
```
Byggnadstyp:   komplementbyggnad
Ändamål:       bastu och yogarum
Mått:          4.5 m × 4.5 m
Vägghjöd:      2.4 m
Tak:           sadel, 25°
BYA:           20.25 m²
Nockhöjd:      3.5 m
Installationer: vatten, avlopp
```

Fields not yet set show "–".

## Notes

- Model state lives in React state on the client, initialised from tool call results via `onToolCall` callback in `useChat`
- The panel re-renders on every model state change; no page reload
- System prompt updated to instruct Claude to always call tools when geometry or context is mentioned, not just describe it in text
