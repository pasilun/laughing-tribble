# Autonomous AI Dev Loop — Project Plan

A full-stack project where the AI ships features end-to-end. Patrik describes a feature in plain language; the system specs, builds, verifies, and merges it. The app being built is a **bygglov assistant** — but the auto-loop's job is to verify *the app works as specified*, not to verify the app's legal output.

## Not a demo — an MVP built by the loop

The point isn't to prove the loop exists. The point is to ship a real, usable product *using* the loop as the development method. Success is measured by whether the MVP works for a real first user — not by whether the loop is impressive.

**North-star success criterion:** Patrik submits a real anmälan or bygglovsansökan to Strängnäs kommun or Stockholms stad, for his own property, using only this app, and it's accepted without substantive remarks.

This reframe changes a few things:

- **Quality bar is real-user, not demo-user.** If it generates a ritning that gets rejected, that's a bug, not a feature roadmap entry.
- **Dogfooding is the primary acceptance test.** Patrik's Strängnäs property is the canonical end-to-end case; every simple flow must work for it before it's considered shipped.
- **Legal disclaimer surface matters.** The app must clearly communicate that it's a tool, not a lawyer or architect; that the tjänsteman agent is advisory; that the user is responsible for what they submit.
- **Data handling becomes real.** Fastighetsbeteckningar, adresser, uploaded kartor — treat as personal data from day one. No analytics on user content; encrypt at rest; delete on request.
- **Onboarding is a feature, not an afterthought.** A first-time user should be able to go from "tom sida" to "nedladdat packet" without reading docs.

The AI dev process is unchanged. The ambition of *what gets built* goes up.

## Product focus (keep it simple)

The goal is **small submissions without hiring an architect**. A private person building a friggebod, an attefallshus, a small tillbyggnad, a skärmtak, or a ny komplementbyggnad should be able to use this app to design it, generate a compliant packet, and sanity-check it before submission. Anything bigger (nybyggnad av villa, stor tillbyggnad, kommersiellt, flerbostadshus) is **out of scope** — those genuinely need a professional.

Simple flows drive everything: the 3D primitives, the detaljplan checks, the fixture set, the regulatory corpus. Don't build for the general case.

### First-class supported flows

1. **Friggebod** (bygglovsfri men regelbunden, 15 m², ≤3 m nockhöjd, ≥4,5 m från gräns)
2. **Attefallshus / komplementbostadshus** (30 m² sedan 2020, anmälan inte bygglov)
3. **Attefallstillbyggnad** (max 15 m² BTA, anmälan)
4. **Takkupor** (attefall: upp till två, anmälan)
5. **Liten tillbyggnad med bygglov** (t.ex. inglasad altan, liten utbyggnad inom detaljplan)
6. **Komplementbyggnad med bygglov** (uthus, carport, förråd under detaljplan)
7. **Plank / mur** (enkel geometri, tydliga regler)

## What the app does (the product)

A Swedish bygglov assistant in three phases:

1. **Design phase** — parametric 3D modeling in the browser (Three.js / React Three Fiber). Patrik describes a build in Swedish ("4×4 m attefallstillbyggnad mot söder, pulpettak, taklutning 14°"); app produces a 3D model. Drawings (fasad, plan, sektion) fall out of the 3D model as PDFs.
2. **Bygglov documentation phase** — RAG over PBL, BBR, the property's detaljplan, and the kommun's instructions. Generates the application or anmälan packet: situationsplan, planritningar, fasader, sektioner, teknisk beskrivning, kontrollplan. Output format matches the kommun's e-tjänst (often Mittbygge).
3. **Review phase** — a "tjänsteman agent" trained to review the packet like a kommunal handläggare. Flags missing mått, BBR-avvikelser, detaljplanekonflikter, ofullständig kontrollplan. This is a product feature, not a test.

Real test case: Patrik's country property outside Strängnäs (likely outside detaljplan, so förhandsbesked / strandskydd flows matter early — but still small structures: friggebod, attefall, ev. liten tillbyggnad).

## The three-layer separation (critical)

| Layer | What it checks | Who owns it |
|---|---|---|
| **Auto-loop verifier** | App spec compliance — does the UI behave as specified? | The loop |
| **Tjänsteman agent** | User packets vs. PBL/BBR/detaljplan | Product feature; humans curate its grounding |
| **Patrik** | Legal correctness, fixture truth, regulatory corpus updates | Human |

The verifier never makes legal judgments. The tjänsteman never validates the app. Patrik never merges code by hand unless a tripwire fires.

## Core idea: the spec is the contract

Three agents collaborate on a shared artifact (the spec markdown); the verifier never sees the diff — only the spec and a running preview.

### The three agents

1. **Spec agent** — Takes a vague feature request, explores the repo, writes `specs/<id>.md` with user stories and Gherkin-style acceptance criteria. Opens a draft PR with just the spec.
2. **Dev agent** — Reads spec + repo, implements, writes unit/integration tests, pushes to the same branch.
3. **Verification agent** — Reads *only the spec*, drives the preview deployment via Playwright MCP, returns structured pass/fail per acceptance criterion. Black-box.

Failed verification → structured report back to dev agent. Cap at 3–5 iterations before escalating to Patrik.

## Verifying the tjänsteman: golden cases

When a PR changes the tjänsteman (prompt, retrieval, scoring, model), the verifier still only checks app spec — so the tjänsteman needs its own contract.

**Golden cases**: a frozen fixture set of bygglov packets, each tagged with the findings the tjänsteman *should* return. Starter set (10–20), scoped to the first-class flows:

- A clean "pass" attefallstillbyggnad on a detaljplan-property
- A clean "pass" friggebod
- A clean "pass" komplementbyggnad with bygglov
- An attefall that exceeds 15 m² BTA (should fail)
- An attefall placed <4,5 m from gräns without grannars medgivande
- A komplementbyggnad breaching detaljplan höjd
- A packet missing kontrollplan
- A packet missing fasadritning
- A tillbyggnad outside detaljplan triggering förhandsbesked
- A structure inside strandskyddsområde

Verifier runs each packet through the agent and asserts expected findings appear (or don't). Spec-shaped, not law-shaped — legal judgment is baked into fixtures; only Patrik edits them, by hand, outside the loop.

### Acceptance criteria stay browser-observable

- *Given a packet missing kontrollplan, when the user runs review, then the findings list contains an item with severity "blocking" and category "kontrollplan".*
- *Given a clean attefallstillbyggnad packet, when the user runs review, then the summary shows "Inga blockerande anmärkningar".*
- *Given a Swedish prompt "4×4 m attefallstillbyggnad", when the user submits, then the 3D viewport contains a mesh with bounding box ≥ 4m × 4m and BTA ≤ 15 m².*

## Open data sources (Sweden)

### For case ground truth — what findings the tjänsteman should return

- **Mark- och miljööverdomstolen (MÖD)** — all avgöranden published anonymized; vägledande cases curated as referat. Primary source for legally grounded expected-findings. `domstol.se` for raw PDFs; `lagen.nu` for tagged aggregation.
- **Strandskyddsdomar.se** — curated referat by länsstyrelserna, focused on chapter 7 miljöbalken. Directly relevant to Strängnäs country-property flows (utanför detaljplan, possibly near vatten).
- **Boverket PBL kunskapsbanken** — worked examples and typfall. Useful for "pass" fixtures.

### For structured regulatory grounding — the corpus the tjänsteman reasons over

- **Boverket open APIs**:
  - Planbestämmelsekatalogen (~3,650 detaljplanebestämmelser, standardized IDs)
  - Ändamålskatalogen
  - ÖP-katalogen
  - Klimatlast / EKS-data (snölast, vindlast per ort)
  - Energideklarationer (avtal krävs)
  - Författnings-API (BBR, PBF, m.fl.)
- **Lantmäteriet** — fastighetskartor, geodata, terränghöjder
- **Stockholm dataportal** — nybyggnadskarta-underlag, 3D-LOD1/LOD2 byggnader from laser data
- **Sveriges dataportal (dataportal.se)** — aggregates kommunal öppna data
- **Kommunala geodata-portaler** — detaljplaner (GeoJSON/WMS), ortofoto, fastighetsgränser (Strängnäs kommun specifically for the test case)

### Attribution

All Boverket data requires attribution ("Boverket som källa"). Planbestämmelsekatalogen uses stable IDs — use them verbatim in the tjänsteman's citations.

## Known gap: need real "normal" passing cases

**Problem:** MÖD cases skew edge-case-heavy (they went to court *because* something was disputed). Strandskyddsdomar.se has the same bias. For fixtures to reflect the 80/20 reality, we need a corpus of *normal* submissions — packets that passed, or passed with only minor remarks — ideally for the first-class flows (friggebod, attefall, liten tillbyggnad).

**What's not openly available today:** complete bygglov-packets (ansökan + ritningar + kontrollplan + beslut) in a machine-readable bundle. A proposal to open all digital bygglovshandlingar sits on oppnadata.se but hasn't been implemented.

**Options to investigate:**

1. **Begäran om allmän handling** to Strängnäs and Stockholm kommuner for 10–30 recent avslutade small-scale cases (friggebod, attefall, komplementbyggnad). Anonymize manually if needed. Offentlighetsprincipen guarantees access; effort is in the asking and parsing PDFs.
2. **Kommunala diarium med webbsök** — some kommuner publish diarielistor online where one can identify handled cases and request docs.
3. **Boverket typfall** — whatever Boverket publishes as exemplar packets in PBL kunskapsbanken, ingest them.
4. **Community contribution** — once the app works, invite users to upload their own approved packets as future fixtures (opt-in, with consent).
5. **Synthetic passing cases** — generate plausible clean packets by inverting failed-case logic. Weaker ground truth but useful padding in early phases.

**Decision:** start with 5 hand-crafted passing fixtures (generated from Patrik's own future submissions + Boverket typfall). Expand as diarium requests land.

## Stack

- **App:** Next.js (App Router) + Prisma + SQLite locally / Postgres on Neon
- **3D:** React Three Fiber + drei + three-mesh-bvh for measurement
- **PDF:** react-pdf or pdf-lib for drawing exports
- **RAG:** pgvector on Neon
- **Deploy:** Vercel preview per PR
- **Orchestration:** GitHub Actions + Claude GitHub Action
- **Dev agent:** Claude Code headless with `CLAUDE.md`
- **Verifier:** Separate Claude session with Playwright MCP
- **Visual checks:** Playwright screenshots → multimodal Claude assertion

## Auto-merge gate

All must pass:

- Typecheck, lint, unit tests
- Preview deploy succeeds
- Verifier returns `verdict: pass` on every spec criterion
- All golden cases pass (if PR touches anything tjänsteman-adjacent)
- Diff under threshold (~400 lines, 10 files)
- No protected paths touched
- Verifier converged in ≤ N iterations

All green → GitHub auto-merge squashes. Notification via daily digest.

## Protected paths

- `/fixtures/bygglov-cases/**` — golden cases. Never agent-edited.
- `/agents/tjansteman/corpus/**` — PBL, BBR, detaljplaner, kommun-instructions.
- `/agents/tjansteman/system-prompt.md`
- Auth, payments, migrations, CI config, `CLAUDE.md`

## Tripwires

- Schema migration in the diff
- New dependency added
- Protected path touched
- Verifier passed but "ambiguous" on any criterion
- Golden cases pass with reduced confidence
- Second attempt on the same spec after a previous revert

## Post-merge safety net

1. Production smoke test (subset of golden cases) → fail = auto-revert + issue + ping
2. Daily digest — morning email listing yesterday's merges

## Manual escape hatch

- PR comments read by agents on next iteration
- Close PR to kill loop
- Push a manual commit to unstick
- Branch protection optional

## Design principles

- Verifier reads the spec, never the diff
- Verifier never makes legal judgments
- Acceptance criteria must be browser-observable
- Golden cases are the only way tjänsteman behavior changes safely
- **Simple flows first — resist scope creep toward architect-grade submissions**
- Hard cap on iteration rounds
- Patrik owns legal correctness, fixtures, corpus

## Build order

**Phase 0 — loop infrastructure**

1. Skeleton Next.js on Vercel with one trivial feature
2. `CLAUDE.md`, `/specs/` template, `/agents/` prompts
3. Workflows: spec → dev → verify → auto-merge + revert + digest

**Phase 1 — simplest flow end-to-end: friggebod**

4. Friggebod parametric model from Swedish prompt
5. Situationsplan overlay (uploaded fastighetskarta + positioned 3D footprint)
6. Fasader + plan PDF export from canonical angles
7. Tjänsteman checklist for friggebod rules only (hardcoded, no RAG yet)
8. First 3 golden cases (2 pass, 1 fail)

**Phase 2 — expand to attefall**

9. Attefallshus + attefallstillbyggnad primitives
10. Anmälan-flow (not bygglov) with correct document set
11. Takkupor
12. RAG introduced: Boverket författnings-API → PBL/BBR chunks
13. Expand fixtures to 8–10 cases

**Phase 3 — detaljplan-aware flows**

14. Detaljplan ingestion for Strängnäs and Stockholm (Planbestämmelsekatalogen IDs)
15. Komplementbyggnad med bygglov flow
16. Liten tillbyggnad med bygglov flow
17. Expand fixtures to 15–20 cases

**Phase 4 — outside detaljplan, MVP acceptance**

18. Förhandsbesked flow
19. Strandskyddsbedömning (Strandskyddsdomar.se as corpus)
20. **MVP gate: Patrik submits a real anmälan/ansökan to Strängnäs or Stockholm for his own property, using only the app.** If it's accepted without substantive remarks, MVP is shipped. If not, the remarks become the next sprint's feature requests fed into the loop.

## Open items for next session

- Draft `CLAUDE.md` + the three agent prompts
- Write GitHub Actions workflows (spec / dev / verify / merge / revert)
- Define spec markdown template + acceptance criteria DSL
- Define golden case fixture schema
- Digest channel (Slack / email / push)
- Corpus storage: in-repo vs. external with sync job
- **Diarium request template** for Strängnäs and Stockholm to source real passing cases
- Identify Boverket typfall PDFs worth ingesting as "pass" fixtures
- **Disclaimer / tone of voice** for the tjänsteman output (advisory, not authoritative)
- **Data handling policy** — fastighetsbeteckning, adresser, kartor: retention, encryption, deletion
- **Onboarding flow spec** — first-time user from empty state to downloaded packet
- **MVP acceptance plan** — which of Patrik's Strängnäs projects to use as the real submission
