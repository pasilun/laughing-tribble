# Starting an agent on Planstudio v2

Use this when you open a new agent session that has no memory of the project.

## Where to start

- **Repo:** `pasilun/laughing-tribble`
- **Branch:** `auto/v2-build`. It has the Rust code, the task cards, the fixtures and the run logs. The docs branch (`claude/drawing-154-measurements-6pt6ko`) has the planning documents but none of the Rust code.
- **Folder:** `v2/`. The rest of the repo is the unrelated v1 Next.js app.
- **Claude Code on the web:** new session, repo above, branch `auto/v2-build`.
- **Locally:** `git clone https://github.com/pasilun/laughing-tribble && cd laughing-tribble && git checkout auto/v2-build && cd v2 && claude`
- **Model:** Haiku to build (cards are written for it), Opus to write specs or review. Switch with `/model`.

## Prompt to paste

```
You are joining the Planstudio v2 project, already in progress. Work on branch
auto/v2-build, in the v2/ folder (the rest of the repo is the unrelated v1 app).

Read, in this order:
1. v2/CLAUDE.md and v2/RUNNER.md (rules and how automated runs work)
2. docs/v2-week1-pro.md (card list, pseudo-code, acceptance) and
   docs/v2-agent-specs.md (specs, plus §15 "Decisions made")
3. the two newest files in v2/runs/ (what the last runs did and found)
4. only the frontmatter of v2/cards/*.md (id, status, depends)

Then report, without changing anything: which cards are done, ready and
blocked; whether `cd v2 && cargo test -q` passes; the next three cards; and any
open items from the run logs. Wait for my instruction before starting work.
When I say "start a build run", follow v2/RUNNER.md, section "Build run".
```

## Where the state lives

| What | Where |
|---|---|
| The overall plan, with research and reasoning | `docs/v2-kernel-plan.md` |
| Exact specs, solver algorithm, diagnostics, fixtures, decisions D1 onward | `docs/v2-agent-specs.md` |
| Week-one cards, pseudo-code, acceptance, outlook | `docs/v2-week1-pro.md` |
| How the scheduled runs are set up | `docs/v2-goal-runs.md` |
| Which card is done, ready or blocked | `v2/cards/*.md` (the `status:` line) |
| What each run did, and open questions for the spec runner | `v2/runs/*.md` |
| The code | `v2/crates/{core,cli,render}` |
| Test fixtures (your lgh 154 numbers) | `v2/fixtures/` |

## Try it

```
cd v2 && cargo build
./target/debug/plan check fixtures/lgh154-a.plan   # consistent: warnings only
./target/debug/plan check fixtures/lgh154-b.plan   # the 4.49 m conflict
./target/debug/plan svg fixtures/lgh154-a.plan --out lgh154-a.svg
```

## Avoid colliding with the scheduled runs

Scheduled tasks start build runs on weekdays at 07:41 and 12:47 (Europe/Stockholm) and an Opus spec run on Sundays at 18:43. They push straight to `auto/v2-build`. If you work on that branch at the same time, either ask for the scheduled tasks to be paused, or work on your own branch cut from `auto/v2-build` and merge afterwards. Always `git fetch` and rebase before you push.

## Rules in one place

- Do not edit tests, fixtures or public signatures unless a card says so.
- Lengths are whole millimetres; x points east, y points south.
- One card at a time; the card says which files it may touch.
- If a spec question blocks a card, mark the card `blocked` with a short reason instead of guessing. The spec run settles it.
