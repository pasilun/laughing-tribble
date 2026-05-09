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

---

**Log format:** Each entry starts with `## [YYYY-MM-DD] action | Description` for easy parsing with unix tools.
