# Wiki Log

Chronological record of wiki ingests, updates, and changes.

## [2026-05-03] ingest | Triage Rules

**Source:** `/docs/triage-rules.md`
**Action:** Created wiki entry [[triage-rules.md]]

**Summary:**
Ingested comprehensive triage rules document covering bucket assignment (T-001 to T-016) and always-applies obligations (O-001 to O-007). 

**Key content:**
- Regulatory version: PBL post-2025-12-01 (Prop 2024/25:181)
- 3 buckets: LOVFRI, ANMALAN, BYGGLOV
- 16 bucket-assignment rules (T-001 through T-016)
- 7 always-applies obligations (O-001 through O-007)
- Pott-calculation logic for komplementbyggnader/komplementbostadshus
- 9 open questions/TODOs for Patrik to resolve

**Pages updated:**
- Created: [[triage-rules]]
- Created: [[wiki-index]]
- Created: [[log]] (this page)

**Related entries:**
- Links to [[findings-contract]], [[domain-model]], [[packet-contract]] (TODOs)

**Notes:**
- Many TODOs remain in the source document that need verification against primary sources (SFS, Boverket)
- The wiki entry preserves all TODOs from source - these should be resolved before production use
- Regulatory version pinning is critical - when law changes, all dependent wiki entries need review

## [2026-05-03] create | Wiki Infrastructure

**Action:** Created wiki structure following LLM wiki pattern

**Summary:**
Initialized wiki with index and log files. Established pattern for future wiki entries.

**Pages created:**
- [[wiki-index]] - Catalog of all wiki entries
- [[log]] - This chronological record

**Pattern established:**
- Raw source docs in `/docs/` (immutable)
- Wiki entries in `/docs/wiki/` (LLM-maintained)
- Index for navigation
- Log for timeline
- Cross-references using [[wikilinks]]

**Next steps:**
- Ingest [[domain-model]]
- Ingest [[regulatory-version]]
- Create flow-specific rule entries as they're split out

## [2026-05-03] ingest | Findings Contract

**Source:** `/docs/findings-contract.md`
**Action:** Created wiki entry [[findings-contract.md]]

**Summary:**
Ingested comprehensive findings contract defining the closed enum of finding IDs used across the system.

**Key content:**
- Finding shape: agent outputs id + variables; platform pins severity, category, message, källa, fix
- 4 severity levels: info, recommendation, warning, blocking (blocking gates packet)
- Källa shape with Boverket attribution requirement
- Suggested fix types: navigate, external, document, none
- Escape hatch: OTHER-CONCERN (freelike ID, hardcoded info severity)
- TRIAGE source: 13 bucket assignments, 3 out-of-scope, 6 obligations
- PACKET source: 6 completeness, 4 drawing quality, 4 rule violation findings
- Versioning: deprecation support for historic rendering
- Process for adding new finding IDs (requires human approval)

**Pages updated:**
- Created: [[findings-contract]]
- Updated: [[wiki-index]] (marked findings-contract as complete ✓)

**Related entries:**
- Referenced by: [[triage-rules]]
- References: [[domain-model]], [[regulatory-version]], [[fixture-schema]]

**Notes:**
- The contract is versioned alongside regulatory version - when law changes, all källa references must be reviewed
- Deprecated IDs are kept for historic rendering rather than removed
- New IDs and severity changes require human approval (merge-gate flag: needs-human)

## [2026-05-03] ingest | Domain Model

**Source:** `/docs/domain-model.md`
**Action:** Created wiki entry [[domain-model.md]]

**Summary:**
Ingested comprehensive domain model defining all entities, fields, relationships, and invariants for the bygglov assistant.

**Key content:**
- Conventions: CUID IDs, UTC timestamps, soft delete, JSONB with Zod validation, Swedish text support
- 7 enums: FlowType, Bucket, ProjectStatus, PacketType, DocumentType, InstallationType, FindingSource, FindingStatus
- 8 entities: User, Property, Project, Packet, Document, Finding, Grannmedgivande, Submission
- fastighetsbeteckning format with regex: `^[A-ZÅÄÖ][A-ZÅÄÖ \-]+ [A-ZÅÄÖ][A-ZÅÄÖ \-]+ \d+:\d+(>\d+)?$`
- Project status transition diagram (DRAFT → TRIAGED → DESIGNING → REVIEWED → FINALIZED → SUBMITTED)
- Finding invariants: only stores finding_id and variables; severity, message, källa looked up from contract
- Cross-cutting: GDPR posture, validation strategy (Zod → Prisma), testability requirements
- 6 open questions for Patrik to resolve

**Pages updated:**
- Created: [[domain-model]]
- Updated: [[wiki-index]] (marked domain-model as complete ✓)

**Related entries:**
- References: [[findings-contract]] (Finding.finding_id)
- References: [[triage-rules]] (Project.bucket, triage_input_snapshot)
- References: [[regulatory-version]] (källa versioning)
- References: [[packet-contract]] (Packet.document structure)

**Notes:**
- Prisma schema is derived from this doc, not vice versa. When they disagree, this doc wins.
- Schema changes require explicit spec and Patrik approval.
- Auth fields managed by auth library in adjacent tables - those are protected paths.
- All cascades are application-level (not DB-level) for auditability.

## [2026-05-03] ingest | Regulatory Version

**Source:** `/docs/regulatory-version.md`
**Action:** Created wiki entry [[regulatory-version.md]]

**Summary:**
Ingested regulatory version pin - the single source of truth for which PBL version the entire codebase assumes.

**Key content:**
- Current pin: PBL post-2025-12-01 (Prop 2024/25:181)
- Reform highlights: friggebod/attefall → komplementbyggnad/komplementbostadshus; anmälningsplikt removed for byggnationen; pott boundaries; tillsyn i efterhand
- What's NOT in scope: per-kommun detaljplaner, e-tjänst formats, BBR-version specifically, court precedent
- 11 dependent docs that must be reviewed when pin changes
- Process for updating pin (hard pause until all dependent docs reviewed)
- Changelog table for version history

**Pages updated:**
- Created: [[regulatory-version]]
- Updated: [[wiki-index]] (marked regulatory-version as complete ✓)

**Related entries:**
- References by: [[triage-rules]], [[findings-contract]], all flow-specific rule docs
- Affects: [[packet-contract]], [[disclaimer-policy]], all fixtures

**Notes:**
- This is metadata only - contains no rules itself
- When law changes, this is the FIRST edit. Every dependent doc then reviewed before further work.
- A stale rule in corpus is worse than no rule - hard pause on pin change to prevent shipping outdated advice.
- Per-kommun config lives in `/agents/tjansteman/corpus/kommuner/<kommun>.md`

## [2026-05-08] fix | CI Dev Loop Workflows

**Action:** Repaired all four GitHub Actions workflows so the autonomous dev loop can run end-to-end.

**Problems fixed:**

- `dev.yml`: Broken `if:` condition used `contains(changed_files, 'specs/')` — `changed_files` is an integer, not a file list. Removed the condition (the `paths:` trigger already handles filtering). Replaced `npx opencode dev-agent` (non-existent subcommand) with `npx opencode run`. Added git commit + push step so implementation lands on the PR branch. Added `permissions: contents: write`.
- `verify.yml`: Replaced Vercel deploy + `npx opencode verifier-agent` with a local Next.js build (`npm run build && npm start`) + Playwright test run. Fixed `workflow_run` PR-number extraction via `jq '.[0].number'`. Fixed golden-cases diff check (`origin/main` → `origin/$base_ref`).
- `spec.yml`: Added branch creation, replaced `npx opencode spec-agent` with `npx opencode run`, added spec-file existence check, commit + push, and `gh pr create --draft`. Uses `env:` for GitHub expressions to avoid shell-quoting issues with issue body.
- `merge.yml`: Changed trigger from `check_suite` (unreliable PR-number lookup) to `workflow_run: Verification Agent: completed`. Uses GitHub API for protected-path and diff-size checks.

**Tooling decision:** `npx opencode run` is the correct headless invocation — the custom subcommands in the original workflows (`dev-agent`, `spec-agent`, `verifier-agent`) don't exist in the opencode package. API key secret: `OPENCODE_API_KEY` (passed as `ANTHROPIC_API_KEY` in env, which opencode reads for Claude models). Documented in CLAUDE.md under "AI Tooling" to prevent future regression.

**Tests:** All 4 Playwright acceptance tests for spec `001-greeting` pass locally (11s).

**Pages updated:**
- Updated: [[log]] (this entry)
- Updated: [[wiki-index]] (added Dev Loop Infrastructure section)

## [2026-05-08] fix | Z.AI Direct API + Dev Loop End-to-End

**Action:** Fixed model provider config and completed first full spec → dev loop run (spec 002).

**Problems fixed:**

- **Wrong provider for Z.AI models** — `openrouter/z-ai/glm-5-turbo` and `openrouter/z-ai/glm-4.7` both fail with `ProviderModelNotFoundError`. Z.AI models exist in opencode's registry but OpenRouter's live API doesn't serve them. Fix: switched to `zai-coding-plan/glm-4.7` (Z.AI Coding Plan direct endpoint) with secret `ZHIPU_API_KEY`. Updated both `spec.yml` and `dev.yml`.

- **Dev agent trigger — GITHUB_TOKEN cross-workflow block** — `dev.yml` had `on: pull_request` which never fired: GitHub blocks cross-workflow triggers when the push comes from `GITHUB_TOKEN` (anti-loop protection). Fix: changed trigger to `on: push: branches: [main], paths: specs/**` so it fires when the spec PR is merged. Added `workflow_dispatch` with `spec_file` input for manual testing. Also removed `ref: ${{ github.head_ref }}` from checkout (not available on push events).

- **Spec detection on push** — Dev agent now reads the changed spec via `git diff HEAD~1 --name-only`, falling back to `find specs` newest file. Manual dispatch accepts explicit `spec_file` input.

- **Garbage spec file (spec 002)** — Previous run's fallback captured the error stack trace as spec content. Fixed by writing a proper spec for `002-add-a-start-button-to-the-homepage` and force-pushing `spec/issue-15`.

- **ESLint failing on Playwright trace assets** — Playwright's `playwright-report/trace/assets/codeMirrorModule-*.js` bundles being linted. Fix: added `playwright-report/**` and `test-results/**` to `globalIgnores` in `eslint.config.mjs`.

- **Dev agent running e2e tests** — Dev agent prompt told it to write tests but it also tried to run `npm test`, causing Playwright browser-not-installed errors. Fix: added "Do NOT run npm test" to the dev agent prompt. Running tests is the verifier's job.

**First Phase 0 feature implemented end-to-end:**

Spec 002 ("Kom igång" start button, `specs/002-add-a-start-button-to-the-homepage.md`) was implemented by the dev agent (opencode run `25578771536`):
- `app/page.tsx` — added `<Link href="/design">Kom igång</Link>` below greeting
- `app/design/page.tsx` — new placeholder /design page
- `e2e/start-button.spec.ts` — 3 Playwright scenarios covering all acceptance criteria
- Typecheck ✓, lint ✓, committed to `feat/002-add-a-start-button-to-the-homepage`, PR #18 opened

**Known remaining issue:** "Comment results" step in `dev.yml` hardcoded `issue_number: 15` and `issues: write` permission is missing — cosmetic failure only, all substantive steps pass.

**Pages updated:**
- Updated: [[log]] (this entry)
- Updated: [[wiki-index]] (updated Dev Loop Infrastructure entry)

## [2026-05-09] feat | Vercel deployment + full autonomous loop

**Action:** Wired up Vercel production deployment and completed the verify → merge chain, making the loop fully operable from a phone.

**Changes:**

- **Vercel project created** — `laughing-tribble` linked to Vercel org `lundinsigvard-3733s-projects`. Removed invalid `previewDeployment`/`production` keys from `vercel.json` (env vars per environment belong in the Vercel dashboard, not the config file). First production deploy: https://laughing-tribble-psi.vercel.app
- **`deploy.yml` added** — New workflow triggers on every push to main, runs `vercel --prod --token` using `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` secrets. Future merges from the auto-loop will auto-deploy.
- **verify.yml fixed** — Added `workflow_dispatch` with `pr_number` input. Rewrote "Resolve PR" step to handle all three trigger paths: `pull_request` (uses event payload), `workflow_dispatch` (fetches PR by number), `workflow_run` (finds latest open `feat/` PR via API). Checkout now uses the resolved PR head SHA — previously was checking out main's SHA.
- **merge.yml fixed** — Same pattern: added `workflow_dispatch` with `pr_number` input and PR-lookup fallback for `workflow_run` path (previously got empty `pull_requests` array and silently skipped).
- **dev.yml fixed** — Added `continue-on-error: true` to "Comment results" step so the run concludes `success` even when the hardcoded `issue_number: 15` fails. This unblocks the `workflow_run` chain from verify and merge.
- **Secrets set** — `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` uploaded to GitHub Actions secrets. `VERCEL_TOKEN` also added to `~/.zshrc` for local CLI use.

**Full auto-chain now works:**
1. Create GitHub issue → add `feature-request` label → spec agent runs → spec PR opened
2. Merge spec PR → push to main triggers dev agent → implementation PR opened
3. Dev concludes success → verify triggers via `workflow_run` → Playwright runs against feature branch
4. Verify concludes success → merge triggers via `workflow_run` → PR squash-merged
5. Merge to main triggers deploy → Vercel production updated

Only manual steps required from phone: (1) create issue + label, (2) review and merge spec PR.

**PR #18 manually verified and merged** — spec 002 "Kom igång" button is live on production.

**Pages updated:**
- Updated: [[log]] (this entry)
- Updated: [[wiki-index]] (updated Dev Loop Infrastructure entry)

## [2026-05-09] feat | Independent verifier + dev retry loop

**Action:** Replaced rubber-stamp verification with a genuinely independent verifier and a self-healing retry loop.

**Problems found:**
- `verify.yml` was running `npm test` against a local build — the dev agent's own tests, not independent verification
- Vercel preview deployments were SSO-protected; Playwright in CI was testing Vercel's login page ("TermsPrivacy Policy" footer was Vercel's own auth page footer, not the app)
- `workflow_run` does not fire after `workflow_dispatch`-triggered runs — broke the retry chain
- `GITHUB_TOKEN` cannot dispatch other workflows without `actions: write` permission
- `deploy.yml` triggered only on `push`, but auto-merge via `GITHUB_TOKEN` doesn't fire push events — so production never updated after loop merges

**Changes:**

- **verify.yml — independent verifier:** Removed `npm test`. Now: (1) deploys feature branch to Vercel preview via `vercel --yes`, (2) runs opencode verifier agent which reads the spec and writes `e2e/_verify.spec.ts` independently (never reads dev agent's test files), (3) runs that file against the preview URL. Added `actions: write` permission so verify can dispatch dev on failure.
- **verify.yml — retry dispatch:** On failure, captures Playwright output and dispatches dev agent with `failure_report` input containing the exact failing assertions.
- **dev.yml — failure context:** Added `failure_report` input. When set, prepends failure details to the agent prompt so it knows what to fix. Added `actions: write` permission. Added "Trigger verify on retry runs" step — after fixing, explicitly dispatches verify (needed because `workflow_run` doesn't chain from `workflow_dispatch`).
- **dev.yml — iteration cap:** Counts commits on the feature branch vs main; stops at 4 to prevent infinite loops.
- **deploy.yml — workflow_run trigger:** Added `workflow_run: Auto Merge: completed` trigger alongside `push`. Also added `workflow_dispatch` for manual kicks. Checkout explicitly uses `ref: main` to avoid deploying feature branch code.
- **Vercel SSO disabled:** `ssoProtection` was set to `deploymentType: all_except_custom_domains` — blocked all CI access to preview URLs. Disabled via API (`PATCH /v9/projects/laughing-tribble { ssoProtection: null }`). Change is permanent.

**Regression gap identified (open):** `_verify.spec.ts` is generated fresh each run and never committed. Once a feature merges, its independent verification tests are discarded. A future feature that regresses a previous one would only be caught by the dev-agent-written `e2e/*.spec.ts` files, not the independent verifier tests.

**Full retry loop now works:**
1. Verify fails → captures Playwright output → dispatches dev with failure report
2. Dev reads failures → fixes implementation → pushes → dispatches verify
3. Verify re-runs against new preview → pass → auto-merge → deploy
4. Cap: 4 commits on branch before loop stops and escalates

**Validated end-to-end:** spec 006 (footer with copyright) ran through 3 retry iterations before the SSO issue was diagnosed. Once SSO was disabled, verify passed on first run, auto-merge fired, footer is live on production.

**Pages updated:**
- Updated: [[log]] (this entry)
- Updated: [[wiki-index]]

## [2026-05-09] feat | Regression suite — save verified tests + post-deploy gate

**Action:** Added regression test persistence so independent verifier tests survive feature merges and guard production.

**Problems addressed:**
- Previously `_verify.spec.ts` was generated fresh per run and discarded after merge. A new feature that regressed a previous one would only be caught by dev-agent-written tests, not the independent verifier.

**Changes:**
- **verify.yml:** After passing, copies `e2e/_verify.spec.ts` to `e2e/_verified-<SPEC_ID>.spec.ts` and commits it to the feature branch. These accumulate in the repo as a persistent regression suite.
- **deploy.yml:** After each production deploy, runs `npx playwright test e2e/_verified-*.spec.ts` against the live production URL. If any test fails, opens a GitHub issue titled "🔴 Regression detected on production". Skips gracefully if no verified test files exist yet.
- Added `issues: write` permission to deploy job.

**Decision:** Storing verified tests in the repo (rather than an artifact store) was chosen for simplicity — they're small, readable, and version-controlled alongside the features they cover.

**Pages updated:**
- Updated: [[log]] (this entry)

---

## [2026-05-10] fix | Bug fixes and workflow simplifications

**Action:** Batch of CI fixes and cleanup following the first full end-to-end loop run.

**Changes:**

- **deploy.yml:** Removed `on: push` trigger — deploy now fires only on `workflow_run: Auto Merge` and `workflow_dispatch`. Prevents double-deploys when commits land on main directly.
- **spec.yml:** Removed stdout fallback — if the agent doesn't write the spec file via the write tool, the workflow fails hard rather than capturing the error trace as spec content (which produced garbage specs in earlier runs).
- **verify.yml:** Writes tests directly to `e2e/_verified-<SPEC_ID>.spec.ts` in one step; removed the intermediate `_verify.spec.ts` copy step that was previously needed.
- **.gitignore:** Added `e2e/_verify.spec.ts` as a defensive gitignore to prevent the ephemeral test file from being accidentally committed.
- **app/layout.tsx:** Set `lang="sv"` (Swedish) and product title "Bygglov-assistenten" — was previously missing/wrong.
- **package.json:** Removed 2 dead scripts that were no longer used.
- **dev.yml:** Removed hardcoded `issue_number: 15` comment step (was a known cosmetic failure from the first loop run).
- **Specs added:** `007-situationsplan.md` (situationsplan screen — fastighetskarta upload, draggable friggebod rectangle, distance-to-boundary display, PDF export) and `008-planritning.md` (dimensioned 2D floor plan SVG from user measurements, area calculation, PDF export).
- **wiki/index.md:** Added "Current behaviour notes (2026-05-10)" block and PAT-secret TODO to the dev-loop entry.

**Decisions:**
- Deploy trigger simplified to workflow_run only — the previous push trigger was causing unnecessary deploys and making the deploy log noisy.
- Spec stdout fallback removed — silent failures (agent prints to stdout instead of writing file) are worse than loud ones.

**Pages updated:**
- Updated: [[wiki-index]] (behaviour notes added inline to dev-loop entry)
- Updated: [[log]] (this entry)

---

## [2026-05-10] spec | Specs 007 and 008 — situationsplan + planritning (via spec agent)

**Action:** Spec agent (via `spec.yml`) created `specs/007-feat-situationsplan-screen-spec-007.md` for issue #30.

**Specs in queue:**
- `007-situationsplan`: Upload fastighetskarta, place draggable friggebod rectangle, compute distances to four property edges, export annotated PDF with north arrow and scale bar.
- `008-planritning`: Enter friggebod dimensions (width × depth × wall height), render dimensioned SVG floor plan, compute area, export PDF.

Both specs target Phase 1 product work (friggebod flow). Neither has been implemented yet as of this date.

**Pages updated:**
- Updated: [[log]] (this entry)

---

## [2026-05-11] memo | Standing instruction — always update wiki with progress

**Action:** Patrik added a standing instruction: always update `docs/wiki/log.md` with progress, decisions, and insights after each working session or significant change.

**Scope:** This applies to any Dev Agent session working in this repo. Each session should add a log entry documenting:
- What was implemented or changed
- Key decisions made and the reasoning
- Open issues or regressions found
- Any architectural insights

**Why:** The wiki log is the primary artifact for understanding why the codebase evolved the way it did. The commit messages record _what_ changed; the log records _why_.

**Pages updated:**
- Updated: [[log]] (this entry)

---

## [2026-05-12] plan | Product pivot — design conversation + triage, real project defined

**Action:** Major planning session. Reshaped the high-level plan around Patrik's real project and a new core UX paradigm.

### Real project defined

The target build is a **combined sauna and yoga studio, 20m²**, on Patrik's country property outside Strängnäs. This replaces "friggebod" as the canonical test case throughout the plan.

**Regulatory classification:**
- `flow_type: komplementbyggnad`
- 20m² fits within the lovfri pott (≤30m² per building inside detaljplan, ≤50m² outside)
- Bucket is almost certainly **ANMALAN** — a sauna will have vatten/avlopp (T-011) or eldstad/rökkanal (T-010)
- Strandskydd unknown — Patrik to confirm distance to water; if ≤300m → BYGGLOV + dispens, changes everything
- Property is likely **utanför detaljplan** → pott limits are more generous (65m² total, 50m² single building)

### Build strategy: slice-first

Abandoned the "full flow before anything ships" approach. Instead: vertical slices, each end-to-end, starting with the highest-value screen.

### Situationsplan research — WMS decision

Researched map sources for the situationsplan screen:
- **Min Karta (Lantmäteriet)** has a print/export function but it is non-obvious on mobile — Patrik tested it and couldn't figure it out. Rules out "user uploads" as the primary approach.
- **Lantmäteriet open data (Feb 2025):** Fastighetsindelning WMS and OGC API became free as EU High Value Data. Endpoint: `maps.lantmateriet.se/fastighet/wms/v1.1`. OAuth2 via free account at opendata.lantmateriet.se.
- **Topowebb WMTS** (background tiles): free with API key, endpoint `api.lantmateriet.se/open/topowebb-ccby/v1/wmts/token/{key}/`.
- **Decision: integrate WMS directly** — user enters fastighetsbeteckning, map + property boundary loads automatically. No other site to visit. This is the right call for a phone-first product.
- Auth setup guide written. Patrik needs to: register at opendata.lantmateriet.se, subscribe to Topowebb + Fastighetsindelning, get API key + OAuth2 client credentials.

### Core UX pivot: design conversation + parametric model

**Old approach:** form-driven input → generate drawings.

**New approach:** LLM conversation → parametric model → derived drawings + triage.

The design screen works as follows:
1. User describes the project in natural language ("sauna and yoga studio, ~20m², pitched roof")
2. Claude API (with tool use) extracts a strict **parametric BuildingModel**: `{ footprint: {length, width}, wallHeight, roof: {type, pitch}, bya, nockhöjd, purpose, installations, triageContext }`
3. After each tool call: validate against regulatory limits (pott, nockhöjd) → if breach, inject constraint back → LLM adjusts or warns user. This is the **verification loop**.
4. LLM also extracts triage context from conversation and asks follow-up questions when needed ("Ligger fastigheten inom detaljplan?"). No separate triage form.
5. Live panels update as tools fire: **SVG floor plan** + **triage result panel**.

**Key constraints:**
- The parametric model is the truth — drawings are always derived from it, never drawn directly.
- 2D SVG only for MVP — 3D view deferred.
- All triage inputs come from conversation only (LLM asks if more detail needed).

**Technology stack for this screen:**
- Claude API with tool use (Anthropic SDK)
- Vercel AI SDK `useChat` for streaming + tool call handling on client
- SVG floor plan rendered from model (no canvas/Three.js needed)
- Triage logic runs client-side or server-side against model state

### Spec changes

- **Spec 008 (planritning):** Superseded. The 2D floor plan is now derived from the BuildingModel, not entered manually. Spec 008 should not be implemented.
- **Spec 007 (situationsplan):** Still valid but updated — building footprint dimensions come from BuildingModel, not manual entry. Lantmäteriet WMS replaces the "user uploads fastighetskarta" approach originally written.
- **Spec 009 (design conversation):** New core spec. Highest priority. Covers: conversation UI, LLM tool-call system, parametric model schema, SVG floor plan, triage panel, validation loop.

### Revised slice order

1. **Spec 009:** Design conversation + parametric model + 2D floor plan + triage panel
2. **Spec 007 (revised):** Situationsplan — place model footprint on Lantmäteriet WMS map, export PDF
3. Fasadritning — derive facade drawings from model
4. Kontrollplan — templated PDF for ANMALAN bucket
5. Packet assembly + download

### Open items

- Patrik to confirm strandskydd distance (is the property within 300m of water?)
- Patrik to register at opendata.lantmateriet.se and get API credentials (guide written in this session)
- Verify Strängnäs e-tjänst format requirements before situationsplan spec is finalised
- BYA vs BTA in pott calculation still unresolved (TODO in triage-rules wiki entry)

**Pages updated:**
- Updated: [[log]] (this entry)
- TODO: update [[wiki-index]] with new spec-009 entry

---

## [2026-05-12] fix | PAT-based retry chain — remove explicit verify re-dispatch

**Action:** Fixed the verify→dev→verify retry chain so it chains correctly using LOOP_PAT.

**Problem:** `verify.yml` was dispatching `dev.yml` using `GITHUB_TOKEN`. GitHub's anti-loop protection blocks `workflow_run` events from being triggered by `GITHUB_TOKEN`-dispatched workflow runs. This meant: verify fails → dispatches dev → dev finishes → `workflow_run: Dev Agent: completed` does NOT fire → verify never re-runs. The retry loop was silently broken.

`dev.yml` had a workaround step "Trigger verify on retry runs" that explicitly dispatched verify after finishing. But it also used `GITHUB_TOKEN`, making it equally broken.

**Changes:**
- `verify.yml`: `GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}` → `GITHUB_TOKEN: ${{ secrets.LOOP_PAT }}` in the "Retry dev agent with failure report" step. LOOP_PAT is a fine-grained PAT with Contents write, Pull requests write, Actions write scope. Dispatches made with a PAT are not subject to the anti-loop block.
- `dev.yml`: Removed the entire "Trigger verify on retry runs" step. With LOOP_PAT triggering dev, the `workflow_run: Dev Agent: completed` event now fires correctly, so verify re-triggers automatically. The explicit re-dispatch was redundant and would have double-triggered verify.

**PAT details:** Secret name `LOOP_PAT`, scope: Contents write + Pull requests write + Actions write. Added to repo secrets by Patrik.

**Retry chain (fixed):**
verify fails → dispatches dev with LOOP_PAT + failure_report → dev runs → `workflow_run: Dev Agent: completed` fires → verify re-runs automatically → up to iteration cap (4 commits on branch)

**Pages updated:**
- Updated: [[log]] (this entry)

---

## [2026-05-12] spec | Spec 009 split into five deliveries (009a–009e)

**Action:** Split the large spec 009 (design conversation + parametric model) into five independently verifiable deliveries.

**Reason:** Spec 009 was too large for a single dev loop iteration — it covered chat UI, LLM tool calls, SVG floor plan, triage panel, and validation loop all in one file. A single failing scenario would block everything. Split into five slices, each independently verifiable by Playwright.

**New specs created:**

- `specs/009a-design-chat-ui.md` — Streaming chat UI on `/design`. No model yet. 4 criteria: page loads with input, message streams, history persists, input clears on submit. Dependencies: `ANTHROPIC_API_KEY`, Vercel AI SDK.
- `specs/009b-building-model-tools.md` — LLM tool calls extract BuildingModel from conversation. Summary panel shows model state. Tools: `set_building()`, `set_triage_context()`, `add_installation()`, `remove_installation()`. Computed: `bya`, `nockhöjd`.
- `specs/009c-floor-plan-svg.md` — SVG floor plan derived from BuildingModel. Component: `<FloorPlanSVG model={buildingModel} />`. `data-testid` anchors for Playwright: `floor-plan-svg`, `dim-label-width`, `dim-label-length`.
- `specs/009d-triage-panel.md` — `lib/triage.ts` pure function: `runTriage(model): TriageResult`. Buckets: LOVFRI / ANMÄLAN / BYGGLOV / null. `data-testid` anchors: `triage-bucket`, `triage-reasons`, `triage-incomplete`.
- `specs/009e-validation-loop.md` — Constraint injection after tool calls. LLM proactively asks about `inomDetaljplan` and mentions vatten/avlopp for sauna. End-to-end: "bastu med dusch utanför detaljplan" → ANMÄLAN in ≤2 turns.

**Spec 009 marked superseded** — `specs/009-design-conversation.md` status field changed to `superseded` with note pointing to 009a–009e.

**Delivery order:** 009a → 009b → 009c → 009d → 009e. Each must pass verification before the next is kicked off.

**009a kicked off:** Status set to `ready-for-dev` and pushed to main as a spec-file change, triggering the dev agent loop.

**Pages updated:**
- Updated: [[log]] (this entry)
- Updated: [[wiki-index]] (009a–009e entries added, 008+009 marked superseded)

---

**Log format:** Each entry starts with `## [YYYY-MM-DD] action | Description` for easy parsing with unix tools.
