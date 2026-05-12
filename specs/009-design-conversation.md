# Feature: Design Conversation + Parametric Model

## ID
`009-design-conversation`

## Status
`draft`

## Description

A conversational design screen where the user describes their building project in Swedish natural language. Claude extracts a strict parametric BuildingModel via tool calls and displays a live SVG floor plan plus a triage result panel. The LLM asks follow-up questions when regulatory context is missing. The model — not the drawing — is the source of truth.

## User Stories

### As a homeowner
**I want** to describe my planned building in plain Swedish
**So that** I get a dimensioned floor plan and know what permit I need, without filling out forms

### As a homeowner
**I want** the app to tell me when my dimensions exceed regulatory limits
**So that** I can adjust the design before going further

### As a homeowner
**I want** the app to ask me follow-up questions about my property
**So that** the triage result is accurate without me having to understand the rules myself

## Acceptance Criteria

All criteria must be browser-observable via Playwright.

### Scenario 1: Initial design from description

**Given** the user is on `/design`
**When** the user types "Jag vill bygga en bastu med yogarum, ungefär 20 kvadratmeter" and submits
**Then** a response appears in the conversation within 10 seconds
**And** an SVG floor plan appears or updates on the right side of the screen
**And** the floor plan contains at least one rectangle with visible dimension labels

### Scenario 2: Model updates on follow-up

**Given** a BuildingModel has been established in the conversation
**When** the user types "Gör den lite bredare, 5 meter bred"
**Then** the SVG floor plan updates to reflect the new width
**And** the dimension label on the floor plan shows the updated value

### Scenario 3: Validation loop — limit exceeded

**Given** a BuildingModel exists with the property context `inomDetaljplan: true`
**When** the user requests dimensions resulting in `nockhöjd > 4.0m`
**Then** the assistant response mentions that the ridge height exceeds the 4.0m limit for properties within detaljplan
**And** the assistant either suggests an adjusted dimension or asks how to proceed

### Scenario 4: Triage panel appears

**Given** a BuildingModel exists with `flowType: komplementbyggnad`
**When** the user has provided enough context for a triage determination
**Then** a triage panel is visible on the page
**And** the panel shows one of: "LOVFRI", "ANMÄLAN", or "BYGGLOV"
**And** the panel lists at least one reason for the determination

### Scenario 5: LLM asks for missing triage context

**Given** a BuildingModel exists but `inomDetaljplan` is unknown
**Then** the assistant asks whether the property is within a detaljplan area
**And** the triage panel shows an incomplete state until the question is answered

### Scenario 6: Installation triggers ANMÄLAN

**Given** a BuildingModel with `inomDetaljplan: false` and no installations (would be LOVFRI)
**When** the user says "Den kommer ha dusch och avlopp"
**Then** the triage panel updates to show "ANMÄLAN"
**And** the reason references vatten/avlopp

## Out of Scope

- 3D rendering (deferred)
- Situationsplan / map placement (spec 007)
- PDF export (separate spec)
- Saving/persisting projects across sessions (future)
- Multi-room or non-rectangular floor plans
- Windows and doors in the floor plan (positions only, no detailed joinery)

## Dependencies

- `ANTHROPIC_API_KEY` environment variable set in Vercel and `.env.local`
- Vercel AI SDK (`ai` package) + `@ai-sdk/anthropic`
- No database changes required for MVP — model state lives in conversation memory

## Data Model

The LLM maintains and updates the following model via tool calls:

```typescript
interface BuildingModel {
  purpose: string                    // e.g. "bastu och yogarum"
  flowType: 'komplementbyggnad' | 'komplementbostadshus' | 'tillbyggnad' | null
  footprint: { length: number; width: number } | null   // metres
  wallHeight: number | null          // metres
  roof: {
    type: 'sadel' | 'pulpet' | 'flat' | null
    pitch: number | null             // degrees
  }
  // Triage context — extracted from conversation
  inomDetaljplan: boolean | null
  distanceToGrans: number | null     // metres, smallest to any boundary
  installations: Array<'vatten' | 'avlopp' | 'eldstad' | 'rokkanal' | 'ventilation'>
  existingPottM2: number | null      // sum of existing lovfri buildings on property
}
```

Computed properties (never stored, always derived):
- `bya = footprint.length × footprint.width`
- `nockhöjd` = wallHeight + roof geometry (sadel: `(length/2) × tan(pitch°)`)

## LLM Tools

The system prompt gives Claude four tools:

```
set_building(purpose, flowType, footprint, wallHeight, roof)
  — sets or updates building geometry and intent

set_triage_context(inomDetaljplan, distanceToGrans, existingPottM2)
  — sets property context for triage

add_installation(type)
  — adds vatten | avlopp | eldstad | rokkanal | ventilation

remove_installation(type)
  — removes an installation
```

After each tool call the API route:
1. Recomputes derived values (bya, nockhöjd)
2. Runs triage rules against the updated model
3. Checks regulatory limits (pott, nockhöjd cap)
4. If a limit is breached, appends a constraint note to the tool result so the LLM sees it in the next turn

## Screen Layout

```
/design
┌─────────────────────┬───────────────────────────┐
│  Conversation       │  Floor plan (SVG)          │
│  (left, scrollable) │  updates live              │
│                     │                            │
│                     ├───────────────────────────┤
│                     │  Triage                    │
│                     │  ANMÄLAN / LOVFRI / BYGGLOV│
│                     │  ↳ reasons list            │
│  [text input]       │                            │
└─────────────────────┴───────────────────────────┘
```

On mobile: conversation full-width, floor plan + triage stacked below.

## SVG Floor Plan Requirements

- Rectangle representing building footprint to scale
- Dimension labels on all four sides (length × width in metres)
- BYA shown below the plan ("Byggnadsarea: X m²")
- Nockhöjd shown if roof is set ("Nockhöjd: X.X m")
- Scale bar (not a fixed scale — fits the viewport)
- North arrow (placeholder, fixed orientation for MVP)
- Updates without full page reload when model changes

## Notes

- The route for the AI conversation is `POST /api/design/chat`
- Stream the response using Vercel AI SDK `streamText` with tool support
- The system prompt must instruct Claude to: (1) always use tools to update the model rather than describing changes in text only, (2) ask for `inomDetaljplan` early if not volunteered, (3) mention vatten/avlopp when the user describes a sauna/bathroom, (4) cite the specific regulatory limit when warning about exceeded values
- Triage logic is the same rules engine as will back the tjänsteman — implement as a pure function `runTriage(model): TriageResult` in `lib/triage.ts`
- For the verifier: after sending a message that updates dimensions, wait for the SVG to update before asserting dimension labels (poll for attribute change, max 5s)
