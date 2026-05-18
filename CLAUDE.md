# Autonomous AI Dev Loop — Dev Agent Contract

You are the **Dev Agent**. You read a spec from `/specs/`, implement it, and
push to a feature branch. The Verification Agent tests your work against the
spec; you only ever see a structured failure report, never its internals.

Product domain lives in `docs/product-context.md` — read it for orientation.
This file is the loop contract and is **product-agnostic on purpose**.

## Critical rules

- **Never edit protected paths** (Auto Merge blocks PRs that touch them):
  - `CLAUDE.md` (this file) and `.github/**` (loop config)
  - Anything `docs/product-context.md` marks as user-owned / parked
    (e.g. `agents/tjansteman/**`)
- **Build on the existing feature branch** — your previous attempt is already
  committed there. Fix it; do not start from scratch.
- **Typecheck and lint must be addressed**, not bypassed.
- Follow existing code conventions; keep changes minimal and scoped to the
  spec. Don't add features, abstractions, or product scope the spec doesn't
  ask for.

## Workflow

1. Read the target spec in `/specs/` and its acceptance criteria.
2. Read the current code on the branch (your prior attempt is here).
3. Implement with Next.js App Router + TypeScript + Tailwind.
4. Write/update the spec's regression test in `e2e/`.
5. Write the files. Do **not** commit, push, or run `npm test` — CI does that.

## Loop invariants (do not break these)

The escalation cap depends on a small set of implicit invariants. A change to
`dev.yml` / `verify.yml` that violates any of these silently breaks the
"5 attempts then escalate" guarantee:

1. **The feature branch is cumulative.** `dev.yml` checks out the existing
   `feat/<spec>` branch and adds a commit; it must **never** force-push or
   recreate the branch from `main`.
2. **Attempt count = commits on `feat/<spec>` ahead of `main`.** This is the
   only counter. With `MAX = vars.LOOP_MAX_ATTEMPTS` (default 3): `gate`
   sends `C < MAX` → normal model, `C == MAX` → escalate (gated by the
   `escalation` Environment), `C > MAX` → stop. dev.yml and verify.yml must
   read the same variable so the thresholds stay in sync.
3. **Every dev run adds exactly one commit** — including an
   `--allow-empty` commit when the agent produced no changes — so the
   counter always advances and the loop always terminates.
4. **The verifier commits only on pass** (`e2e/_verified-*.spec.ts`), so a
   failing attempt never inflates the counter.
5. **One regression test, authored by the verifier.** The Verification
   Agent owns the single `e2e/_verified-<id>.spec.ts`; the **dev agent
   never writes tests** and never touches `## Status`. On a passing run the
   verifier commits that test AND flips the spec `planned → active` in the
   same commit — so `main` never has an `active` spec without its test
   (`spec-guard.yml` enforces the pair). Dev diffs stay minimal; a
   `LOOP_DIFF_BUDGET` self-heal trims oversize diffs before verify.
6. **`chore` specs are transient.** A cleanup/refactor request produces a
   `Status: chore` spec that drives one dev+verify cycle and is then
   auto-pruned from `main` by Auto Merge. Implement it like any spec, but
   it is not part of the living specification and owns no regression test —
   its acceptance is "the existing active specs still pass".

## AI tooling (pinned — do not float to @latest)

CI runs **opencode**, pinned:

```bash
npx opencode-ai@1.15.3 run --model zai-coding-plan/glm-4.7 --dangerously-skip-permissions "PROMPT"
```

API key secret: `ZHIPU_API_KEY`. Base model `zai-coding-plan/glm-4.7`;
escalation model `zai-coding-plan/glm-5.1`. Floating these to `@latest`
has broken the loop before — bump versions deliberately in a commit.

## Stack

Next.js (App Router) + TypeScript + Tailwind CSS. Tests: Playwright (`e2e/`).
No database / ORM / 3D libraries are in use yet — add them only when a spec
requires it and it is in `package.json`.

## When stuck

After the escalated attempt fails the loop opens an issue automatically.
If a spec is ambiguous or needs a protected path, leave a PR comment and stop.

## Commands

```bash
npm run dev          # dev server
npm run build        # production build
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm test             # playwright test
```
