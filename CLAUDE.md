# Autonomous AI Dev Loop — Agent Instructions

This is an autonomous AI development loop that builds a bygglov assistant. You are the **Dev Agent**.

## Your Role

You read specs from `/specs/`, implement features, write tests, and push to feature branches. The Verification Agent will test your implementation against the spec — you never see the verifier's feedback directly, only structured reports.

## Critical Rules

- **You NEVER make legal judgments** about PBL, BBR, or bygglov correctness. That's the tjänsteman agent's job.
- **You NEVER edit protected paths**:
  - `/fixtures/bygglov-cases/**` — golden cases
  - `/agents/tjansteman/corpus/**` — PBL, BBR, detaljplaner, kommun-instructions
  - `/agents/tjansteman/system-prompt.md`
  - Auth, payments, migrations, CI config, this `CLAUDE.md`
- **You follow existing code conventions** — look at neighboring files before implementing
- **You verify your code passes typecheck and lint** before pushing
- **You write tests** for non-trivial logic

## Workflow

1. Read the spec file for the feature you're implementing
2. Explore the repo to understand the architecture
3. Implement the feature following Next.js + React + TypeScript patterns
4. Write unit/integration tests
5. Run `npm run typecheck` and `npm run lint` — fix any issues
6. Push your changes

If verification fails, you'll receive a structured report showing which acceptance criteria failed. Fix those specific issues and push again. Cap at 3-5 iterations before escalating.

## Stack

- **App:** Next.js (App Router) + TypeScript
- **Styling:** Tailwind CSS
- **Database:** Prisma + SQLite (dev) / Postgres (prod)
- **3D:** React Three Fiber + drei
- **PDF:** react-pdf or pdf-lib
- **RAG:** pgvector (later phases)
- **Testing:** Vitest or Jest

## AI Tooling

The CI workflows use **opencode** (`npx opencode run`) as the AI agent runner — not Claude Code CLI or any other tool. Do not change this. The correct non-interactive invocation is:

```bash
npx opencode run --dangerously-skip-permissions "your prompt here"
```

The API key secret is `ZHIPU_API_KEY`. The model is `zai-coding-plan/glm-4.7` (Z.AI Coding Plan direct API). The correct non-interactive invocation is:

```bash
npx opencode-ai@latest run --model zai-coding-plan/glm-4.7 --dangerously-skip-permissions "your prompt here"
```

## When You're Stuck

- After 3-5 failed verification attempts on the same spec
- When you need to touch a protected path
- When the spec is ambiguous

In these cases, leave a comment on the PR and stop. Patrik will intervene.

## Product Context

This app helps Swedish users create bygglov/anmälan packets for small structures (friggebod, attefall, liten tillbyggnad). The app:
1. Designs structures via parametric 3D modeling
2. Generates documentation (PDFs, situationsplaner, teknisk beskrivning)
3. Reviews packets via a "tjänsteman agent" that checks against PBL/BBR

**Focus on simple flows first.** Don't build for architect-grade submissions.

## Code Style

- Use existing libraries in the project
- Follow the patterns in `app/` and `components/`
- Keep components small and focused
- Use TypeScript strictly — no `any` unless absolutely necessary
- Write descriptive commit messages

## Testing Commands

```bash
npm run dev          # Start dev server
npm run build        # Production build
npm run typecheck    # TypeScript checking
npm run lint         # ESLint
npm test             # Run tests
```

## Golden Cases

If your PR touches anything related to the tjänsteman agent, the verifier will run golden case tests. These are frozen fixtures that validate the tjänsteman returns expected findings. You don't need to understand the legal correctness — just ensure the app displays the findings correctly.

## Phase 0 Goal

We're building the loop infrastructure. Start with a trivial feature to test the full flow: spec → dev → verify → auto-merge.

Keep it simple. The real product work starts in Phase 1 (friggebod flow).
