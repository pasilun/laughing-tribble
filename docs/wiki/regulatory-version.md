# Regulatory Version - Wiki Entry

## Overview

The **single source of truth** for which version of Swedish bygglov-law every other foundation doc, fixture, and rule assumes.

When law changes, this is the **first edit**. Every dependent doc is then reviewed before any further work proceeds.

This is **metadata only** - it contains no rules itself. It exists so the regulatory assumption embedded in this codebase is explicit, dated, and updatable from a single point.

## Current Pin

**Pinned version:** PBL post-2025-12-01
**Pinned at:** YYYY-MM-DD by Patrik
**Källproposition:** Prop 2024/25:181 — *Förenklingar i plan- och bygglagen*

## What "post-2025-12-01" Means

Reform highlights this codebase relies on:

### Terminology Changes
- Terms *friggebod* and *attefallshus* **removed** from lagtexten
- Replaced by **komplementbyggnad** and **komplementbostadshus** as legal categories

### Anmälningsplikt Changes
- Anmälningsplikt for **byggnationen** of komplementbyggnad/-bostadshus is **removed**
- Anmäna still required for:
  - vatten
  - avlopp
  - eldstad
  - rökkanal
  - ventilation
  - ändrad bärande konstruktion
  - rivning

### Pott-Boundaries (Lovfria byggnader)

**Inom detaljplan:**
- Total: 45 m²
- Per building: max 30 m²
- Nockhöjd: max 4 m

**Utanför detaljplan:**
- Total: 65 m²
- Per building: max 50 m²
- Nockhöjd: max 4,5 m

**Lovfri tillbyggnad:**
- Max 30 m²
- Ej över huvudbyggnadens taknockshöjd

### Compliance Enforcement
- Shifted to **kommunal tillsyn i efterhand**
- Sanktionsavgifter for violations

### Other Changes
- Kommunen kan i detaljplan medge undantag från 4,5 m-avståndet till allmän plats
- BBR, EKS, Miljöbalken (strandskydd), kulturmiljölagen, riksintressen — **oförändrade**

### What is NOT in Scope of This Pin

This pin tracks **statslag and Boverkets föreskrifter only**. It does NOT track:
- Per-kommun detaljplaner (those have their own version: antagandedatum)
- Per-kommun e-tjänst format (Mittbygge versions, kommun-specifika formulär)
- BBR-versionen specifically (BBR has its own versioning; this pin assumes "current valid BBR")
- Court precedent (MÖD, mark- och miljödomstolar) - tracked separately as cited cases in fixtures

Per-kommun config lives in `/agents/tjansteman/corpus/kommuner/<kommun>.md`.

## Dependent Docs

When the pin changes, these docs **must be reviewed** for outdated rules, paragraph references, and assumptions:

**Core Rules:**
- [[triage-rules]] - every T-rule and O-rule
- [[findings-contract]] - every finding's `källa`
- [[komplementbyggnad-rules]] (if split out)
- [[tillbyggnad-rules]] (if split out)
- [[eldstad-rules]] (if split out)
- [[pott-calculation]] (if split out)

**Product:**
- [[packet-contract]] - required documents per bucket
- [[disclaimer-policy]] - references to legal regime

**Fixtures:**
- All fixtures in `/fixtures/bygglov-cases/` - expected findings may shift

## Process for Updating the Pin

1. Patrik reads the new SFS and Boverkets uppdaterade vägledning
2. Patrik updates this file: bumps `Current pin` and `Pinned at`, adds entry to changelog
3. **All dependent docs are labeled `needs-regulatory-review`**
4. Loop pauses on any PR that touches these until human review clears the label
5. Patrik works through dependent docs one at a time (or files as feature issues for the loop)
6. Fixtures are re-run against updated rules. Expected findings may need adjustment.
7. Each fixture change is a **manual commit by Patrik** (fixtures are protected)
8. Once all dependent docs reviewed and rule-change PRs merged, regulatory review is complete

**Why hard pause:** A stale rule in the corpus is worse than no rule. A user acting on triage based on outdated law could face a sanktionsavgift. The loop must not silently ship advice based on obsolete regelverk.

## Changelog

| Pin | Pinned at | By | Notes |
|---|---|---|---|
| PBL post-2025-12-01 | YYYY-MM-DD | Patrik | Initial pin. Reform per Prop 2024/25:181. Friggebod/attefall-terminologin retirerad; ersatt av komplementbyggnad/-bostadshus. Anmälningsplikten för själva byggnationen slopad för dessa. |

**When adding entries:** Newest at top. Include link to SFS or proposition. Note major regulatory shifts (not minor edits).

## Related Wiki Entries

- [[triage-rules]] - All T-rules and O-rules reference this pin
- [[findings-contract]] - All findings' källa must align with this pin
- [[komplementbyggnad-rules]] - Flow-specific rules must align
- [[tillbyggnad-rules]] - Flow-specific rules must align
- [[eldstad-rules]] - Flow-specific rules must align
- [[disclaimer-policy]] - User-facing legal regime communication

## Source Document

This wiki entry is derived from: `/docs/regulatory-version.md`

**Last updated:** 2026-05-03
**Status:** Single source of truth for regulatory assumptions
