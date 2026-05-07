# Findings Contract - Wiki Entry

## Overview

A **closed enum** of finding IDs the tjänsteman agent can return. This is the contract between:
- The **tjänsteman agent** - must pick from these IDs
- The **UI** - renders each ID with known shape and fix-action
- The **verifier** - asserts fixture findings by ID equality
- The **user** - sees stable, citable, actionable feedback

The enum is **large by design**. Adding a finding ID is an explicit product act, not a side effect of an agent improvising.

## Finding Shape

```typescript
// Agent output
type Finding = {
  id: FindingId;                         // From the closed enum
  variables: Record<string, string | number>;  // Fills the message_template
};

// After platform application
type ResolvedFinding = Finding & {
  severity: Severity;                    // Pinned by enum
  category: Category;                    // Pinned by enum
  source: 'TRIAGE' | 'PACKET';           // Pinned by enum
  message: string;                       // Template filled with variables
  källa: Källa;                          // Pinned by enum
  suggested_fix: SuggestedFix;           // Pinned by enum
};
```

**Agent freedoms only:** which IDs to return, what variables to fill.
**Pinned by enum:** severity, category, message template, källa, suggested_fix.

This eliminates LLM failure modes like escalating severity, hallucinating regelhänvisningar, drifting tone.

## Severity Semantics

| Severity | Gates packet? | UI treatment |
|---|---|---|
| `info` | No | Neutral note, no required action |
| `recommendation` | No | Suggested action with optional fix-button |
| `warning` | No | Highlighted, requires acknowledgment. Logged |
| `blocking` | **Yes** | Cannot finalize/download/submit until resolved |

**Blocking triage finding:** Project cannot proceed in this app.
**Blocking packet finding:** Packet cannot be downloaded or submitted.

**Warning example:** "grannmedgivande required" - doesn't block (user may have it on paper) but cannot be silently ignored.

## Källa Shape

Every entry includes källa for traceability. Boverket data requires attribution: `"Boverket som källa"`.

```typescript
type Källa = {
  typ: 'PBL' | 'PBF' | 'BBR' | 'EKS' | 'MILJOBALKEN'
      | 'DETALJPLAN' | 'BOVERKET-VAGLEDNING' | 'PRODUCT-DECISION';
  referens: string;                     // e.g. "9 kap 4a § PBL"
  url?: string;                         // Permalink if available
  attribution?: string;                 // "Boverket som källa" where required
};
```

UI renders källa as a citation under each finding. Clickable where url is present.

## Suggested Fix Shape

```typescript
type SuggestedFix =
  | { type: 'navigate'; route: string; label: string }    // Deep link in app
  | { type: 'external'; url: string; label: string }      // External link
  | { type: 'document'; doc_id: string; label: string }   // Open template
  | { type: 'none' };
```

UI renders as a button. Each finding ID has exactly one suggested_fix. Routes are templated with `{project_id}`, `{drawing_id}`.

## The Escape Hatch: OTHER-CONCERN

The agent has exactly **one** freelance ID for genuinely novel observations not grounded in known rules.

```yaml
id: OTHER-CONCERN
severity: info               # Hardcoded - never escalates
category: recommendation
source: TRIAGE | PACKET      # Either context allowed
message_template: "{free_text}"
required_variables: [free_text]
källa:
  typ: PRODUCT-DECISION
  referens: "Agent observation, not grounded in regulation"
suggested_fix: { type: none }
```

Hardcoded `info` severity means it can never block. UI flags as "AI-observation, ej regelförankrad".

System prompt instructs agent to use OTHER-CONCERN sparingly - preferably zero per packet.

## TRIAGE Source Findings

### Bucket Assignments

**TRIAGE-LOVFRI-KOMPLEMENTBYGGNAD**
- severity: info
- message: "Projektet bedöms som lovfritt. Komplementbyggnad inom potten ({area_used} av {area_max} m² använt på fastigheten)."
- källa: PBL 9 kap 4a §
- fix: navigate to byggherre-dokumentation

**TRIAGE-LOVFRI-TILLBYGGNAD**
- severity: info
- message: "Projektet bedöms som lovfritt. Tillbyggnad inom limits ({area} m² av tillåtna 30 m²)."
- källa: PBL 9 kap 4b §
- fix: navigate to byggherre-dokumentation

**TRIAGE-ANMALAN-ELDSTAD**
- severity: info
- message: "Anmälan krävs för installation av eldstad/rökkanal."
- källa: PBF 6 kap 5 § p.4
- fix: navigate to anmälan

**TRIAGE-ANMALAN-VATTEN-AVLOPP**
- severity: info
- message: "Anmälan krävs för installation av {installation}."
- källa: PBF 6 kap 5 § p.5
- fix: navigate to anmälan

**TRIAGE-ANMALAN-BARANDE**
- severity: info
- message: "Anmälan krävs för väsentlig ändring av bärande konstruktion."
- källa: PBF 6 kap 5 § p.2
- fix: navigate to anmälan

**TRIAGE-ANMALAN-KOMPLEMENTBOSTADSHUS**
- severity: info
- message: "Komplementbostadshuset i sig är lovfritt, men planerade installationer ({installations}) gör att anmälan ändå krävs."
- källa: PBL 9 kap 4a § + PBF 6 kap 5 §
- fix: navigate to anmälan

**TRIAGE-BYGGLOV-DETALJPLAN-CONFLICT**
- severity: warning
- message: "Bygglov krävs — projektet strider mot detaljplanen ({bestämmelse}: {detalj})."
- källa: PBL 9 kap 30 §
- fix: navigate to bygglov

**TRIAGE-BYGGLOV-OVER-POTT**
- severity: warning
- message: "Bygglov krävs — befintligt komplement ({area_used} m²) plus planerad byggnad ({area_planned} m²) överskrider tillåtna {area_max} m²."
- källa: PBL 9 kap 4a §
- fix: navigate to bygglov

**TRIAGE-BYGGLOV-TILLBYGGNAD-OVER-LIMITS**
- severity: warning
- message: "Bygglov krävs — tillbyggnaden ({reason}) går utanför lovfri tillbyggnad."
- källa: PBL 9 kap 4b §
- fix: navigate to bygglov

**TRIAGE-BYGGLOV-PLANK-MUR**
- severity: info
- message: "Bygglov krävs för plank/mur av denna typ."
- källa: PBL 9 kap 8 §
- fix: navigate to bygglov

**TRIAGE-BYGGLOV-UTOKAD-LOVPLIKT**
- severity: warning
- message: "Bygglov krävs — detaljplanen ({detaljplan_id}) har utökad lovplikt för denna åtgärd."
- källa: PBL 9 kap 8 §
- fix: navigate to bygglov

**TRIAGE-STRANDSKYDD-DISPENS-REQUIRED**
- severity: warning
- message: "Fastigheten ligger inom strandskyddsområde. Strandskyddsdispens krävs innan bygget får påbörjas, oavsett bygglov-status."
- källa: Miljöbalken 7 kap 13-18 §§
- fix: external link to länsstyrelsen

### Out of Scope

**TRIAGE-OUT-OF-SCOPE-FLOW**
- severity: blocking
- message: "Projekttypen ({flow_type}) ligger utanför vad denna app stöder. Kontakta en fackman eller kommunens bygglovsenhet."
- källa: PRODUCT-DECISION ("Scope: småbyggnader på en-/tvåbostadfastighet")
- fix: external link to Boverket

**TRIAGE-OUT-OF-SCOPE-KMARKNING**
- severity: blocking
- message: "Fastigheten är k-märkt eller ligger inom kulturhistoriskt skyddat område. Kontakta antikvarisk sakkunnig och kommunens bygglovsenhet."
- källa: PBL 8 kap 13 §
- fix: none

**TRIAGE-NO-HUVUDBYGGNAD**
- severity: blocking
- message: "Lovfri komplementbyggnad och tillbyggnad kräver befintligt en- eller tvåbostadshus på fastigheten. Detta saknas."
- källa: PBL 9 kap 4a §
- fix: none

### Obligations

**OBLIGATION-BBR-APPLIES**
- severity: info
- message: "BBR (Boverkets byggregler) gäller även för lovfria byggnader. Tekniska krav på brandskydd, energi och konstruktion måste uppfyllas."
- källa: BBR BFS 2011:6 m. ändr. (attribution: "Boverket som källa")
- fix: external link to BBR på Boverket

**OBLIGATION-EKS-APPLIES**
- severity: info
- message: "EKS (Boverkets konstruktionsregler) gäller för byggnadens bärande konstruktion."
- källa: EKS 11 (BFS 2019:1) (attribution: "Boverket som källa")
- fix: external link to EKS på Boverket

**OBLIGATION-GRANNMEDGIVANDE-REQUIRED**
- severity: warning
- message: "Byggnaden placeras {distance} m från tomtgräns mot {gränsgrannar}. Skriftligt grannmedgivande krävs eftersom avståndet är < 4,5 m."
- källa: PBL 9 kap 4 §
- fix: open grannmedgivande-template document

**OBLIGATION-STRANDSKYDD-CHECK**
- severity: warning
- message: "Fastigheten ligger inom 100 m från strand. Strandskyddsdispens kan krävas oavsett om åtgärden är lovfri."
- källa: Miljöbalken 7 kap 14 §
- fix: external link to länsstyrelsen

**BLOCKING-AVSTAND-ALLMAN-PLATS**
- severity: blocking
- message: "Byggnaden får inte placeras närmare än 4,5 m till allmän plats utan kommunens medgivande. Planerat avstånd: {distance} m."
- källa: PBL 9 kap 4 §
- fix: navigate to edit-position

**OBLIGATION-BRANDSKYDD-NARHET**
- severity: recommendation
- message: "Avstånd till närmaste byggnad är {distance} m. För brandskydd rekommenderar Boverket minst 8 m mellan byggnader, annars krävs särskilt brandskydd."
- källa: BBR kap 5 (attribution: "Boverket som källa")
- fix: external link to brandskydd på Boverket

## PACKET Source Findings

### Completeness

**PACKET-MISSING-SITUATIONSPLAN**
- severity: blocking
- message: "Situationsplan saknas i packetet."
- källa: PBL 9 kap 21 §
- fix: navigate to situationsplan

**PACKET-MISSING-PLANRITNING**
- severity: blocking
- message: "Planritning saknas i packetet."
- källa: PBL 9 kap 21 §
- fix: navigate to planritning

**PACKET-MISSING-FASADRITNING**
- severity: blocking
- message: "Fasadritning saknas. Saknade väderstreck: {missing_directions}."
- källa: PBL 9 kap 21 §
- fix: navigate to fasader

**PACKET-MISSING-SEKTIONSRITNING**
- severity: blocking
- message: "Sektionsritning saknas i packetet."
- källa: PBL 9 kap 21 §
- fix: navigate to sektion

**PACKET-MISSING-KONTROLLPLAN**
- severity: blocking
- message: "Kontrollplan saknas i packetet."
- källa: PBL 10 kap 6 §
- fix: navigate to kontrollplan

**PACKET-MISSING-TEKNISK-BESKRIVNING**
- severity: blocking
- message: "Teknisk beskrivning saknas i packetet."
- källa: PBL 9 kap 21 §
- fix: navigate to teknisk beskrivning

### Drawing Quality

**PACKET-DRAWING-MISSING-SCALE**
- severity: blocking
- message: "Ritning {drawing_type} saknar skala i ritningshuvudet."
- källa: BOVERKET-VAGLEDNING "Standardkrav fackmannamässiga ritningar" (attribution: "Boverket som källa")
- fix: navigate to drawing

**PACKET-DRAWING-MISSING-NORTH-ARROW**
- severity: blocking
- message: "Situationsplanen saknar norrpil."
- källa: BOVERKET-VAGLEDNING "Standardkrav situationsplan" (attribution: "Boverket som källa")
- fix: navigate to situationsplan

**PACKET-DRAWING-MISSING-MATTSATTNING**
- severity: blocking
- message: "Ritning {drawing_type} saknar tillräcklig måttsättning. Saknat: {missing}."
- källa: BOVERKET-VAGLEDNING "Standardkrav fackmannamässiga ritningar" (attribution: "Boverket som källa")
- fix: navigate to drawing

**PACKET-DRAWING-MISSING-TITLE-BLOCK-FIELD**
- severity: warning
- message: "Ritningshuvudet på {drawing_type} saknar fält: {missing_fields}."
- källa: BOVERKET-VAGLEDNING "Standardkrav ritningshuvud" (attribution: "Boverket som källa")
- fix: navigate to drawing

### Rule Violations

**PACKET-RULE-POTT-EXCEEDED**
- severity: blocking
- message: "Den ritade byggnaden ({area_actual} m²) överskrider tillsammans med befintliga komplement ({area_used} m²) tillåtna {area_max} m²."
- källa: PBL 9 kap 4a §
- fix: navigate to parameters

**PACKET-RULE-NOCKHOJD-EXCEEDED**
- severity: blocking
- message: "Ritad nockhöjd ({nockhojd_actual} m) överskrider tillåtna {nockhojd_max} m."
- källa: PBL 9 kap 4a §
- fix: navigate to parameters

**PACKET-RULE-GRANSAVSTAND-INSUFFICIENT**
- severity: warning
- message: "Avstånd till tomtgräns ({distance} m) understiger 4,5 m. Grannmedgivande krävs."
- källa: PBL 9 kap 4 §
- fix: open grannmedgivande-template

**PACKET-INCONSISTENT-DIMENSIONS**
- severity: blocking
- message: "Måtten på {drawing_a} ({value_a}) stämmer inte med {drawing_b} ({value_b})."
- källa: PRODUCT-DECISION "Internal consistency check"
- fix: navigate to drawings

## Adding a New Finding ID

1. Identify the rule and its primary source (PBL, BBR, EKS, Miljöbalken, detaljplan) or tag as `PRODUCT-DECISION`
2. Open a PR with:
   - The new enum entry in this file
   - At least one fixture exercising the new ID
   - UI rendering for the suggested_fix (if `type: navigate`)
3. **New IDs and severity changes require human approval** (merge-gate flags as `needs-human`)
4. Once merged, regenerate the agent's system prompt

The dev agent CAN open a PR adding a new ID (not a protected path), but cannot ship autonomously.

## Versioning

This contract is versioned alongside [[regulatory-version]]. When the regulatory pin changes, every finding's källa is reviewed.

IDs may be **deprecated** (marked `deprecated: true`, kept in enum for historic rendering) rather than removed.

Deprecation format:
```yaml
id: TRIAGE-LEGACY-FRIGGEBOD
deprecated: true
deprecated_since: "2025-12-01"
superseded_by: TRIAGE-LOVFRI-KOMPLEMENTBYGGNAD
```

## Related Wiki Entries

- [[triage-rules]] - Uses these finding IDs for bucket assignment
- [[domain-model]] - Finding entity in the data model
- [[regulatory-version]] - Version pinning for källa references
- [[fixture-schema]] - How golden cases assert findings by ID

## Source Document

This wiki entry is derived from: `/docs/findings-contract.md`

**Last updated:** 2026-05-03
**Status:** Living document - additions are loop-driven via PR; severity changes and källa edits are human-only
