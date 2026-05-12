# Feature: Validation Loop + Conversation Quality

## ID
`009e-validation-loop`

## Status
`draft`

## Description

Close the design conversation loop: after each tool call, the API route validates the model against regulatory limits and injects a constraint message back into the LLM context when a limit is breached. The LLM also proactively asks for missing triage context (inomDetaljplan, installations) rather than waiting for the user to volunteer it.

## User Stories

### As a homeowner
**I want** the app to warn me immediately if my planned dimensions break a rule
**So that** I catch problems before I go further

### As a homeowner
**I want** the app to ask me the questions it needs to assess my permit type
**So that** I don't have to know which questions matter

## Acceptance Criteria

### Scenario 1: Nockhöjd limit warning — inside detaljplan

**Given** the model has `inomDetaljplan: true`
**When** the user requests a roof configuration that results in `nockhöjd > 4.0m`
**Then** the assistant response explicitly mentions the 4.0m nockhöjd limit for properties within detaljplan
**And** the assistant either suggests a corrected value or asks how to proceed

### Scenario 2: Pott limit warning — inside detaljplan

**Given** the model has `inomDetaljplan: true` and `existingPottM2: 30`
**When** the user requests a building with `bya > 15m²` (would push total over 45m²)
**Then** the assistant response mentions the 45m² total pott limit and the remaining available area

### Scenario 3: LLM asks about detaljplan when triage is pending

**Given** a BuildingModel is established but `inomDetaljplan` is null
**Then** within the next assistant response (unprompted) the assistant asks whether the property is within a detaljplan area
**And** the triage panel shows the incomplete state

### Scenario 4: LLM asks about installations for a sauna

**Given** the user has described the purpose as including a sauna or "bastu"
**And** no installations have been set
**Then** within the next assistant response the assistant asks whether the building will have running water or drainage

### Scenario 5: End-to-end — describe sauna, get ANMÄLAN

**Given** the user is on `/design` with an empty conversation
**When** the user sends "Jag ska bygga en bastu med yogarum på 20 kvadratmeter utanför detaljplan, den ska ha dusch"
**Then** within two assistant turns:
  - the model summary panel shows footprint area ~20m²
  - the triage panel shows "ANMÄLAN"
  - the floor plan SVG is visible with dimension labels

## Out of Scope

- Warnings for T-004 (strandskydd) — requires map data
- Detaljplan bestämmelse checks — requires detaljplan ingestion
- Saving or exporting the result

## Dependencies

- Specs 009a–009d completed

## Validation Logic (in `POST /api/design/chat` after each tool call)

```typescript
function validateModel(model: BuildingModel): string[] {
  const warnings: string[] = []
  const bya = model.footprint ? model.footprint.length * model.footprint.width : 0
  const nockhojd = computeNockhojd(model)

  if (model.inomDetaljplan === true) {
    if (nockhojd !== null && nockhojd > 4.0)
      warnings.push(`Nockhöjd ${nockhojd.toFixed(1)}m överskrider gränsen 4.0m inom detaljplan (PBL 9 kap 4a §).`)
    const totalPott = bya + (model.existingPottM2 ?? 0)
    if (totalPott > 45)
      warnings.push(`Total pott ${totalPott.toFixed(1)}m² överskrider gränsen 45m² inom detaljplan. Återstående: ${Math.max(0, 45 - (model.existingPottM2 ?? 0)).toFixed(1)}m².`)
    if (bya > 30)
      warnings.push(`Enskild byggnad ${bya.toFixed(1)}m² överskrider maxgränsen 30m² per byggnad inom detaljplan.`)
  }

  if (model.inomDetaljplan === false) {
    if (nockhojd !== null && nockhojd > 4.5)
      warnings.push(`Nockhöjd ${nockhojd.toFixed(1)}m överskrider gränsen 4.5m utanför detaljplan.`)
    if (bya > 50)
      warnings.push(`Enskild byggnad ${bya.toFixed(1)}m² överskrider maxgränsen 50m² per byggnad utanför detaljplan.`)
  }

  return warnings
}
```

Warnings are appended to the tool result returned to Claude:
```
[SYSTEMVARNING: <warning text>. Informera användaren och föreslå en justering.]
```

## System Prompt Additions

Add to the system prompt (beyond 009a's minimal prompt):

1. "När du känner till att byggnaden ska vara en bastu eller innehåller ett badrum, fråga alltid om det kommer finnas vatten och avlopp."
2. "Om `inomDetaljplan` inte är känt och du behöver det för triage, ställ frågan i nästa svar."
3. "Använd alltid verktyg för att uppdatera modellen när mått eller kontext nämns — beskriv inte ändringen bara i text."
4. "Nämn alltid vilket regelstycke (PBL §, BBR kap) som gäller när du varnar för en gränsvärde."

## Notes

- Unit test `validateModel` in `lib/validation.test.ts` — especially the pott boundary cases
- The end-to-end scenario (Scenario 5) is the acceptance test that proves the full 009 feature works together
- After this delivery, specs 009a–e together constitute the complete design conversation feature
