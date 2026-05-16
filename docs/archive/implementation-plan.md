# Implementation Plan

Companion to `auto-ai-dev-loop-plan.md`. That doc describes *what* is being built. This one describes *how to start*, with explicit attention to the handoff from human-driven setup to autonomous loop.

## Two proof points

This project proves two things simultaneously:

1. **Development can be autonomous.** An adversarial multi-agent loop ships features end-to-end without Patrik writing code.
2. **The loop can produce a usable MVP.** The app is real enough that Patrik submits an actual anmälan to Strängnäs or Stockholm using only what the loop built.

Both must work. Cutting either undermines the project.

## Infra posture

**Zero always-on cost, live dogfooding from day one.** Vercel Hobby (free) + Turso (free) means there's a live URL on the phone from the start, but no paid services and no servers to maintain.

**Two separate runtime needs, two answers:**
- **The loop** verifies against `localhost:3000` inside the GitHub runner — fresh, clean, isolated per run. Fast, deterministic, no pollution of real data.
- **Patrik** dogfoods against the live Vercel URL. Every merge to `main` auto-deploys within ~60s. Usable from iOS, from the property, from anywhere.

**Adversarial dev loop is load-bearing, not ceremony.** Three agents with narrow mandates catch each other's corners; one agent doing all three phases rationalizes its own work. Auto-merge with a real safety net proves autonomy; babysitting PRs doesn't.

### Kept

- Three adversarial agents (spec, dev, verifier), separate system prompts
- Spec-is-the-contract: verifier reads only the spec, never the diff
- Auto-merge gate with all original conditions
- Post-merge smoke test + auto-revert (the contract that makes auto-merge sane)
- Protected paths the dev agent refuses to edit
- Golden case fixtures as the tjänsteman's contract
- Tripwires that force human review (migrations, new deps, protected paths)
- Verifier → dev retry loop, capped
- Vercel Hobby deploy on every merge to `main` — Patrik's dogfood environment

### Cut (pure scaling overhead)

- Vercel preview deploys per PR → verifier runs Playwright against `localhost:3000` in the runner; production deploy only on merge
- Neon Postgres → Turso (SQLite-compatible, free tier)
- pgvector RAG → rules embedded in agent prompts as structured markdown
- Daily digest → GitHub notifications suffice at one user
- Separate workflow files → one workflow with sequential jobs

### Deferred until it hurts

- Turso paid tier / Neon / pgvector: when corpus or concurrency demands it
- Daily digest: when GitHub notifications become noise
- Multi-environment config (staging vs. prod): when there's a second user
- Tagged-release deploys: when stable demos for outside people matter

---

## Part 1: Bootstrap (human-driven)

Goal: a repo where a labeled GitHub issue triggers the full spec → dev → verify → auto-merge loop, end-to-end, on a trivial feature.

### 1.1 Accounts

- GitHub repo (private)
- Anthropic API key for agent invocations
- Claude GitHub Action installed on the repo
- Vercel Hobby account, linked to the repo
- Turso account (free tier), one database

All free. Set up once, forget about.

### 1.2 App skeleton

- `pnpm create next-app` (App Router, TypeScript, Tailwind)
- Prisma initialized against **libSQL** (Turso's protocol, SQLite-compatible)
  - Local dev: `DATABASE_URL=file:./dev.db` — plain SQLite file, no network
  - CI (loop runner): same, fresh per-run
  - Production (Vercel): `DATABASE_URL=libsql://<name>.turso.io` + auth token as env var
  - Prisma schema is identical across all three; the provider handles the rest
- First migration: empty models (`User`, `Property`, `Project`, `Packet`, `Finding`)
- `/` renders a minimal "Hello Patrik" screen
- One trivial feature hand-built: a counter on the home page, so Phase 0 has something the verifier can assert against
- Playwright installed as a dev dependency; one test opens `/` and confirms the counter works
- Link repo to Vercel; `main` branch auto-deploys on every merge to `your-app.vercel.app`
- `pnpm dev` runs locally against the SQLite file; the Vercel deploy runs against Turso

### 1.3 Repo structure

```
/specs/
  /foundations/        architectural contracts (Patrik writes by hand)
  /<id>.md             feature specs
/agents/
  /spec/system.md      spec agent prompt
  /dev/system.md       dev agent prompt (plus root CLAUDE.md)
  /verifier/system.md  verifier prompt
  /tjansteman/         product-embedded agent (later)
    /rules/            structured markdown rule sets
    /system.md
/fixtures/
  /bygglov-cases/      golden cases
  /schema.md           fixture format
/.github/workflows/
  loop.yml             single workflow: spec → dev → verify → merge-gate → smoke → revert
CLAUDE.md              repo conventions, stack, protected paths
README.md
```

### 1.4 CLAUDE.md

The dev agent's entire world-view. Covers:

- Stack and conventions (Next.js App Router, Prisma over libSQL/Turso, Tailwind, Playwright)
- Where things live (`/app/api` for route handlers, `/components`, `/lib` for domain logic)
- Swedish UI conventions (labels in Swedish, `sv-SE` formatting, bygglov terminology)
- Forbidden patterns (no `any`, no inline styles, no server components calling browser APIs)
- Protected paths — the dev agent refuses to edit these and flags for Patrik
- How to read a spec; definition of "done"
- Testing expectations (unit tests for `/lib`, integration for route handlers, acceptance via Playwright against `localhost`)

### 1.5 The single workflow (`loop.yml`)

```yaml
on:
  issues:
    types: [labeled]

jobs:
  spec:
    if: github.event.label.name == 'feature'
    steps:
      - checkout
      - invoke Claude with /agents/spec/system.md + issue body + /specs/foundations
      - create branch feat/<issue-number>
      - commit /specs/<id>.md
      - open draft PR, label ready-for-dev

  dev:
    needs: spec
    steps:
      - checkout branch
      - invoke Claude Code with CLAUDE.md + spec + repo
      - commit implementation + tests
      - push

  verify:
    needs: dev
    steps:
      - checkout, install, pnpm dev & (background)
      - wait-on localhost:3000
      - invoke Claude with verifier/system.md + spec only (NOT the diff)
      - Playwright asserts each acceptance criterion
      - post structured verdict as PR comment
      - on fail and iterations < 5: label needs-fix (re-triggers dev)
      - on pass: label verified

  merge-gate:
    needs: verify
    if: label verified
    steps:
      - check: typecheck, lint, unit tests, verifier pass
      - check: golden cases pass (if tjansteman-adjacent)
      - check: diff < 400 lines, < 10 files
      - check: no protected paths touched
      - check: iterations <= threshold
      - all green: enable auto-merge squash
      - any tripwire (migration, new dep, protected path): label needs-human

  # merge to main triggers Vercel auto-deploy (configured in Vercel, not here)
  # Vercel deploys to your-app.vercel.app within ~60s

  smoke:
    on: push to main
    steps:
      - checkout, install, boot app + ephemeral SQLite in runner
      - run smoke-subset of golden cases + core user flows against localhost
      - on fail: revert merge commit, open issue, label urgent
      - (smoke runs against localhost, not the Vercel deploy — keeps the check
         fast and doesn't pollute Patrik's Turso data)

  digest:
    # deferred
```

Everything runs on GitHub-hosted runners. No always-on anything.

### 1.6 Bootstrap acceptance

- File a test issue: *"Add a second counter on `/about`"*
- Label `feature`
- Spec agent opens draft PR with a spec
- Patrik marks ready-for-dev
- Dev agent implements; verifier passes; merge-gate auto-merges
- Smoke runs on main, passes
- Vercel auto-deploys within ~60s
- Patrik opens `your-app.vercel.app/about` on his phone — counter works
- `/about` now has a counter, usable from iOS

If any step breaks, fix before proceeding. The loop must be boringly reliable on trivial features before it's pointed at bygglov work.

### 1.7 Driving the loop from iOS

Once the loop is working, Patrik's entire workflow fits on a phone:

- **File features** — Claude iOS app via GitHub MCP connector: describe the feature, Claude files an issue labeled `feature`. Loop wakes up.
- **Approve specs** — when the spec agent opens a draft PR, GitHub notifies. Review in Claude app or GitHub mobile; edit if needed; label `ready-for-dev`.
- **Watch the loop run** — GitHub notifications when verification passes/fails and when auto-merge lands.
- **Dogfood immediately** — open `your-app.vercel.app` on the phone, try the new feature. Works from anywhere, including the Strängnäs property.
- **File fixes** — something feels wrong, describe to Claude, becomes the next issue, becomes the next PR.
- **Handle tripwires** — PRs labeled `needs-human` sit and wait. Review on phone, approve or reject.

The Linux desktop is only needed for: (a) the initial bootstrap, (b) debugging the loop itself when agents misbehave, (c) writing or revising foundation docs. For ordinary feature work, phone is enough.

---

## Part 2: The speccing sprint (human-driven)

The loop is only as good as what it's pointed at. This sprint is the highest-leverage work in the project. Two kinds of output:

- **Architectural contracts** Patrik writes directly. Shared primitives every feature spec depends on. Never loop-edited.
- **Feature specs** drafted by the spec agent, approved by Patrik. The spec agent's quality is determined by its system prompt, which Patrik also writes.

### 2.1 Architectural contracts (in `/specs/foundations/`)

Patrik writes these by hand before any feature work. Each change to these docs is a human-reviewed PR, never loop-generated.

1. **`domain-model.md`** — core entities and relationships. `Property`, `Project`, `Packet`, `Finding`. Fields, enums, invariants. Drives the Prisma schema.
2. **`friggebod-rules.md`** — codified friggebod regulations as structured markdown: max area, max nockhöjd, distance to tomtgräns, grannmedgivande conditions, location restrictions. Each rule cites källa (Boverket / PBL §).
3. **`attefall-rules.md`** — same for attefallshus, attefallstillbyggnad, takkupor.
4. **`packet-contract.md`** — what constitutes a complete packet per flow: documents, metadata, PDF layouts. Input to assembler, input to tjänsteman.
5. **`findings-contract.md`** — shape of a finding (`id`, `severity`, `category`, `message`, `källa`, `suggested-fix`). Contract between tjänsteman and UI, and what fixtures assert against.
6. **`spec-template.md`** — the template every feature spec follows.
7. **`fixture-schema.md`** — structure of golden cases.
8. **`ui-conventions.md`** — Swedish language standards, form patterns, error messages, empty states.
9. **`disclaimer-policy.md`** — what the app tells users about advisory-only nature, user responsibility, GDPR posture.

Expect to iterate as real features reveal gaps — but every foundation change is human-driven.

### 2.2 Spec template

```markdown
# spec-<id>: <short title>

**Status:** draft | ready-for-dev | verified | shipped
**Depends on:** foundations/<...>, spec-<id>
**Touches:** ui | db | tjansteman | packet-assembler

## User story
As a <user>, I want <goal>, so that <benefit>.

## Scope
What this spec covers.

## Non-scope
What this spec explicitly does NOT cover.

## UI preconditions
What state the app must be in before these criteria apply.

## Acceptance criteria
Gherkin-style, browser-observable only.

1. **Given** ..., **when** ..., **then** the UI shows ...
2. **Given** ..., **when** ..., **then** ...

## Fixtures
(If tjansteman-adjacent) list of golden cases that must still pass.

## Open questions
Things the spec agent couldn't resolve; flagged for Patrik.
```

### 2.3 Spec agent system prompt

Key instructions in `/agents/spec/system.md`:

- Produce specs in the template format only
- Acceptance criteria must be browser-observable (reject "function returns X" phrasing)
- When the feature touches the tjänsteman, reference relevant `foundations/*-rules.md` and list fixtures that must still pass
- If a spec would require changes to `/specs/foundations/**`, stop and flag for Patrik — never auto-edit foundations
- When uncertain, write an "Open questions" section; don't guess
- Use Swedish for domain concepts (byggnad, tomtgräns, taknockshöjd, anmälan vs. bygglov)
- Include 2–3 worked examples of good specs in the agent's context

### 2.4 Dev agent system prompt

Key instructions in `/agents/dev/system.md` + `CLAUDE.md`:

- Read the spec first, then relevant foundations, then the repo
- Never edit `/specs/foundations/**`, `/fixtures/**`, `/agents/tjansteman/rules/**`, or `CLAUDE.md`
- Implementation must satisfy every acceptance criterion; if a criterion is unimplementable as written, stop and flag
- Write Playwright tests that mirror the acceptance criteria
- Keep diffs small; if implementation requires >400 lines or >10 files, stop and suggest splitting the spec
- Never add dependencies without flagging (tripwire)

### 2.5 Verifier system prompt

Key instructions in `/agents/verifier/system.md`:

- Input: the spec only. Never the diff, never the implementation code.
- Input: live app at `localhost:3000`
- For each acceptance criterion, produce a Playwright assertion, run it, record pass/fail with evidence (screenshot, DOM snippet)
- Never make legal or architectural judgments
- For tjänsteman-adjacent PRs: run the golden-case suite and assert expected findings appear
- Output structured JSON verdict, consumed by merge-gate

### 2.6 Golden case fixtures

Each fixture is a directory:

```
/fixtures/bygglov-cases/friggebod-pass-01/
  packet/
    ansokan.json
    situationsplan.pdf
    fasader.pdf
    plan.pdf
    meta.json
  expected-findings.json
  notes.md          why this case exists; källa for expected findings
```

`expected-findings.json` is the contract. Verifier runs the packet through the tjänsteman and asserts every expected finding appears (by id) and no unexpected blocking findings appear.

### 2.7 First-sprint feature specs (friggebod flow)

Patrik drafts or reviews the first 8 specs:

- `spec-001`: Property creation (fastighetsbeteckning, address, kommun)
- `spec-002`: Project creation on a property, selects flow type (friggebod)
- `spec-003`: Friggebod parameter form (size, position, nockhöjd, taklutning)
- `spec-004`: Friggebod 3D rendering from form inputs
- `spec-005`: Situationsplan overlay (3D footprint on uploaded fastighetskarta)
- `spec-006`: Drawings export (fasader, plan as PDF)
- `spec-007`: Tjänsteman review (hardcoded friggebod checklist, findings UI)
- `spec-008`: Packet download (zip of all documents)

Don't touch attefall or bygglov flows in this sprint.

### 2.8 Starter fixtures (friggebod only)

Five hand-built fixtures:

- `friggebod-pass-01` — clean on detaljplan-property
- `friggebod-pass-02` — clean outside detaljplan
- `friggebod-fail-oversize` — 20 m² (exceeds 15)
- `friggebod-fail-gransavstand` — <4,5 m from gräns, no grannmedgivande
- `friggebod-fail-nockhojd` — 3,5 m nockhöjd

Each with `expected-findings.json` citing the relevant rule in `foundations/friggebod-rules.md`.

### 2.9 Sprint acceptance

- All 9 foundation docs committed
- Spec, dev, verifier system prompts drafted and committed
- Spec template and fixture schema locked
- First 8 feature specs written and approved
- 5 starter fixtures committed
- Dry run: Patrik files `spec-001` as a labeled issue → spec agent produces a matching spec → Patrik approves → dev agent implements → verifier passes → auto-merges → smoke passes.

If the dry run fails, the problem is almost always in an agent prompt or a missing foundation doc. Fix and retry before proceeding.

---

## Part 3: Handoff to the loop

Once sprint acceptance passes, Patrik's role shifts:

- **File feature issues** — short descriptions with label `feature`. The spec agent does the rest.
- **Approve specs** — review the draft PR from the spec agent, edit if needed, mark `ready-for-dev`. The only routine human touchpoint.
- **Watch GitHub notifications** — tripwire PRs need real review; auto-merged PRs just need a glance.
- **Curate fixtures** — as real cases come in from Strängnäs/Stockholm diarium requests, add them to the golden set. Manual and deliberate.

Patrik does *not* write code. If that becomes tempting, it's a signal the loop needs better inputs (spec, fixtures, corpus), not a manual patch.

---

## Part 4: Steady-state rhythm

**Daily:**
- Skim GitHub notifications
- Approve pending specs

**Weekly:**
- File 3–5 new feature issues based on gaps
- Review tripwire PRs

**Monthly:**
- Add golden cases from collected real submissions
- Review tjänsteman accuracy against what kommun handläggare would say; update `foundations/*-rules.md` as needed
- Bump model versions in agent configs if warranted

**Per phase milestone:**
- Dogfood on a real Strängnäs project end-to-end
- Write a post-mortem: what the loop did well, where Patrik had to intervene

---

## Part 5: The real submission

The app is live on `your-app.vercel.app` from day one, so "deploying" is not a milestone — the milestone is being ready to *use* it for a real kommun submission.

Before submitting to Strängnäs or Stockholm:

- Run the full golden-case suite against the deployed URL (not just localhost) as a final confidence check
- Patrik walks through his actual project end-to-end on the phone: property → parameters → 3D → drawings → tjänsteman review → packet download
- Read the disclaimer screens critically: does the app make its advisory-only nature clear to a real user?
- Double-check the packet against the kommun's e-tjänst format (often Mittbygge)
- Submit

If kommun responds with remarks, each remark becomes a feature issue, the loop ships fixes, and the next submission goes out. That cycle is the actual proof of both propositions: autonomy (the loop fixed the remarks) and usability (the MVP is good enough for real use).

---

## Risks and mitigations

- **Spec agent produces vague specs.** → More examples in its prompt; require every criterion to be testable with Playwright.
- **Verifier approves broken features.** → Acceptance criteria too lax; tighten the template to require specific DOM assertions.
- **Dev agent loops on the same failure.** → Iteration cap kicks in. Escalate; read the verifier's last report; usually the spec is wrong.
- **Golden cases pass but tjänsteman is actually wrong.** → Fixture set has a blind spot. Add a case.
- **Loop ships something Patrik didn't expect.** → Missing foundation doc. Stop feature work, write the foundation, retry.
- **Token/cost blowup.** → Per-PR token budget; alert if exceeded.
- **Data leak via agent prompts.** → All examples use synthetic properties. Never include real user data in contexts.
- **MVP rejected by kommun.** → Read remarks, file them as feature issues, let the loop ship fixes. This is exactly what the system is for.

---

## What to do first (concrete next steps)

1. Create the GitHub repo; install Claude GitHub Action
2. Create Vercel and Turso accounts (both free); link Vercel to the repo
3. Scaffold Next.js app with Prisma + libSQL; hand-build the counter on `/`; push to main; confirm Vercel deploys
4. Write `CLAUDE.md` for the dev agent
5. Write spec and verifier system prompts
6. Write `foundations/domain-model.md` and `foundations/friggebod-rules.md` — these two unlock the first real sprint
7. Write `foundations/spec-template.md`, `fixture-schema.md`, `findings-contract.md`
8. Write `loop.yml` with spec → dev → verify → merge-gate → smoke jobs
9. File a trivial test issue; validate the loop end-to-end on the counter feature; confirm Vercel auto-deploys the merged change; open from phone
10. Only then: begin the friggebod sprint
