# Laughing Tribble — Agent Instructions

This is a Swedish bygglov assistant built by an autonomous AI dev loop.

## Project Overview

**Product:** A web application that helps Swedish users create bygglov/anmälan packets for small structures:
- Friggebod (15 m², bygglovsfri)
- Attefallshus (30 m², anmälan)
- Attefalltillbyggnad (15 m² BTA, anmälan)
- Komplementbyggnad (bygglov)
- Liten tillbyggnad (bygglov)

**Architecture:** Three-layer separation
- **Layer 1 (App)** — The web application you're building
- **Layer 2 (Tjänsteman)** — AI agent that reviews packets against PBL/BBR
- **Layer 3 (Human)** — Patrik owns legal correctness, fixtures, corpus

## The Autonomous AI Dev Loop

The loop consists of three AI agents that collaborate via GitHub:

### 1. Spec Agent
**Triggers:** Issue labeled with `feature-request`
**Output:** Draft PR with a spec file in `/specs/<id>.md`

The spec agent:
- Takes a vague feature request
- Explores the repo to understand the architecture
- Writes a detailed spec with user stories and Gherkin acceptance criteria
- Opens a draft PR with just the spec

**Critical:** All acceptance criteria must be browser-observable (testable via Playwright).

### 2. Dev Agent
**Triggers:** Spec PR is merged (or workflow_run from Spec Agent)
**Output:** Implementation pushed to the same branch

The dev agent:
- Reads the spec file
- Explores the repo
- Implements the feature following existing patterns
- Writes tests
- Runs typecheck and lint
- Pushes changes

**Critical Rules:**
- NEVER edit protected paths (`/fixtures/`, `/agents/tjansteman/corpus/`, `/agents/tjansteman/system-prompt.md`, `CLAUDE.md`, auth, payments, migrations, CI)
- NEVER make legal judgments about PBL/BBR (that's the tjänsteman's job)
- Follow existing code conventions
- Always run typecheck and lint before pushing

### 3. Verification Agent
**Triggers:** Dev agent workflow completes
**Output:** Structured pass/fail report per acceptance criterion

The verification agent:
- Reads ONLY the spec (never the implementation)
- Tests the deployed preview via Playwright
- Returns a structured report showing which criteria passed/failed
- If failed, reports back to dev agent

**Critical Principle:** Black-box testing. The verifier never sees the code.

### 4. Auto-Merge
**Triggers:** All checks pass
**Output:** PR is squashed and merged

Auto-merge requires ALL of:
- Typecheck ✓
- Lint ✓
- Tests ✓
- Verification ✓ (all criteria pass)
- Golden cases ✓ (if PR touches tjänsteman)
- Diff < 400 lines
- No protected paths touched
- Converged in ≤ N iterations

## File Structure

```
laughing-tribble/
├── agents/              # AI agent system prompts
│   ├── spec/           # Spec agent prompt
│   ├── dev/            # Dev agent prompt
│   ├── verifier/       # Verification agent prompt
│   └── tjansteman/     # Tjänsteman agent (product feature)
│       ├── system-prompt.md
│       └── corpus/     # PBL, BBR, detaljplaner, etc.
├── specs/              # Feature specifications
│   ├── _template.md    # Spec template
│   └── *.md            # Individual specs
├── fixtures/           # Golden cases for tjänsteman testing
│   └── bygglov-cases/  # Frozen test cases
├── app/                # Next.js app directory
│   ├── page.tsx
│   ├── layout.tsx
│   └── ...
├── e2e/                # Playwright tests
├── .github/workflows/  # GitHub Actions
│   ├── spec.yml
│   ├── dev.yml
│   ├── verify.yml
│   ├── merge.yml
│   ├── revert.yml
│   └── digest.yml
├── CLAUDE.md          # Dev agent instructions
├── AGENTS.md          # This file
└── README.md          # Project documentation
```

## Protected Paths

NEVER edit these files:
- `/fixtures/bygglov-cases/**` — Golden cases are frozen
- `/agents/tjansteman/corpus/**` — Legal corpus maintained by Patrik
- `/agents/tjansteman/system-prompt.md` — Tjänsteman prompt is manual
- `CLAUDE.md` — Loop configuration
- Auth, payments, migrations, CI config

## Stack

- **Framework:** Next.js 16 (App Router)
- **Language:** TypeScript (strict mode)
- **Styling:** Tailwind CSS 4
- **3D:** React Three Fiber + drei (later phases)
- **PDF:** react-pdf or pdf-lib (later phases)
- **Database:** Prisma ORM
- **Testing:** Playwright (e2e)
- **Deploy:** Vercel
- **Orchestration:** GitHub Actions + Claude GitHub Action

## Commands

```bash
npm run dev          # Start dev server
npm run build        # Production build
npm run typecheck    # TypeScript checking
npm run lint         # ESLint
npm test             # Run Playwright tests
npm run test:smoke   # Run smoke tests
npm run test:golden-cases  # Run golden case tests
```

## Workflow: End-to-End Example

1. **User creates issue:** "Add a button to change greeting color"
2. **Label it:** `feature-request`
3. **Spec agent runs:** Creates `/specs/002-color-button.md` with acceptance criteria
4. **Spec PR opens:** Draft PR with just the spec
5. **User reviews and merges** the spec PR
6. **Dev agent runs:** Implements the color button feature
7. **Dev agent pushes:** Code to the same branch
8. **Verification agent runs:** Tests the preview deployment
9. **If verification passes:** Auto-merge merges the PR
10. **Daily digest:** Patrik receives email summary

## Golden Cases

Golden cases are frozen test cases that validate the tjänsteman agent's behavior. Each case contains:
- A complete bygglov packet
- Expected findings the tjänsteman should return

When a PR touches the tjänsteman agent:
- Verification agent runs all golden cases
- Each case must return expected findings
- If any fail, PR is blocked

Golden cases are the ONLY way the tjänsteman's behavior can change safely.

## Phase Progress

**Phase 0** (Complete) — Loop infrastructure
- ✅ Next.js skeleton
- ✅ Agent prompts
- ✅ GitHub Actions workflows
- ✅ Trivial test feature (greeting)

**Phase 1** (Next) — Friggebod flow
- [ ] Parametric 3D modeling from Swedish prompts
- [ ] Situationsplan overlay
- [ ] PDF exports (fasader, plan, sektion)
- [ ] Tjänsteman checklist for friggebod
- [ ] First 3 golden cases

**Phase 2** — Attefall
- [ ] Attefallshus primitives
- [ ] Attefallstillbyggnad primitives
- [ ] Anmälan-flow
- [ ] RAG: Boverket författnings-API
- [ ] Expand to 8-10 golden cases

**Phase 3** — Detaljplan-aware flows
- [ ] Detaljplan ingestion
- [ ] Komplementbyggnad med bygglov
- [ ] Liten tillbyggnad med bygglov
- [ ] Expand to 15-20 golden cases

**Phase 4** — Outside detaljplan, MVP acceptance
- [ ] Förhandsbesked flow
- [ ] Strandskyddsbedömning
- [ ] **MVP gate:** Patrik submits real anmälan using the app

## When to Escalate

Escalate to Patrik when:
- After 3-5 failed verification attempts on the same spec
- Need to edit a protected path
- Spec is ambiguous
- Don't know how to test something

Leave a comment on the PR and stop.

## Success Criteria

The loop is successful when:
- Spec → Dev → Verify → Merge happens automatically
- All acceptance criteria are browser-observable
- Protected paths remain untouched
- Golden cases validate tjänsteman behavior
- Typecheck and lint always pass

## Key Design Principles

1. **Verifier reads the spec, never the diff**
2. **Verifier never makes legal judgments**
3. **Acceptance criteria must be browser-observable**
4. **Golden cases are the only safe way to change tjänsteman behavior**
5. **Simple flows first — resist scope creep**
6. **Patrik owns legal correctness, fixtures, corpus**
