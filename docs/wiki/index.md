# Wiki Index

A catalog of all wiki entries for the bygglov assistant project.

## Core Architecture

- [[triage-rules]] - Triage decision logic: bucket assignment (T-001 to T-016) and always-applies obligations (O-001 to O-007) ✓
- [[findings-contract]] - Closed enum of finding IDs the tjänsteman agent can return (severity, category, message template, källa, suggested_fix) ✓
- [[domain-model]] - Core entities: User, Property, Project, Packet, Document, Finding, Grannmedgivande, Submission ✓

## Regulatory Foundation

- [[regulatory-version]] - Single source of truth for which PBL version the codebase assumes (currently PBL post-2025-12-01) ✓

## Product Definitions

- [[product-focus]] - First-class supported flows: komplementbyggnad, komplementbostadshus, tillbyggnad, eldstad, plank, mur
- [[real-project]] - Canonical dogfood case: 20m² sauna + yoga studio (komplementbyggnad), Patrik's property utanför detaljplan outside Strängnäs. Bucket: ANMALAN (vatten/avlopp). Strandskydd TBD.

## Flow-Specific Rules

(TODO - to be created)
- [[komplementbyggnad-rules]] - Detailed rules for komplementbyggnad flows
- [[komplementbostadshus-rules]] - Detailed rules for komplementbostadshus flows
- [[tillbyggnad-rules]] - Detailed rules for tillbyggnad flows
- [[eldstad-rules]] - Detailed rules for eldstad/rökkanal flows
- [[plank-mur-rules]] - Detailed rules for plank and mur flows

## Data & Integration

(TODO - to be created)
- [[packet-contract]] - Required documents per bucket: LOVFRI (byggherre-dokumentation), ANMALAN, BYGGLOV
- [[detaljplan-ingestion]] - How to ingest and parse detaljplaner from kommuner
- [[boverket-apis]] - Integration with Boverket open APIs: Planbestämmelsekatalogen, Ändamålskatalogen, ÖP-katalogen, Författnings-API
- [[lantmateriet-wms]] - Lantmäteriet WMS/API integration: Topowebb WMTS (background tiles, free API key), Fastighetsindelning Direkt (property boundary GeoJSON, OAuth2, free as EU HVD since 2025-02). Auth setup: register at opendata.lantmateriet.se → Geotorget consumer → apimanager.lantmateriet.se for client credentials.

## Dev Loop Infrastructure

- [[dev-loop-workflows]] - GitHub Actions workflows: spec → dev → verify → auto-merge → deploy. Independent verifier generates its own tests from spec against Vercel preview. Retry loop: verify failure → dispatches dev with failure report → dev fixes → dispatches verify. Cap: 4 commits/branch. Secrets: `ZHIPU_API_KEY`, `VERCEL_TOKEN`. Vercel SSO disabled for previews. ✓

  **Current behaviour notes (2026-05-10):**
  - `deploy.yml` runs only on `workflow_run: Auto Merge` and `workflow_dispatch` — not on every push to main.
  - `spec.yml` fails hard if the agent doesn't write the spec file via the write tool (stdout fallback removed).
  - `verify.yml` writes tests directly to `e2e/_verified-<SPEC_ID>.spec.ts`; no intermediate `_verify.spec.ts` copy step.
  - `e2e/_verify.spec.ts` is gitignored as a defensive measure.
  - `app/layout.tsx` uses `lang="sv"` and product title "Bygglov-assistenten".

  **TODO — PAT secret to simplify retry chain:**
  The current `workflow_dispatch` retry chain (verify → dispatch dev → dev dispatches verify back) exists because GitHub blocks `workflow_run` events triggered by `GITHUB_TOKEN`. Adding a single PAT secret (e.g. `LOOP_PAT`) with `repo` + `actions:write` scope would allow a clean `workflow_run` chain instead, removing the explicit "Trigger verify on retry runs" dispatch step in `dev.yml`. Not urgent, but eliminates the round-trip complexity when the time comes.

## Agent Configuration

- [[spec-agent-prompt]] - System prompt for the spec agent (`agents/spec/system-prompt.md`) ✓
- [[dev-agent-prompt]] - System prompt for the dev agent (`agents/dev/system-prompt.md`) ✓
- [[verifier-agent-prompt]] - System prompt for the verifier agent (`agents/verifier/system-prompt.md`) ✓
- [[tjansteman-agent-prompt]] - System prompt for the tjänsteman agent (product-embedded, protected path)

## Core Product Screens

- [[design-conversation-spec]] - Spec 009: LLM conversation → BuildingModel → SVG floor plan + triage panel. Claude API tool use extracts parametric model (footprint, roof, installations). Verification loop validates against regulatory limits after each tool call. Triage inputs come from conversation only — LLM asks follow-up questions. 2D SVG only for MVP. **Active — implement next.**
- [[situationsplan-spec]] - Spec 007 (revised): Place BuildingModel footprint on Lantmäteriet WMS map, measure distances to boundary, export situationsplan PDF at 1:500. Depends on spec 009 (needs BuildingModel) and Lantmäteriet API credentials.
- ~~[[planritning-spec]]~~ - Spec 008: **Superseded** by spec 009. Floor plan is now derived from BuildingModel, not entered manually. Do not implement.

## UI & UX

(TODO - to be created)
- [[ui-conventions]] - Swedish language standards, form patterns, error messages, empty states
- [[disclaimer-policy]] - What the app tells users about advisory-only nature, user responsibility, GDPR posture

## Test Fixtures

(TODO - to be created)
- [[fixture-schema]] - Structure of golden cases for tjänsteman validation
- [[golden-cases-index]] - Catalog of all golden case fixtures

## Meta

- [[wiki-index]] - This page
- [[log]] - Chronological record of wiki updates and changes

---

**Total entries:** 9 complete, 18 TODO, 1 superseded
**Last updated:** 2026-05-12 (product pivot: real project defined, design conversation + parametric model, spec 008 superseded, spec 009 active)
