# regulatory-version.md

**Current pin:** PBL post-2025-12-01
**Pinned at:** YYYY-MM-DD by Patrik
**Källproposition:** Prop 2024/25:181 — *Förenklingar i plan- och bygglagen*

This document is the **single source of truth** for which version of Swedish bygglov-law every other foundation doc, fixture, and rule assumes. When law changes, this is the first edit. Every dependent doc is then reviewed before any further work proceeds.

This is metadata. It contains no rules itself. It exists so that the regulatory assumption embedded in this codebase is explicit, dated, and updatable from a single point.

---

## What "post-2025-12-01" means

Reform highlights this codebase relies on:

- The terms *friggebod* and *attefallshus* are removed from lagtexten. Replaced by **komplementbyggnad** and **komplementbostadshus** as legal categories.
- Anmälningsplikt for the byggnationen of a komplementbyggnad/-bostadshus is **slopad**. Anmälan still required for installations (vatten, avlopp, eldstad, rökkanal, ventilation, ändrad bärande konstruktion) and for rivning.
- Lovfri pott: 45 m² inom detaljplan, 65 m² utanför.
- Per-byggnad: max 30 m² / 4 m nockhöjd inom detaljplan, max 50 m² / 4,5 m utanför.
- Lovfri tillbyggnad: 30 m², ej över huvudbyggnadens taknockshöjd.
- Compliance shifted to **kommunal tillsyn i efterhand**. Sanktionsavgifter for violations.
- Kommunen kan i sin detaljplan medge undantag från 4,5 m-avståndet till allmän plats.
- BBR, EKS, Miljöbalken (strandskydd), kulturmiljölagen, riksintressen — oförändrade och gäller fortfarande.

Detailed rules live in `triage-rules.md` and the per-flow rule docs. This file lists only what changed and when.

---

## Dependent docs (review on every pin change)

Changing the pin requires reviewing each of these for outdated rules, paragraph references, and assumptions:

- `triage-rules.md` — every T-rule and O-rule
- `findings-contract.md` — every finding's `källa`
- `komplementbyggnad-rules.md` (if/when split out from triage-rules)
- `tillbyggnad-rules.md` (ditto)
- `eldstad-rules.md`
- `pott-calculation.md`
- `packet-contract.md` — required documents per bucket
- `disclaimer-policy.md` — references to legal regime
- All fixtures in `/fixtures/bygglov-cases/` — expected findings may shift

---

## Process for updating the pin

1. Patrik reads the new SFS and Boverkets uppdaterade vägledning.
2. Patrik updates this file: bumps `Current pin` and `Pinned at`, adds entry to changelog below.
3. **All dependent docs are labeled `needs-regulatory-review`.** Loop pauses on any PR that touches these until human review clears the label.
4. Patrik works through dependent docs one at a time (or files them as feature issues for the loop, where the change is mechanical).
5. Fixtures are re-run against updated rules. Expected findings may need adjustment. Each fixture change is a manual commit by Patrik (fixtures are protected).
6. Once all dependent docs are reviewed and any rule-change PRs merged, the regulatory review is complete. Loop resumes normal operation.

The reason this is a hard pause: a stale rule in the corpus is worse than no rule. A user acting on a triage decision based on outdated law could face a sanktionsavgift. The loop must not silently ship advice based on obsolete regelverk.

---

## What is NOT in scope of this pin

The pin tracks **statslag and Boverkets föreskrifter**. It does not track:

- Per-kommun detaljplaner — those have their own version (typically antagandedatum).
- Per-kommun e-tjänst format — Mittbygge versions, kommun-specifika ansökningsformulär.
- BBR-versionen specifically (BBR has its own versioning; this pin assumes "current valid BBR" and dependent docs cite specific BFS-numbers).
- Court precedent (MÖD, mark- och miljödomstolar) — relevant for tjänsteman grounding but tracked separately as cited cases in fixtures.

A separate per-kommun config (`/agents/tjansteman/corpus/kommuner/<kommun>.md`) tracks kommun-specific particulars.

---

## Changelog

| Pin | Pinned at | By | Notes |
|---|---|---|---|
| PBL post-2025-12-01 | YYYY-MM-DD | Patrik | Initial pin. Reform per Prop 2024/25:181 in effect. Friggebod/attefall-terminologin retirerad i lag; ersatt av komplementbyggnad/-bostadshus. Anmälningsplikten för själva byggnationen slopad för dessa. |

When adding entries: newest at top. Include link to SFS or proposition. Note the major regulatory shifts (not minor edits).
