# Feature: Triage Panel

## ID
`009d-triage-panel`

## Status
`draft`

## Description

A live triage panel on the design screen that runs the bucket-assignment rules against the BuildingModel and displays the result: LOVFRI, ANMÄLAN, or BYGGLOV, with reasons. The triage logic lives in `lib/triage.ts` as a pure function — this same function will back the tjänsteman agent later.

## User Stories

### As a homeowner
**I want** to see what permit type my project requires as I describe it
**So that** I know early whether I need to submit an anmälan or apply for bygglov

## Acceptance Criteria

### Scenario 1: Triage panel absent before enough context

**Given** the user has only described the building size (no property context)
**Then** no triage bucket is shown
**And** a note such as "Mer information behövs för att bedöma lovplikt" is visible in the triage area

### Scenario 2: LOVFRI result shown

**Given** the model has `flowType: komplementbyggnad`, `inomDetaljplan: false`, footprint ≤ 50m², no installations
**Then** the triage panel shows "LOVFRI"
**And** at least one reason is listed

### Scenario 3: ANMÄLAN triggered by installation

**Given** the triage result is LOVFRI
**When** the model gains an installation of type `vatten` or `avlopp`
**Then** the triage panel updates to show "ANMÄLAN"
**And** the reason references vatten/avlopp

### Scenario 4: ANMÄLAN triggered by eldstad

**Given** the model has `flowType: komplementbyggnad`, `inomDetaljplan: false`, no other installations
**When** the model gains an installation of type `eldstad`
**Then** the triage panel shows "ANMÄLAN"
**And** the reason references eldstad/rökkanal

### Scenario 5: Triage panel updates without page reload

**Given** the triage panel shows "LOVFRI"
**When** the model state changes (new installation added via conversation)
**Then** the triage panel updates in place to "ANMÄLAN" without a page reload

## Verifier Hints

- After describing only building size (no inomDetaljplan), `[data-testid="triage-bucket"]` must NOT be visible; `[data-testid="triage-incomplete"]` must be visible — if bucket appears before enough context is set, the triage logic is wrong
- To get LOVFRI: send "Jag vill bygga en komplementbyggnad 4×4 meter, det är utanför detaljplan och inga installationer" — wait up to 20s for `[data-testid="triage-bucket"]` to show text containing "LOVFRI"; also check `[data-testid="triage-reasons"]` has at least one item
- Then send "Den ska ha en eldstad" — within 15s `[data-testid="triage-bucket"]` must change to "ANMÄLAN" and `[data-testid="triage-reasons"]` must mention "eldstad" or "rökkanal"
- The bucket change (LOVFRI → ANMÄLAN) must happen WITHOUT a page reload; verify by checking the conversation messages are still visible after the update
- `[data-testid="triage-bucket"]` must NOT contain "null", "undefined", or be empty — if the LLM responds but the panel doesn't update, the tool call → state update chain is broken

## Out of Scope

- Detaljplan conflict checks (T-005, T-006) — requires detaljplan data not yet available
- Strandskydd detection (T-004) — requires map data
- All obligation findings (O-001 to O-007) — shown in a later delivery
- BYGGLOV bucket from pott overflow — include the pott check but no detaljplan conflicts

## Dependencies

- Spec 009b completed (BuildingModel in React state)
- Triage rules documented in `docs/wiki/triage-rules.md`

## Triage Rules to Implement (subset for this spec)

Implement in `lib/triage.ts` as `runTriage(model: BuildingModel): TriageResult`:

| Rule | Condition | Bucket |
|---|---|---|
| T-007 (partial) | inom_detaljplan AND bya > 30m² | BYGGLOV |
| T-007 (partial) | !inom_detaljplan AND bya > 50m² | BYGGLOV |
| T-010 | eldstad or rokkanal in installations | ANMÄLAN |
| T-011 | vatten or avlopp in installations | ANMÄLAN |
| T-015 | komplementbyggnad, all checks pass | LOVFRI |

Return type:
```typescript
interface TriageResult {
  bucket: 'LOVFRI' | 'ANMÄLAN' | 'BYGGLOV' | null  // null = insufficient data
  reasons: string[]   // human-readable Swedish, one per matched rule
  incomplete: boolean // true if inomDetaljplan is unknown
}
```

## Triage Panel UI

```
┌──────────────────────┐
│  Lovplikt            │
│  ● ANMÄLAN           │
│                      │
│  Orsaker:            │
│  • Vatten/avlopp     │
│    (PBF 6 kap 5 §)   │
│                      │
│  ℹ Mer info behövs   │
│    om detaljplan     │
└──────────────────────┘
```

- Bucket shown in large text, colour-coded: LOVFRI = green, ANMÄLAN = amber, BYGGLOV = red
- `data-testid="triage-bucket"` on the bucket text element
- `data-testid="triage-reasons"` on the reasons list
- `data-testid="triage-incomplete"` on the incomplete notice (hidden when not incomplete)

## Notes

- `runTriage` is a pure function with no side effects — easy to unit test
- Write unit tests in `lib/triage.test.ts` covering all scenarios above
- The triage panel calls `runTriage` on every render with the current model — no debouncing needed at this scale
