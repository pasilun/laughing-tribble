# findings-contract.md

**Status:** living document
**Owner:** Patrik. Additions are loop-driven via PR; severity changes and källa edits are human-only and require explicit Patrik approval.

This document defines the **closed enum** of finding IDs the tjänsteman agent can return. It is the contract between:

- The **tjänsteman agent** — must pick from these IDs; cannot invent severity, källa, or message structure.
- The **UI** — renders each ID with a known shape and fix-action.
- The **verifier** — asserts fixture findings by ID equality.
- The **user** — sees stable, citable, actionable feedback that doesn't change tone or wording from one run to the next.

The enum is large by design. Adding a finding ID is an explicit product act, not a side effect of an agent improvising.

---

## Finding shape

Every finding the agent returns conforms to this shape. The agent fills only `id` and `variables`; everything else is pinned by the enum and applied by the platform after the agent returns.

```ts
type Finding = {
  id: FindingId;                         // From the enum below
  variables: Record<string, string | number>;  // Fills the message_template
};

// Resolved (post-platform-application):
type ResolvedFinding = Finding & {
  severity: Severity;                    // Pinned by enum
  category: Category;                    // Pinned by enum
  source: 'TRIAGE' | 'PACKET';           // Pinned by enum
  message: string;                       // Template filled with variables
  källa: Källa;                          // Pinned by enum
  suggested_fix: SuggestedFix;           // Pinned by enum, route templated with project_id etc.
};

type Severity = 'info' | 'recommendation' | 'warning' | 'blocking';
type Category = 'triage' | 'completeness' | 'rule' | 'recommendation' | 'obligation';
```

The agent's only freedoms: which IDs to return, and what variables to fill. **Severity, category, message template, källa, and suggested_fix are pinned by the enum.** This eliminates a class of LLM failure modes (escalating severity, hallucinating regelhänvisningar, drifting tone).

---

## Severity semantics

| Severity | Gates packet? | UI treatment |
|---|---|---|
| `info` | No | Neutral note, no required action. |
| `recommendation` | No | Suggested action with optional fix-button. |
| `warning` | No | Highlighted, requires user acknowledgment. Logged. |
| `blocking` | **Yes** | Packet cannot be finalized/downloaded/submitted until resolved. |

A `blocking` triage finding means the project cannot proceed in this app. A `blocking` packet finding means the packet cannot be downloaded or submitted.

`warning` exists for things like "grannmedgivande required" — it doesn't block, because the user may already have the medgivande on paper, but it cannot be silently ignored.

---

## Källa shape

Every enum entry includes källa for traceability. Per Boverkets attribution requirement, entries that draw on Boverket data include `attribution: "Boverket som källa"`.

```ts
type Källa = {
  typ: 'PBL' | 'PBF' | 'BBR' | 'EKS' | 'MILJOBALKEN'
     | 'DETALJPLAN' | 'BOVERKET-VAGLEDNING' | 'PRODUCT-DECISION';
  referens: string;                     // e.g. "9 kap 4a § PBL"
  url?: string;                         // Permalink if available
  attribution?: string;                 // "Boverket som källa" where required
};
```

UI renders källa as a citation under each finding. Klickbar where url is present.

---

## Suggested fix shape

```ts
type SuggestedFix =
  | { type: 'navigate'; route: string; label: string }    // Deep link in app
  | { type: 'external'; url: string; label: string }      // External link
  | { type: 'document'; doc_id: string; label: string }   // Open template (e.g. grannmedgivande)
  | { type: 'none' };
```

UI renders the fix as a button. Each finding ID has exactly one suggested_fix. Routes are templated — `{project_id}`, `{drawing_id}` substituted from finding context.

---

## The escape hatch: OTHER-CONCERN

The agent has exactly **one** freelance ID. Used when the agent spots something genuinely novel but cannot ground it in a known rule.

```yaml
- id: OTHER-CONCERN
  severity: info               # Hardcoded — never escalates
  category: recommendation
  source: TRIAGE | PACKET      # Either context allowed
  message_template: "{free_text}"
  required_variables: [free_text]
  källa:
    typ: PRODUCT-DECISION
    referens: "Agent observation, not grounded in regulation"
  suggested_fix:
    type: none
```

Hardcoded `info` severity means it can never block. UI flags these visually as "AI-observation, ej regelförankrad" so users understand the difference. The agent's system prompt instructs it to use OTHER-CONCERN sparingly — preferably zero per packet.

---

## Starter enum — TRIAGE source

### Bucket assignments

```yaml
- id: TRIAGE-LOVFRI-KOMPLEMENTBYGGNAD
  severity: info
  category: triage
  source: TRIAGE
  message_template: "Projektet bedöms som lovfritt. Komplementbyggnad inom potten ({area_used} av {area_max} m² använt på fastigheten)."
  required_variables: [area_used, area_max]
  källa: { typ: PBL, referens: "9 kap 4a § PBL" }
  suggested_fix:
    type: navigate
    route: "/project/{project_id}/byggherre-dokumentation"
    label: "Visa byggherre-dokumentation"

- id: TRIAGE-LOVFRI-TILLBYGGNAD
  severity: info
  category: triage
  source: TRIAGE
  message_template: "Projektet bedöms som lovfritt. Tillbyggnad inom limits ({area} m² av tillåtna 30 m²)."
  required_variables: [area]
  källa: { typ: PBL, referens: "9 kap 4b § PBL" }
  suggested_fix:
    type: navigate
    route: "/project/{project_id}/byggherre-dokumentation"
    label: "Visa byggherre-dokumentation"

- id: TRIAGE-ANMALAN-ELDSTAD
  severity: info
  category: triage
  source: TRIAGE
  message_template: "Anmälan krävs för installation av eldstad/rökkanal."
  required_variables: []
  källa: { typ: PBF, referens: "6 kap 5 § p.4 PBF" }
  suggested_fix:
    type: navigate
    route: "/project/{project_id}/anmalan"
    label: "Påbörja anmälan"

- id: TRIAGE-ANMALAN-VATTEN-AVLOPP
  severity: info
  category: triage
  source: TRIAGE
  message_template: "Anmälan krävs för installation av {installation}."
  required_variables: [installation]
  källa: { typ: PBF, referens: "6 kap 5 § p.5 PBF" }
  suggested_fix:
    type: navigate
    route: "/project/{project_id}/anmalan"
    label: "Påbörja anmälan"

- id: TRIAGE-ANMALAN-BARANDE
  severity: info
  category: triage
  source: TRIAGE
  message_template: "Anmälan krävs för väsentlig ändring av bärande konstruktion."
  required_variables: []
  källa: { typ: PBF, referens: "6 kap 5 § p.2 PBF" }
  suggested_fix:
    type: navigate
    route: "/project/{project_id}/anmalan"
    label: "Påbörja anmälan"

- id: TRIAGE-ANMALAN-KOMPLEMENTBOSTADSHUS
  severity: info
  category: triage
  source: TRIAGE
  message_template: "Komplementbostadshuset i sig är lovfritt, men planerade installationer ({installations}) gör att anmälan ändå krävs."
  required_variables: [installations]
  källa: { typ: PBL, referens: "9 kap 4a § PBL + PBF 6 kap 5 §" }
  suggested_fix:
    type: navigate
    route: "/project/{project_id}/anmalan"
    label: "Påbörja anmälan"

- id: TRIAGE-BYGGLOV-DETALJPLAN-CONFLICT
  severity: warning
  category: triage
  source: TRIAGE
  message_template: "Bygglov krävs — projektet strider mot detaljplanen ({bestämmelse}: {detalj})."
  required_variables: [bestämmelse, detalj]
  källa: { typ: PBL, referens: "9 kap 30 § PBL" }
  suggested_fix:
    type: navigate
    route: "/project/{project_id}/bygglov"
    label: "Påbörja bygglovsansökan"

- id: TRIAGE-BYGGLOV-OVER-POTT
  severity: warning
  category: triage
  source: TRIAGE
  message_template: "Bygglov krävs — befintligt komplement ({area_used} m²) plus planerad byggnad ({area_planned} m²) överskrider tillåtna {area_max} m²."
  required_variables: [area_used, area_planned, area_max]
  källa: { typ: PBL, referens: "9 kap 4a § PBL" }
  suggested_fix:
    type: navigate
    route: "/project/{project_id}/bygglov"
    label: "Påbörja bygglovsansökan"

- id: TRIAGE-BYGGLOV-TILLBYGGNAD-OVER-LIMITS
  severity: warning
  category: triage
  source: TRIAGE
  message_template: "Bygglov krävs — tillbyggnaden ({reason}) går utanför lovfri tillbyggnad."
  required_variables: [reason]
  källa: { typ: PBL, referens: "9 kap 4b § PBL" }
  suggested_fix:
    type: navigate
    route: "/project/{project_id}/bygglov"
    label: "Påbörja bygglovsansökan"

- id: TRIAGE-BYGGLOV-PLANK-MUR
  severity: info
  category: triage
  source: TRIAGE
  message_template: "Bygglov krävs för plank/mur av denna typ."
  required_variables: []
  källa: { typ: PBL, referens: "9 kap 8 § PBL" }
  suggested_fix:
    type: navigate
    route: "/project/{project_id}/bygglov"
    label: "Påbörja bygglovsansökan"

- id: TRIAGE-BYGGLOV-UTOKAD-LOVPLIKT
  severity: warning
  category: triage
  source: TRIAGE
  message_template: "Bygglov krävs — detaljplanen ({detaljplan_id}) har utökad lovplikt för denna åtgärd."
  required_variables: [detaljplan_id]
  källa: { typ: PBL, referens: "9 kap 8 § PBL" }
  suggested_fix:
    type: navigate
    route: "/project/{project_id}/bygglov"
    label: "Påbörja bygglovsansökan"

- id: TRIAGE-STRANDSKYDD-DISPENS-REQUIRED
  severity: warning
  category: triage
  source: TRIAGE
  message_template: "Fastigheten ligger inom strandskyddsområde. Strandskyddsdispens krävs innan bygget får påbörjas, oavsett bygglov-status."
  required_variables: []
  källa: { typ: MILJOBALKEN, referens: "7 kap 13–18 §§ Miljöbalken" }
  suggested_fix:
    type: external
    url: "https://www.lansstyrelsen.se/"
    label: "Ansök om strandskyddsdispens"
```

### Out of scope

```yaml
- id: TRIAGE-OUT-OF-SCOPE-FLOW
  severity: blocking
  category: triage
  source: TRIAGE
  message_template: "Projekttypen ({flow_type}) ligger utanför vad denna app stöder. Kontakta en fackman eller kommunens bygglovsenhet."
  required_variables: [flow_type]
  källa: { typ: PRODUCT-DECISION, referens: "Scope: småbyggnader på en-/tvåbostadsfastighet" }
  suggested_fix:
    type: external
    url: "https://www.boverket.se/"
    label: "Boverkets vägledning"

- id: TRIAGE-OUT-OF-SCOPE-KMARKNING
  severity: blocking
  category: triage
  source: TRIAGE
  message_template: "Fastigheten är k-märkt eller ligger inom kulturhistoriskt skyddat område. Kontakta antikvarisk sakkunnig och kommunens bygglovsenhet."
  required_variables: []
  källa: { typ: PBL, referens: "8 kap 13 § PBL" }
  suggested_fix: { type: none }

- id: TRIAGE-NO-HUVUDBYGGNAD
  severity: blocking
  category: triage
  source: TRIAGE
  message_template: "Lovfri komplementbyggnad och tillbyggnad kräver befintligt en- eller tvåbostadshus på fastigheten. Detta saknas."
  required_variables: []
  källa: { typ: PBL, referens: "9 kap 4a § PBL" }
  suggested_fix: { type: none }
```

### Obligations (returned alongside any bucket assignment)

```yaml
- id: OBLIGATION-BBR-APPLIES
  severity: info
  category: obligation
  source: TRIAGE
  message_template: "BBR (Boverkets byggregler) gäller även för lovfria byggnader. Tekniska krav på brandskydd, energi och konstruktion måste uppfyllas."
  required_variables: []
  källa:
    typ: BBR
    referens: "BFS 2011:6 m. ändr."
    attribution: "Boverket som källa"
  suggested_fix:
    type: external
    url: "https://www.boverket.se/sv/PBL-kunskapsbanken/regler-om-byggande/"
    label: "BBR på Boverket"

- id: OBLIGATION-EKS-APPLIES
  severity: info
  category: obligation
  source: TRIAGE
  message_template: "EKS (Boverkets konstruktionsregler) gäller för byggnadens bärande konstruktion."
  required_variables: []
  källa:
    typ: EKS
    referens: "EKS 11 (BFS 2019:1)"
    attribution: "Boverket som källa"
  suggested_fix:
    type: external
    url: "https://www.boverket.se/sv/byggande/regler-for-byggande/om-boverkets-konstruktionsregler-eks/"
    label: "EKS på Boverket"

- id: OBLIGATION-GRANNMEDGIVANDE-REQUIRED
  severity: warning
  category: obligation
  source: TRIAGE
  message_template: "Byggnaden placeras {distance} m från tomtgräns mot {gränsgrannar}. Skriftligt grannmedgivande krävs eftersom avståndet är < 4,5 m."
  required_variables: [distance, gränsgrannar]
  källa: { typ: PBL, referens: "9 kap 4 § PBL" }
  suggested_fix:
    type: document
    doc_id: "grannmedgivande-template"
    label: "Öppna grannmedgivande-mall"

- id: OBLIGATION-STRANDSKYDD-CHECK
  severity: warning
  category: obligation
  source: TRIAGE
  message_template: "Fastigheten ligger inom 100 m från strand. Strandskyddsdispens kan krävas oavsett om åtgärden är lovfri."
  required_variables: []
  källa: { typ: MILJOBALKEN, referens: "7 kap 14 § Miljöbalken" }
  suggested_fix:
    type: external
    url: "https://www.lansstyrelsen.se/"
    label: "Mer om strandskyddsdispens"

- id: BLOCKING-AVSTAND-ALLMAN-PLATS
  severity: blocking
  category: rule
  source: TRIAGE
  message_template: "Byggnaden får inte placeras närmare än 4,5 m till allmän plats utan kommunens medgivande. Planerat avstånd: {distance} m."
  required_variables: [distance]
  källa: { typ: PBL, referens: "9 kap 4 § PBL" }
  suggested_fix:
    type: navigate
    route: "/project/{project_id}/edit-position"
    label: "Justera placering"

- id: OBLIGATION-BRANDSKYDD-NARHET
  severity: recommendation
  category: recommendation
  source: TRIAGE
  message_template: "Avstånd till närmaste byggnad är {distance} m. För brandskydd rekommenderar Boverket minst 8 m mellan byggnader, annars krävs särskilt brandskydd."
  required_variables: [distance]
  källa:
    typ: BBR
    referens: "BBR kap 5"
    attribution: "Boverket som källa"
  suggested_fix:
    type: external
    url: "https://www.boverket.se/sv/byggande/sakerhet/brandskydd/"
    label: "Brandskydd på Boverket"
```

---

## Starter enum — PACKET source

### Completeness

```yaml
- id: PACKET-MISSING-SITUATIONSPLAN
  severity: blocking
  category: completeness
  source: PACKET
  message_template: "Situationsplan saknas i packetet."
  required_variables: []
  källa: { typ: PBL, referens: "9 kap 21 § PBL" }
  suggested_fix:
    type: navigate
    route: "/project/{project_id}/situationsplan"
    label: "Skapa situationsplan"

- id: PACKET-MISSING-PLANRITNING
  severity: blocking
  category: completeness
  source: PACKET
  message_template: "Planritning saknas i packetet."
  required_variables: []
  källa: { typ: PBL, referens: "9 kap 21 § PBL" }
  suggested_fix:
    type: navigate
    route: "/project/{project_id}/planritning"
    label: "Skapa planritning"

- id: PACKET-MISSING-FASADRITNING
  severity: blocking
  category: completeness
  source: PACKET
  message_template: "Fasadritning saknas. Saknade väderstreck: {missing_directions}."
  required_variables: [missing_directions]
  källa: { typ: PBL, referens: "9 kap 21 § PBL" }
  suggested_fix:
    type: navigate
    route: "/project/{project_id}/fasader"
    label: "Skapa fasadritningar"

- id: PACKET-MISSING-SEKTIONSRITNING
  severity: blocking
  category: completeness
  source: PACKET
  message_template: "Sektionsritning saknas i packetet."
  required_variables: []
  källa: { typ: PBL, referens: "9 kap 21 § PBL" }
  suggested_fix:
    type: navigate
    route: "/project/{project_id}/sektion"
    label: "Skapa sektionsritning"

- id: PACKET-MISSING-KONTROLLPLAN
  severity: blocking
  category: completeness
  source: PACKET
  message_template: "Kontrollplan saknas i packetet."
  required_variables: []
  källa: { typ: PBL, referens: "10 kap 6 § PBL" }
  suggested_fix:
    type: navigate
    route: "/project/{project_id}/kontrollplan"
    label: "Skapa kontrollplan"

- id: PACKET-MISSING-TEKNISK-BESKRIVNING
  severity: blocking
  category: completeness
  source: PACKET
  message_template: "Teknisk beskrivning saknas i packetet."
  required_variables: []
  källa: { typ: PBL, referens: "9 kap 21 § PBL" }
  suggested_fix:
    type: navigate
    route: "/project/{project_id}/teknisk-beskrivning"
    label: "Skapa teknisk beskrivning"
```

### Drawing quality

```yaml
- id: PACKET-DRAWING-MISSING-SCALE
  severity: blocking
  category: completeness
  source: PACKET
  message_template: "Ritning {drawing_type} saknar skala i ritningshuvudet."
  required_variables: [drawing_type]
  källa:
    typ: BOVERKET-VAGLEDNING
    referens: "Standardkrav fackmannamässiga ritningar"
    attribution: "Boverket som källa"
  suggested_fix:
    type: navigate
    route: "/project/{project_id}/drawings/{drawing_id}"
    label: "Justera ritningen"

- id: PACKET-DRAWING-MISSING-NORTH-ARROW
  severity: blocking
  category: completeness
  source: PACKET
  message_template: "Situationsplanen saknar norrpil."
  required_variables: []
  källa:
    typ: BOVERKET-VAGLEDNING
    referens: "Standardkrav situationsplan"
    attribution: "Boverket som källa"
  suggested_fix:
    type: navigate
    route: "/project/{project_id}/situationsplan"
    label: "Justera situationsplan"

- id: PACKET-DRAWING-MISSING-MATTSATTNING
  severity: blocking
  category: completeness
  source: PACKET
  message_template: "Ritning {drawing_type} saknar tillräcklig måttsättning. Saknat: {missing}."
  required_variables: [drawing_type, missing]
  källa:
    typ: BOVERKET-VAGLEDNING
    referens: "Standardkrav fackmannamässiga ritningar"
    attribution: "Boverket som källa"
  suggested_fix:
    type: navigate
    route: "/project/{project_id}/drawings/{drawing_id}"
    label: "Justera ritningen"

- id: PACKET-DRAWING-MISSING-TITLE-BLOCK-FIELD
  severity: warning
  category: completeness
  source: PACKET
  message_template: "Ritningshuvudet på {drawing_type} saknar fält: {missing_fields}."
  required_variables: [drawing_type, missing_fields]
  källa:
    typ: BOVERKET-VAGLEDNING
    referens: "Standardkrav ritningshuvud (fastighetsbeteckning, ritningstyp, skala, format, datum, namn)"
    attribution: "Boverket som källa"
  suggested_fix:
    type: navigate
    route: "/project/{project_id}/drawings/{drawing_id}"
    label: "Justera ritningshuvud"
```

### Rule violations at packet-finalization time

```yaml
- id: PACKET-RULE-POTT-EXCEEDED
  severity: blocking
  category: rule
  source: PACKET
  message_template: "Den ritade byggnaden ({area_actual} m²) överskrider tillsammans med befintliga komplement ({area_used} m²) tillåtna {area_max} m²."
  required_variables: [area_actual, area_used, area_max]
  källa: { typ: PBL, referens: "9 kap 4a § PBL" }
  suggested_fix:
    type: navigate
    route: "/project/{project_id}/parameters"
    label: "Justera dimensionerna"

- id: PACKET-RULE-NOCKHOJD-EXCEEDED
  severity: blocking
  category: rule
  source: PACKET
  message_template: "Ritad nockhöjd ({nockhojd_actual} m) överskrider tillåtna {nockhojd_max} m."
  required_variables: [nockhojd_actual, nockhojd_max]
  källa: { typ: PBL, referens: "9 kap 4a § PBL" }
  suggested_fix:
    type: navigate
    route: "/project/{project_id}/parameters"
    label: "Justera takhöjden"

- id: PACKET-RULE-GRANSAVSTAND-INSUFFICIENT
  severity: warning
  category: rule
  source: PACKET
  message_template: "Avstånd till tomtgräns ({distance} m) understiger 4,5 m. Grannmedgivande krävs."
  required_variables: [distance]
  källa: { typ: PBL, referens: "9 kap 4 § PBL" }
  suggested_fix:
    type: document
    doc_id: "grannmedgivande-template"
    label: "Öppna grannmedgivande-mall"

- id: PACKET-INCONSISTENT-DIMENSIONS
  severity: blocking
  category: rule
  source: PACKET
  message_template: "Måtten på {drawing_a} ({value_a}) stämmer inte med {drawing_b} ({value_b})."
  required_variables: [drawing_a, value_a, drawing_b, value_b]
  källa: { typ: PRODUCT-DECISION, referens: "Internal consistency check" }
  suggested_fix:
    type: navigate
    route: "/project/{project_id}/drawings"
    label: "Granska ritningar"
```

---

## Process: adding a new finding ID

1. Identify the rule the finding represents. It must trace to a primary source (PBL, BBR, EKS, Miljöbalken, eller en konkret detaljplan) or be explicitly tagged `PRODUCT-DECISION`.
2. Open a PR with three things in the same diff:
   - The new enum entry in this file
   - At least one fixture that exercises the new ID (in `/fixtures/bygglov-cases/`)
   - The UI rendering for the suggested_fix route, if `type: navigate`
3. Patrik reviews. **New IDs and severity changes require human approval.** The merge-gate flags any change to `findings-contract.md` as `needs-human` regardless of other green checks.
4. Once merged, the agent's system prompt is regenerated to include the new enum entry.

The dev agent CAN open a PR adding a new ID (it's not a protected path in the strictest sense — it's just gated). It cannot ship one autonomously.

---

## Versioning

This contract is versioned alongside `regulatory-version.md`. When the regulatory pin changes, every finding's källa is reviewed.

Some IDs may be **deprecated** (kept in the enum, marked `deprecated: true`, agent told not to emit, UI renders historic instances) rather than removed. This keeps already-produced packets renderable indefinitely.

Format for deprecation:

```yaml
- id: TRIAGE-LEGACY-FRIGGEBOD
  deprecated: true
  deprecated_since: "2025-12-01"
  superseded_by: TRIAGE-LOVFRI-KOMPLEMENTBYGGNAD
  # ... rest of original entry preserved for historic rendering
```
