# Triage Rules - Wiki Entry

## Overview

Triage determines which **bucket** a building project falls into:
- **LOVFRI** - No submission to kommun, only byggherre-dokumentation
- **ANMALAN** - Requires anmälan to kommun e-tjänst
- **BYGGLOV** - Requires full bygglovsansökan

Triage is the app's most valuable feature - most users get this wrong, leading to either hiring an architect unnecessarily or building something that triggers a sanktionsavgift.

## Regulatory Context

**Version:** PBL post-2025-12-01 (Prop 2024/25:181)

Key changes:
- Terms *friggebod* and *attefallshus* removed → **komplementbyggnad** and **komplementbostadshus**
- Anmälningsplikt for byggnationen of komplementbyggnad/-bostadshus **removed**
- Anmälan still required for: vatten, avlopp, eldstad, rökkanal, ventilation, ändrad bärande konstruktion, rivning
- Compliance enforced via **kommunal tillsyn i efterhand** with sanktionsavgifter

## Required Inputs

### Always Required
- `flow_type`: komplementbyggnad | komplementbostadshus | tillbyggnad | eldstad | plank | mur | other
- `inom_detaljplan`: boolean
- `fastighet`: fastighetsbeteckning (KOMMUN BLOCK:ENHET) + coordinates
- `huvudbyggnad`: { type, taknockshöjd_m, area_m2 }
- `existing_lovfri_buildings`: list of { type, area_m2, year_built }
- `planned_dimensions`: { area_m2, nockhöjd_m, längd_m, bredd_m }
- `planned_distance_to_gräns_m`: number (smallest to any boundary)
- `planned_distance_to_allmän_plats_m`: number | null
- `installations`: list of vatten | avlopp | eldstad | rökkanal | ventilation | ändrad_bärande_konstruktion

### Conditionally Required
- `detaljplan_id` + `detaljplan_bestämmelser`: if inom_detaljplan
- `strandskyddsläge`: if any water ≤300m away
- `k_märkning`: if within culturally protected area
- `närhet_till_järnväg_m`: if järnväg ≤50m
- `grannmedgivande_finns`: if planned_distance_to_gräns_m < 4.5

## Bucket Assignment Rules (T-001 to T-016)

Rules are evaluated **in order**. First match wins. If multiple match, highest bucket wins: BYGGLOV > ANMALAN > LOVFRI.

### Out of Scope (T-001 to T-003)

**T-001: Unsupported flow type**
- Condition: flow_type == "other" or not in supported list
- Result: out_of_scope = true
- Finding: TRIAGE-OUT-OF-SCOPE-FLOW
- Source: Product scope decision

**T-002: K-märkning**
- Condition: k_märkning == true
- Result: out_of_scope = true
- Finding: TRIAGE-OUT-OF-SCOPE-KMARKNING
- Source: PBL 8 kap 13 § (requires antikvarisk kompetens)

**T-003: No huvudbyggnad**
- Condition: flow_type in [komplementbyggnad, komplementbostadshus, tillbyggnad] AND huvudbyggnad.type != "en-/tvåbostadshus"
- Result: out_of_scope = true
- Finding: TRIAGE-NO-HUVUDBYGGNAD
- Source: PBL 9 kap 4a § (komplement requires existing en-/tvåbostadshus)

### Bygglov Buckets (T-004 to T-009)

**T-004: Strandskyddsdispens needed**
- Condition: Within strandskyddsområde (≤300m from water) AND no dispens exists
- Result: bucket = BYGGLOV
- Finding: TRIAGE-STRANDSKYDD-DISPENS-REQUIRED
- Source: Miljöbalken 7 kap 13-18 §§
- Note: Also returns OBLIGATION-STRANDSKYDD-CHECK

**T-005: Detaljplan violation**
- Condition: inom_detaljplan == true AND any detaljplan_bestämmelse violated
- Result: bucket = BYGGLOV
- Finding: TRIAGE-BYGGLOV-DETALJPLAN-CONFLICT (per violation)
- Source: PBL 9 kap 30 §
- TODO: Define which bestämmelser to check (use Boverket Planbestämmelsekatalog IDs)

**T-006: Utökad lovplikt**
- Condition: Detaljplan or områdesbestämmelser explicitly require bygglov for this flow_type
- Result: bucket = BYGGLOV
- Finding: TRIAGE-BYGGLOV-UTOKAD-LOVPLIKT
- Source: PBL 9 kap 8 §

**T-007: Komplementbyggnad/-bostadshus över pott**
- Condition: flow_type in [komplementbyggnad, komplementbostadshus] AND any of:
  - inom_detaljplan AND (existing pott + planned_area > 45 m²)
  - inom_detaljplan AND planned_area > 30 m²
  - inom_detaljplan AND planned_nockhöjd > 4.0 m
  - !inom_detaljplan AND (existing pott + planned_area > 65 m²)
  - !inom_detaljplan AND planned_area > 50 m²
  - !inom_detaljplan AND planned_nockhöjd > 4.5 m
- Result: bucket = BYGGLOV
- Finding: TRIAGE-BYGGLOV-OVER-POTT
- Source: PBL 9 kap 4a-4c §§ (post-2025-12-01)
- TODO: Verify exact paragraph numbers, confirm BYA vs BTA

**T-008: Tillbyggnad över limits**
- Condition: flow_type == tillbyggnad AND (planned_area > 30 OR planned_nockhöjd > huvudbyggnad.nockhöjd)
- Result: bucket = BYGGLOV
- Finding: TRIAGE-BYGGLOV-TILLBYGGNAD-OVER-LIMITS
- Source: PBL 9 kap 4b § (post-2025-12-01)
- TODO: Confirm 30 m² limit (was 15 m² BTA before)

**T-009: Plank eller mur**
- Condition: flow_type in [plank, mur]
- Result: bucket = BYGGLOV
- Finding: TRIAGE-BYGGLOV-PLANK-MUR
- Source: PBL 9 kap 8 §
- TODO: Document undantag for enkla plank

### Anmälningspliktig Buckets (T-010 to T-014)

**T-010: Eldstad eller rökkanal**
- Condition: flow_type == eldstad OR eldstad in installations OR rökkanal in installations
- Result: bucket = ANMALAN
- Finding: TRIAGE-ANMALAN-ELDSTAD
- Source: PBF 6 kap 5 § p.4

**T-011: Vatten/avlopp in annars-lovfri byggnad**
- Condition: bucket would be LOVFRI AND (vatten in installations OR avlopp in installations)
- Result: bucket = ANMALAN
- Finding: TRIAGE-ANMALAN-VATTEN-AVLOPP
- Source: PBF 6 kap 5 § p.5

**T-012: Bärande konstruktion**
- Condition: ändrad_bärande_konstruktion in installations
- Result: bucket = ANMALAN (unless already BYGGLOV)
- Finding: TRIAGE-ANMALAN-BARANDE
- Source: PBF 6 kap 5 § p.2

**T-013: Ventilation i flerbostadshus**
- Condition: (Out of scope - flerbostadshus not supported)

**T-014: Komplementbostadshus med boende**
- Condition: flow_type == komplementbostadshus AND intended for boende
- Result: Typically bucket = ANMALAN via T-011 or T-012
- Finding: TRIAGE-ANMALAN-KOMPLEMENTBOSTADSHUS
- Source: PBL 9 kap 4a § + PBF 6 kap 5 §
- Note: Byggnationen itself is lovfri, but installations trigger anmälan

### Lovfria Buckets (T-015 to T-016)

**T-015: Komplementbyggnad inom pott**
- Condition: flow_type == komplementbyggnad AND all T-007 checks pass AND no higher bucket assigned
- Result: bucket = LOVFRI
- Finding: TRIAGE-LOVFRI-KOMPLEMENTBYGGNAD
- Source: PBL 9 kap 4a § (post-2025-12-01)

**T-016: Tillbyggnad inom limits**
- Condition: flow_type == tillbyggnad AND T-008 did not match AND no anmäna-trigger applies
- Result: bucket = LOVFRI
- Finding: TRIAGE-LOVFRI-TILLBYGGNAD
- Source: PBL 9 kap 4b § (post-2025-12-01)

## Always-Applies Obligations (O-001 to O-007)

These apply **regardless of bucket** when conditions match.

**O-001: BBR applies**
- Condition: Always
- Finding: OBLIGATION-BBR-APPLIES
- Source: BBR (BFS 2011:6 m. ändr.)
- What: BBR teknisk standard, brandskydd, energi, tillgänglighet

**O-002: EKS applies for bärande**
- Condition: Always
- Finding: OBLIGATION-EKS-APPLIES
- Source: EKS 11 (BFS 2019:1)

**O-003: Grannmedgivande < 4.5m**
- Condition: planned_distance_to_gräns_m < 4.5 AND (allmän_plats null or > 4.5)
- Finding: OBLIGATION-GRANNMEDGIVANDE-REQUIRED
- Source: PBL 9 kap 4 §

**O-004: Avstånd till allmän plats - BLOCKING**
- Condition: planned_distance_to_allmän_plats_m != null AND < 4.5
- Finding: BLOCKING-AVSTAND-ALLMAN-PLATS (severity: blocking)
- Source: PBL 9 kap 4 §
- Note: Kommunen may grant undantag in detaljplan post-2025-12-01

**O-005: Brandskydd - närhet**
- Condition: Distance to nearest building < 8m
- Finding: OBLIGATION-BRANDSKYDD-NARHET (severity: recommendation)
- Source: BBR kap 5

**O-006: Strandskydd**
- Condition: Within 100m from strand
- Finding: OBLIGATION-STRANDSKYDD-CHECK
- Source: Miljöbalken 7 kap 14 §

**O-007: Järnvägsavstånd**
- Condition: närhet_till_järnväg_m < 30
- Finding: OBLIGATION-JARNVAG-AVSTAND
- TODO: Confirm 30m limit and source

## Pott-Calculation

The lovfri pott is **shared** across all komplementbyggnader and komplementbostadshus on the fastighet.

### Inom detaljplan
- Total BYA ≤ 45 m²
- No single building > 30 m²
- Nockhöjd ≤ 4 m

### Utanför detaljplan
- Total BYA ≤ 65 m²
- No single building > 50 m²
- Nockhöjd ≤ 4.5 m

**Formula:** sum(existing lovfri komplement buildings BYA) + planned BYA ≤ limit

**Tillbyggnader** (lovfria) have **separate** 30 m² pott - they do NOT consume komplement-pott.

## Open Questions (TODO)

1. **Exact paragraph numbers post-2025-12-01** - Verify against SFS and updated Boverket guidance
2. **BYA vs BTA in pott-calculation** - Sources disagree, need primary source
3. **Which detaljplane-bestämmelser to check in T-005** - Use Boverket Planbestämmelsekatalog IDs
4. **Plank/mur undantag** - Which enkla plank are lovfria without bygglov
5. **Strandskydd flow** - Separate process or integrated in bygglov-flow in UI
6. **Tillbyggnads-pott vs komplement-pott** - Separate or shared post-2025-12-01
7. **Utökad lovplikt identification** - How to detect per detaljplan in ingestion pipeline
8. **Existing buildings in pott-calculation** - Do pre-reform buildings count?
9. **Avstånd till allmän plats undantag** - How to detect and apply kommunens new exception

## Related Wiki Entries

- [[findings-contract]] - Finding IDs and message templates
- [[domain-model]] - Project, Packet, Finding entities
- [[packet-contract]] - Required documents per bucket
- [[komplementbyggnad-rules]] - (when split out)
- [[tillbyggnad-rules]] - (when split out)
- [[eldstad-rules]] - (when split out)

## Output Format

```typescript
{
  bucket: 'LOVFRI' | 'ANMALAN' | 'BYGGLOV' | null,
  bucket_reasons: string[],  // Finding IDs that drove the bucket
  obligations: string[],     // Finding IDs for always-applies rules
  recommended_actions: string[],  // Finding IDs (grannmedgivande, etc.)
  out_of_scope: boolean
}
```

## Source Document

This wiki entry is derived from: `/docs/triage-rules.md`

**Last updated:** 2026-05-03
**Regulatory version:** PBL post-2025-12-01 (Prop 2024/25:181)
