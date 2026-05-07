# triage-rules.md

**Regulatory version:** PBL post-2025-12-01 (Prop 2024/25:181 — *Förenklingar i plan- och bygglagen*)
**Last reviewed by Patrik:** YYYY-MM-DD
**Scope:** Småbyggnader på en- eller tvåbostadsfastighet (private person, no commercial)

This document is the source of truth for triage decisions. The **tjänsteman agent** reads it. The **spec agent** references it when writing specs that touch triage. The **dev agent** does not implement triage logic from scratch — it reads this doc and implements what's here, citing rule IDs (T-001, O-003, etc.) in code comments.

When law changes, this doc is updated by Patrik manually. The regulatory-version pin at top is bumped, every dependent foundation doc and fixture is reviewed, and `findings-contract.md` is checked for orphaned IDs.

This doc does not contain UI behavior, message wording, or severity. Those live in `findings-contract.md`. This doc decides *what is true*; the contract decides *how it is communicated*.

---

## Inputs

The triage agent needs the following before it can decide. The UI's job during onboarding is to collect them in a flow that doesn't feel like a tax form.

### Required for every triage call

- `flow_type`: one of `komplementbyggnad`, `komplementbostadshus`, `tillbyggnad`, `eldstad`, `plank`, `mur`, `other`
- `inom_detaljplan`: boolean
- `fastighet`: fastighetsbeteckning (KOMMUN BLOCK:ENHET) and koordinater
- `huvudbyggnad`: `{ type: "en-/tvåbostadshus" | "annat" | "saknas", taknockshöjd_m, area_m2 }`
- `existing_lovfri_buildings`: list of `{ type, area_m2, year_built }` for pott-calculation
- `planned_dimensions`: `{ area_m2, nockhöjd_m, längd_m, bredd_m }`
- `planned_distance_to_gräns_m`: number, smallest of all gränser
- `planned_distance_to_allmän_plats_m`: number, or null if not adjacent to allmän plats
- `installations`: list, possibly empty, of any of `vatten`, `avlopp`, `eldstad`, `rökkanal`, `ventilation`, `ändrad_bärande_konstruktion`

### Conditionally required

- `detaljplan_id` and `detaljplan_bestämmelser`: if `inom_detaljplan == true`
- `strandskyddsläge`: if any vatten ≤300 m from project location
- `k_märkning`: if fastighet ligger inom kulturhistoriskt skyddat område
- `närhet_till_järnväg_m`: if järnväg ≤50 m
- `grannmedgivande_finns`: if `planned_distance_to_gräns_m < 4.5`

### Outputs

For each triage call:

- `bucket`: one of `LOVFRI`, `ANMALAN`, `BYGGLOV`, or null if `out_of_scope == true`
- `bucket_reasons`: list of finding IDs that drove the bucket assignment
- `obligations`: list of finding IDs for rules that still apply regardless of bucket
- `recommended_actions`: list of finding IDs (e.g. grannmedgivande, strandskyddsdispens-check)
- `out_of_scope`: boolean — true if app cannot help with this project

---

## Buckets and their packet contracts

### LOVFRI
- No submission to kommunen
- Output packet: byggherre-dokumentation
- Contents: design summary, rules-that-apply list, grannmedgivanden if relevant, kontrollplan for byggherrens own records, brandskyddsöversikt
- Byggherren ansvarar för tillsyn-readiness

### ANMALAN
- Submission to kommunens e-tjänst (Mittbygge or kommunens egen)
- Startbesked required before bygget påbörjas
- Output packet: anmälan + ritningar appropriate to åtgärden + kontrollplan + brandskyddsdokumentation if relevant + sakkunnig om så krävs
- Slutbesked at completion

### BYGGLOV
- Full bygglovsansökan to kommunens e-tjänst
- Beslut required before bygget påbörjas
- Output packet: ansökan + situationsplan + planritning + fasadritning + sektionsritning + teknisk beskrivning + kontrollplan + materialval/kulör

---

## Rules

Rules T-* assign the bucket. They are evaluated in the order listed below. **First match wins** for bucket assignment. Multiple bucket-rules can match — the highest bucket (BYGGLOV > ANMALAN > LOVFRI) wins.

Rules O-* return obligations and recommendations. **All matching O-rules return**, regardless of bucket.

### T-001: Out of scope — flow_type not supported
**If** `flow_type == "other"` or not in supported list
**Then** `out_of_scope = true`, finding `TRIAGE-OUT-OF-SCOPE-FLOW`
**Källa:** Internal product scope decision

### T-002: Out of scope — k-märkning
**If** `k_märkning == true`
**Then** `out_of_scope = true`, finding `TRIAGE-OUT-OF-SCOPE-KMARKNING`
**Källa:** PBL 8 kap 13 § — kräver alltid antikvarisk kompetens

### T-003: Out of scope — saknar huvudbyggnad
**If** `flow_type in [komplementbyggnad, komplementbostadshus, tillbyggnad]` and `huvudbyggnad.type != "en-/tvåbostadshus"`
**Then** `out_of_scope = true`, finding `TRIAGE-NO-HUVUDBYGGNAD`
**Källa:** PBL 9 kap 4a § — komplement förutsätter befintligt en- eller tvåbostadshus

### T-004: Bygglov — strandskyddsdispens needed
**If** project is inom strandskyddsområde (300 m from vatten enligt huvudregel) and no dispens finns
**Then** `bucket = BYGGLOV` (eller separat strandskyddsdispens-process beroende på flöde), finding `TRIAGE-STRANDSKYDD-DISPENS-REQUIRED`
**Källa:** Miljöbalken 7 kap 13–18 §§
**Note:** Strandskydd är en parallell process; även lovfria byggnader behöver dispens inom strandskyddsområde. Returnera även `OBLIGATION-STRANDSKYDD-CHECK` så användaren ser ramen.

### T-005: Bygglov — strider mot detaljplan
**If** `inom_detaljplan == true` and any `detaljplan_bestämmelse` is violated by `planned_dimensions` or `planned_position`
**Then** `bucket = BYGGLOV`, finding `TRIAGE-BYGGLOV-DETALJPLAN-CONFLICT` per violated bestämmelse
**Källa:** PBL 9 kap 30 §
**TODO Patrik:** Define which detaljplane-bestämmelser are checked. Boverkets Planbestämmelsekatalog has stable IDs for each — pick the small set that matters for komplementbyggnader och tillbyggnader (byggrätt, prickmark, korsmark, höjdbestämmelser, area-bestämmelser).

### T-006: Bygglov — utökad lovplikt i området
**If** detaljplan eller områdesbestämmelser explicitly require bygglov for the chosen `flow_type`
**Then** `bucket = BYGGLOV`, finding `TRIAGE-BYGGLOV-UTOKAD-LOVPLIKT`
**Källa:** PBL 9 kap 8 §

### T-007: Bygglov — komplementbyggnad/-bostadshus över potten
**If** `flow_type in [komplementbyggnad, komplementbostadshus]` and any of:
  - `inom_detaljplan == true` and (existing pott-användning + `planned_dimensions.area_m2` > 45 m²)
  - `inom_detaljplan == true` and `planned_dimensions.area_m2` > 30 m²
  - `inom_detaljplan == true` and `planned_dimensions.nockhöjd_m` > 4.0
  - `inom_detaljplan == false` and (existing pott-användning + `planned_dimensions.area_m2` > 65 m²)
  - `inom_detaljplan == false` and `planned_dimensions.area_m2` > 50 m²
  - `inom_detaljplan == false` and `planned_dimensions.nockhöjd_m` > 4.5
**Then** `bucket = BYGGLOV`, finding `TRIAGE-BYGGLOV-OVER-POTT` med detaljerad uträkning i variables
**Källa:** PBL 9 kap 4a–4c §§ (post-2025-12-01)
**TODO Patrik:** Verify exakta paragrafnummer mot SFS efter att Prop 2024/25:181 trätt i kraft. Verify huruvida storleksgränsen verkligen är 30/50 m² byggnadsarea (BYA) och inte bruttoarea (BTA).

### T-008: Bygglov — tillbyggnad över limits
**If** `flow_type == tillbyggnad` and (`planned_dimensions.area_m2` > 30 OR `planned_dimensions.nockhöjd_m` > `huvudbyggnad.taknockshöjd_m`)
**Then** `bucket = BYGGLOV`, finding `TRIAGE-BYGGLOV-TILLBYGGNAD-OVER-LIMITS` med specifik orsak i `reason`-variabeln
**Källa:** PBL 9 kap 4b § (post-2025-12-01)
**TODO Patrik:** Confirm 30 m²-gränsen post-2025-12-01. Tidigare gränsen var 15 m² BTA. Verify mot SFS.

### T-009: Bygglov — plank eller mur
**If** `flow_type in [plank, mur]`
**Then** `bucket = BYGGLOV`, finding `TRIAGE-BYGGLOV-PLANK-MUR`
**Källa:** PBL 9 kap 8 §
**TODO Patrik:** Codify undantag för enklare plank intill huvudbyggnad. PBL 9 kap 4 § och PBF har specifika undantag. Add as separate T-rule when codified.

### T-010: Anmälan — eldstad eller rökkanal
**If** `flow_type == eldstad` OR `eldstad in installations` OR `rökkanal in installations`
**Then** `bucket = ANMALAN`, finding `TRIAGE-ANMALAN-ELDSTAD`
**Källa:** PBF 6 kap 5 § p.4

### T-011: Anmälan — vatten/avlopp i annars-lovfri byggnad
**If** bucket would otherwise be LOVFRI and (`vatten in installations` OR `avlopp in installations`)
**Then** `bucket = ANMALAN`, finding `TRIAGE-ANMALAN-VATTEN-AVLOPP`
**Källa:** PBF 6 kap 5 § p.5

### T-012: Anmälan — bärande konstruktion
**If** `ändrad_bärande_konstruktion in installations`
**Then** `bucket = ANMALAN` (om inte redan BYGGLOV), finding `TRIAGE-ANMALAN-BARANDE`
**Källa:** PBF 6 kap 5 § p.2

### T-013: Anmälan — ventilation i flerbostadshus
**(Out of scope nuvarande version — flerbostadshus inte stöds, men dokumenterat för framtida utbyggnad.)**

### T-014: Anmälan — komplementbostadshus med boende
**If** `flow_type == komplementbostadshus` and intended for boende
**Then** typically `bucket = ANMALAN` via path T-011 (vatten/avlopp) or T-012 (bärande), finding `TRIAGE-ANMALAN-KOMPLEMENTBOSTADSHUS`
**Källa:** PBL 9 kap 4a § (byggnationen i sig är lovfri post-2025-12-01) + PBF 6 kap 5 § (installationerna utlöser anmälan)
**Note:** Pure byggnation kräver inte anmälan post-2025-12-01, men ett komplementbostadshus utan vatten/avlopp/ventilation är ovanligt i praktiken.

### T-015: Lovfri — komplementbyggnad inom potten
**If** `flow_type == komplementbyggnad`, all dimensional limits in T-007 are passed (i.e. T-007 did not match), and no other rule has assigned a higher bucket
**Then** `bucket = LOVFRI`, finding `TRIAGE-LOVFRI-KOMPLEMENTBYGGNAD`
**Källa:** PBL 9 kap 4a § (post-2025-12-01)

### T-016: Lovfri — tillbyggnad inom limits
**If** `flow_type == tillbyggnad`, T-008 did not match, and no anmälan-trigger applies
**Then** `bucket = LOVFRI`, finding `TRIAGE-LOVFRI-TILLBYGGNAD`
**Källa:** PBL 9 kap 4b § (post-2025-12-01)

---

## Always-applies obligations

Returned in `obligations` regardless of bucket, when conditions match. The user sees them as "rules that still apply to your project".

### O-001: BBR gäller alltid
For all built objects: BBR teknisk standard, brandskydd, energi (om uppvärmd), tillgänglighet (om bostad).
Finding: `OBLIGATION-BBR-APPLIES`
Källa: BBR (BFS 2011:6 m. ändr.)

### O-002: EKS gäller alltid för bärande konstruktion
Finding: `OBLIGATION-EKS-APPLIES`
Källa: EKS 11 (BFS 2019:1)

### O-003: Grannmedgivande för avstånd < 4,5 m till tomtgräns
**If** `planned_distance_to_gräns_m < 4.5` and `planned_distance_to_allmän_plats_m` is null or > 4.5
Finding: `OBLIGATION-GRANNMEDGIVANDE-REQUIRED` med variables `distance` och `gränsgrannar`
Källa: PBL 9 kap 4 §

### O-004: Avstånd till allmän plats — blocking
**If** `planned_distance_to_allmän_plats_m != null and planned_distance_to_allmän_plats_m < 4.5`
Finding: `BLOCKING-AVSTAND-ALLMAN-PLATS` (severity blocking, byggnaden får ej placeras så)
Källa: PBL 9 kap 4 §
**Note:** Kommunen kan medge undantag i sin detaljplan post-2025-12-01, men default är inte tillåtet. **TODO Patrik:** Verify undantagsregeln och om så är fallet, lägg till en check mot detaljplanens specifika bestämmelser.

### O-005: Brandskydd — närhet mellan byggnader
**If** distance to närmaste byggnad < 8 m
Finding: `OBLIGATION-BRANDSKYDD-NARHET` (severity recommendation, ej blocking — striktare brandskydd krävs men det är inte förbjudet)
Källa: BBR kap 5

### O-006: Strandskydd
**If** within 100 m from strand
Finding: `OBLIGATION-STRANDSKYDD-CHECK` — strandskyddsdispens kan krävas oavsett bygglov-status
Källa: Miljöbalken 7 kap 14 §

### O-007: Järnvägsavstånd
**If** `närhet_till_järnväg_m < 30`
Finding: `OBLIGATION-JARNVAG-AVSTAND` (typically blocking eller kräver särskilt tillstånd)
**TODO Patrik:** Confirm 30 m-gränsen och relevant källa.

---

## Pott-calculation

The lovfria potten is shared across all komplementbyggnader och komplementbostadshus on the fastighet.

**Inom detaljplan:**
- Total byggnadsarea (BYA) ≤ 45 m²
- Ingen enskild byggnad > 30 m²
- Nockhöjd ≤ 4 m

**Utanför detaljplan:**
- Total byggnadsarea ≤ 65 m²
- Ingen enskild byggnad > 50 m²
- Nockhöjd ≤ 4,5 m

Calculation: sum of BYA for all existing lovfria komplementbyggnader/komplementbostadshus on fastigheten + planned. Compare against limits.

Tillbyggnader (lovfria) have their own separate 30 m²-pott. They do not consume the komplement-pott.

**TODO Patrik:**
- Verify whether tillbyggnads-potten verkligen är separat från komplement-potten post-2025-12-01.
- Verify whether existing icke-lovfria byggnader (e.g. byggda med bygglov före reformen) räknas in i pott-räkningen eller inte.
- Verify whether komplementbyggnaden får vara större än huvudbyggnaden (gammal regel, oklart om kvarstår).

---

## Open questions for Patrik (verify against primary sources)

1. **Exakta paragrafnummer post-2025-12-01.** Verify mot SFS och uppdaterade Boverkets vägledning. Replace TODOs in T-007, T-008, O-004 with confirmed references.
2. **BYA vs BTA i pott-räkningen.** Andra-källor disagree. Primary source needed.
3. **Detaljplane-bestämmelser worth checking i T-005.** Pick the subset from Boverkets Planbestämmelsekatalog that matters för komplementbyggnader och tillbyggnader.
4. **Plank/mur-undantag.** Vilka enkla plank är lovfria utan bygglov.
5. **Strandskydd-flöde.** Separat process eller integrerat i bygglov-flödet i UI.
6. **Tillbyggnads-pott vs komplement-pott.** Separat eller delad post-2025-12-01.
7. **Utökad lovplikt.** Hur identifieras det per detaljplan i ingestion-pipelinen.
8. **Befintliga byggnader.** Hur räknar vi byggnader byggda under den gamla regimen i pott-räkningen.
9. **Avstånd till allmän plats.** Kommunens nya undantagsmöjlighet — hur upptäcks och tillämpas.

Each TODO should resolve to either an updated rule or a new T-rule. Don't ship the triage feature with TODOs unresolved.
