# Planstudio v2: scheduled goal runs on Claude Pro

> **Status, 2026-11-11.** The scheduled runs are paused. The runner prompt in §3 is the first draft and still mentions pull requests; the prompt in use is `v2/RUNNER.md` on `auto/v2-build` (no pull requests, pushes to `auto/v2-build`).

Addendum to [`v2-week1-pro.md`](v2-week1-pro.md), written 2026-11-09.

**Goal:** use each 5-hour Pro window while you are away. A scheduled Claude Code session starts at the beginning of a window, works through task cards on its own (Haiku builds, Opus reviews), pushes to the `auto/v2-build` branch, and stops.

**Decided 2026-11-09: no pull requests and no human review.** The Opus reviewer checkpoints, the tests, and a weekly acceptance check by the spec run are the quality gate. See `v2/RUNNER.md`, "Without human review".

## 1. Two kinds of run

| Run | Model | When | Does |
|---|---|---|---|
| **Build run** | Haiku 5.5 runs the session; Opus 5.5 is consulted through the `reviewer` subagent | Up to twice a day, each at the start of a fresh window | Takes the next ready cards from the queue, implements and tests them one at a time, runs the reviewer checkpoint when one is due, opens or updates a PR, writes a run log |
| **Spec run** | Opus 5.5 | Once a week, or when fewer than 6 cards are ready | Writes the next batch of task cards (with pseudo-code for hard ones) from the main plan and the agent specs, so the build runs never have to design anything |

Sonnet 5.5 is the fallback reviewer if Opus is unavailable or a run is short on limit.

## 2. Files in the v2 repo

```
CLAUDE.md                        # from v2-week1-pro.md §3.1
.claude/settings.json            # default model haiku, allowed commands
.claude/agents/reviewer.md       # model: opus
.claude/agents/implementer.md    # model: haiku
cards/
  W1-01.md … W1-24.md            # one file per card
  W1-R1.md …                     # reviewer checkpoints
runs/
  2026-11-10-0807.md             # one log per run
RUNNER.md                        # the prompt below, versioned with the repo
```

**Card file format:**

```markdown
---
id: W1-11
title: Spanning tree, assign coordinates
tier: H            # H = Haiku implements, R = reviewer checkpoint
status: ready      # ready | in_progress | done | blocked | needs_review
depends: [W1-09, W1-10]
spec: ["v2-agent-specs.md §6.2 step 3", "v2-week1-pro.md §5.1"]
files: [crates/core/src/solve/axis.rs, crates/core/tests/solve_a.rs]
attempts: 0
---
Do: …
Done when: `cargo test -q -p core solve_a` passes; fixture A faces equal the §7.6 table.
```

A card is **ready** when its status is `ready` and every card in `depends` is `done`.

## 3. The runner prompt (stored as `RUNNER.md`, sent by the scheduled task)

```
You are the Planstudio v2 build runner. Work autonomously until the stop rule.

Setup:
1. git fetch origin; check out branch auto/build (create it from main if missing; rebase on main).
2. Read CLAUDE.md, RUNNER.md and cards/*.md frontmatter only.

Loop:
3. Pick the first ready card in id order (status ready, all depends done).
   If none: write the run log, say "queue empty", stop.
4. Tier H card:
   a. Set status in_progress; commit.
   b. Delegate to the implementer subagent with only: the card file, the spec sections it names,
      the files it lists.
   c. When it returns, run: cargo fmt --check && cargo clippy -q -- -D warnings &&
      cargo test -q 2>&1 | tail -40
   d. Green: set status done, commit "<id>: <title>", push.
   e. Red: increment attempts. If attempts < 2, git checkout the card's files and go to 4b
      with the failing output. If attempts = 2, ask the reviewer subagent for the smallest fix
      (send the card, the diff and the failing output only), apply it, test once more.
      Still red: set status blocked with a 3-line reason, git checkout the card's files,
      commit the status change, continue with the next ready card.
5. Tier R card (checkpoint): delegate to the reviewer subagent with the card and the diffs of
   the cards it covers (git diff of those commits only). Turn each defect it lists into a new
   card W?-NNf (tier H, status ready, depends on nothing). Set the checkpoint done.
6. After every card: if this run has finished 12 cards, or a usage warning has appeared, go to
   the stop rule.

Stop rule:
7. Push auto/build. Open or update the PR "Automated build run" against main with a summary:
   cards done, blocked (with reasons), reviewer findings, test status.
8. Write runs/<date-time>.md with the same summary plus how many reviewer calls were made.
   Commit and push. Stop.

Never: edit tests, fixtures or public signatures unless a card says so; push to main; merge PRs;
add dependencies not named in a card; work on more than one card at a time; read files a card
does not name.
```

## 4. Schedule

**Assumptions:**
- The 5-hour window starts at your first message. A run starting at the top of a fresh window gets the whole window.
- **Pro's weekly limit is about 13 full windows** (third-party measurement, unverified, [wokey.ai](https://wokey.ai/claude-usage-limits)). It's shared with your own use of claude.ai and Claude Code.
- I'm assuming cloud Claude Code sessions draw on the same subscription limits. Check `/status` after the first run.

**Proposed: 10 build runs a week plus 1 spec run, leaving about 2 windows a week for your own use.**

| Day | Runs (local time, jittered off the hour) |
|---|---|
| Mon–Fri | Build at 07:41 and 12:47 (the second starts after the first window has reset) |
| Sun | Spec run at 18:43 (Opus writes next week's cards) |
| Sat | Free: your own use, reviewing and merging |

Your part: none required. Optionally glance at `v2/runs/` on the `auto/v2-build` branch to see progress.

## 5. Budget per run (estimate)

| Item | API-equivalent |
|---|---|
| A Haiku card with retries (about 1.7 attempts × about $0.15) | about $0.25 |
| A reviewer call (Opus, small diff) | about $1.5–3 |
| A build run: about 12 cards + 1–2 reviews | about $5–9 |
| A spec run (Opus, writing about 25 cards) | about $8–12 |

At about $12 per window (same third-party source), a build run fits inside one window with room for retries. The cap of 12 cards per run is there to leave margin and keep PRs reviewable.

**Throughput:** the 24 week-one cards need about 2–3 build runs, so week one's work could be done by about Tuesday. After that the build runs are limited by how fast the spec run writes ready cards, and how fast you merge. That's intended: it's cheaper to wait on you than to let a run guess.

## 6. Guardrails

- **Runs never touch `main`.** They work on `auto/build` and open a PR. You merge.
- **The reviewer checkpoints from the week-one plan are cards in the queue,** so they run automatically and can't be skipped.
- **A blocked card blocks only its dependents.** The run moves on to independent cards.
- **Stuck runs.** If two runs in a row finish with fewer than 3 cards done, the next spec run first reads the run logs and rewrites the blocked cards.
- **Keeping the limit for yourself.** Pause the scheduled tasks when you need the limit for your own work. They can be paused and resumed without losing anything.

## 7. Setup checklist

1. Create an empty GitHub repo for v2 (for example `pasilun/planstudio`). Grant the Claude GitHub app access, as for this repo.
2. In a session with that repo attached:
   - add the files from §2: the week-one setup files and the 24 cards plus 4 checkpoints, from `v2-week1-pro.md` §4, as card files;
   - add `RUNNER.md` from §3;
   - commit to `main`.
3. Create the scheduled tasks from §4:
   - each starts a fresh cloud session on the repo and sends "Follow RUNNER.md";
   - the spec run sends "Follow RUNNER.md, spec run section" (added to `RUNNER.md` by the first spec run).
4. After the first run: check `/status` for how much of the window and week it used, and adjust the cap of 12 cards or the number of runs.
