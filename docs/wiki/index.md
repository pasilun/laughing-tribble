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

## IFC Pipeline

- [[ifc-pipeline]] — IFC4 STEP generator + web-ifc viewer: double-placement trap, void geometry, wall topology, roof-wall junction, WASM loading, SVG Y-flip, door symbol, screenshot verification discipline ✓

## Dev Loop Infrastructure

- [[dev-loop-workflows]] - GitHub Actions: spec → dev → verify → auto-merge → deploy. Independent interactive Playwright verifier against a Vercel preview. ✓

  **Current behaviour (2026-05-18 — see [[log]] 2026-05-18 entry):**
  - **Attempt cap** = `LOOP_MAX_ATTEMPTS` repo var (3), read by `dev.yml` + `verify.yml`. Counter = commits-ahead-of-main on the cumulative `feat/<spec>` branch (no force-push; empty commit on no-op). Every failure comments `Attempt N/MAX`.
  - **Escalation**: after the cap, one attempt on `zai-coding-plan/glm-5.1`, gated by the `escalation` GitHub Environment (manual approval). Exhaustion opens a `🆘` issue. Cross-workflow chain uses `LOOP_PAT` (the old PAT TODO — **done**); failed dispatch opens a loud issue.
  - **Spec status lifecycle**: `active` (binding; requires an existing regression test, enforced by `spec-guard.yml`), `planned` (not built), `superseded`/`obsolete` (tombstone/delete), `chore` (transient, auto-pruned after merge). New capabilities are `planned`; the dev cycle creates the test and flips `planned → active` in the same PR.
  - **spec.yml** path-agnostic + resilient to a rogue self-committing agent; the spec agent must not run git/gh. **dev.yml** skips superseded tombstones when selecting the spec and creates a PR when no *open* PR exists.
  - **Verifier feedback** is lossless + evidence-rich (network/console captured; full structured verdict in a `VERIFY-VERDICT` PR comment; dev prompt built from a file).
  - **deploy.yml**: deterministic `_verified-*` contract suite runs vs a fresh **preview** (fake); separate environment-agnostic **production smoke**.
  - **actionlint CI** gates all workflow changes; agent tooling pinned (`opencode-ai@1.15.3`, `@playwright/mcp@0.0.75`, `vercel@54.1.0`).
  - **Loop is product-agnostic**: `CLAUDE.md` is the loop contract + invariants; product domain in [[product-context]] (`docs/product-context.md`). Secrets: `ZHIPU_API_KEY`, `VERCEL_TOKEN`/`VERCEL_ORG_ID`/`VERCEL_PROJECT_ID`, `LOOP_PAT`; vars: `LOOP_MAX_ATTEMPTS`, `PROD_URL`.

## Agent Configuration

- [[spec-agent-prompt]] - System prompt for the spec agent (`agents/spec/system-prompt.md`) ✓
- [[dev-agent-prompt]] - System prompt for the dev agent (`agents/dev/system-prompt.md`) ✓
- [[verifier-agent-prompt]] - System prompt for the verifier agent (`agents/verifier/system-prompt.md`) ✓
- [[tjansteman-agent-prompt]] - System prompt for the tjänsteman agent (product-embedded, protected path)

## Capability Specs (the living specification — `specs/`)

**Active (built + genuinely verified):**
- [[landing-page]] — homepage: headline, single `Kom igång` CTA → `/design`. ✓
- [[design-screen]] — `/design` streaming chat shell; Scenario 3 genuinely re-verified via the seam. ✓
- [[footer]] — global copyright footer on every page. ✓
- [[deterministic-chat-seam]] — `/api/design/chat` serves a deterministic mock model in preview (real model in prod), so the loop can verify chat without an LLM key. **First chat capability shipped fully autonomously.** ✓

**Planned (roadmap, not built):**
- [[009b-building-model-tools]] → [[building-model-extraction]] / [[building-model-panel]] / [[building-model-computed]] — chat tool-calls → structured BuildingModel (split for loop-sized delivery).
- [[009c-floor-plan-svg]] — dimensioned SVG floor plan from the BuildingModel.
- [[009d-triage-panel]] — live LOVFRI/ANMÄLAN/BYGGLOV verdict from the model.
- [[009e-validation-loop]] — API validates the model vs regulatory limits, feeds constraints back.
- [[007-situationsplan]] — footprint on a Lantmäteriet map, boundary distances, PDF (needs Lantmäteriet creds).

**Superseded/obsolete:** spec 008 (planritning, → 009 line), 009/009a, and the old delta specs (001–006, 010) — tombstoned during the re-baseline.

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

**Last updated:** 2026-05-25 — [[ifc-pipeline]] added: 9 lessons from the IFC STEP generator + web-ifc viewer spike (double-placement trap, void geometry, wall topology, roof soffit, WASM loading, SVG Y-inversion, door symbol, screenshot-first discipline). See [[log]] 2026-05-25.

**Previously:** 2026-05-18 — loop hardened (3-attempt cap + glm-5.1 escalation gate, actionlint, pinned tooling, lossless verifier feedback, contract-vs-preview regression); spec corpus re-baselined into a living specification; loop decoupled from product ([[product-context]]); first chat capability ([[deterministic-chat-seam]]) shipped fully autonomously; [[design-screen]] genuinely re-verified. See [[log]] 2026-05-18.
