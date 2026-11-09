# Planstudio v2 runner

Scheduled sessions start with "Follow v2/RUNNER.md, build run" or "Follow v2/RUNNER.md, spec run".

## Branches

- All v2 work lives on the branch `auto/v2-build`. If it's missing, create it from `origin/claude/drawing-154-measurements-6pt6ko`. If your session instructions insist on a different branch, use that one and say so in the run log.
- Commit and push directly to the work branch. **No pull requests:** nobody reviews them. The `v2-reviewer` checkpoint cards and the tests are the quality gate.
- Never push to `main` or `claude/drawing-154-measurements-6pt6ko`.

## Build run (Haiku runs the session)

Setup:
1. If the repo isn't checked out, clone https://github.com/pasilun/laughing-tribble.
2. `git fetch origin`. Check out the work branch (see Branches) and pull it.
3. Read `v2/CLAUDE.md`, this file, and only the frontmatter of `v2/cards/*.md`.

Loop:
4. Pick the first **ready** card in id order: status `ready`, and every card in `depends` has status `done`. If there is none, go to the stop rule and report "queue empty".
5. **Tier H card:**
   a. Set its status to `in_progress` and commit.
   b. Call the `v2-implementer` subagent. Give it only the card file, the spec sections the card names, and any files already in `v2/` that the card's work touches.
   c. When it returns, run `cd v2 && cargo fmt --check && cargo clippy -q -- -D warnings && cargo test -q 2>&1 | tail -40`.
   d. **Green:** set status `done`, commit `"<id>: <title>"`, push.
   e. **Red:**
      - Increment `attempts`.
      - If `attempts` < 2: restore the files the attempt changed (`git checkout -- <files>`, keeping the card file) and go back to 5b, including the failing output.
      - If `attempts` = 2: call the `v2-reviewer` subagent with the card, the diff and the failing output only. Apply the smallest fix it gives and test once more.
      - Still red: set status `blocked` with a three-line reason in the card body, restore the files, commit the card, and continue with the next ready card.
6. **Tier R card (checkpoint):**
   - Call the `v2-reviewer` subagent with the card and the diffs of the commits for the cards in `depends` (`git log --grep` by card id).
   - For each defect it lists, create a new card `<checkpoint-id>-fN.md`: tier H, status ready, empty depends, with the defect as the task.
   - Set the checkpoint to `done` and commit.
7. After each card: if this run has finished 12 cards, or Claude Code has shown a usage-limit warning, go to the stop rule.

Stop rule:
8. Write `v2/runs/<YYYY-MM-DD-HHMM>.md` listing:
   - cards done;
   - cards blocked, with reasons;
   - reviewer findings;
   - the last test result;
   - the number of reviewer calls.
9. Commit, push the work branch, and stop. Don't open a pull request.

Never:
- edit tests, fixtures or public signatures unless a card says so;
- touch files outside `v2/` and `.claude/agents/v2-*`;
- add dependencies a card doesn't name;
- work on two cards at once;
- start the next week's cards before the current week's checkpoint cards are done.

## Without human review: extra rules

- **Keep tests honest.** A card may add tests, but never weaken, delete or skip an existing test or fixture to get green.
- **Watch for stalls.** If three runs in a row finish fewer than 3 cards, the next spec run must rewrite the blocked cards smaller before adding new ones.
- **Weekly acceptance by the spec run.** Run the acceptance checks of the finished week (`docs/v2-week1-pro.md` §7 for week one). Turn any failure into new cards with high priority (lowest ids, no dependencies).

## Spec run (Opus runs the session)

1. Do the same setup as a build run, steps 1–3. Also read `docs/v2-kernel-plan.md`, `docs/v2-agent-specs.md`, `docs/v2-week1-pro.md` and the last five files in `v2/runs/`.
2. **Unblock.** For every `blocked` card: read its reason and the run logs. Either rewrite the card smaller with pseudo-code, or split it, and set it back to `ready` with `attempts: 0`.
3. **Refill.** If fewer than 6 cards are ready or will become ready when current cards finish:
   - write the next batch of 15–25 cards, following the format of the existing cards;
   - follow the order in `docs/v2-week1-pro.md` §8 (week 2: MCP server over the core, PNG renders sized for Claude with labels, weighted least squares from the agent specs P1-08; then week 3, and so on);
   - for each card give exact inputs, outputs, files, spec references and a test that proves it done;
   - add pseudo-code for anything a Haiku-class model would otherwise have to design;
   - add a reviewer checkpoint card after every 5–7 cards.
4. If a week's work needs a design decision the specs don't make, take the option that keeps the code simplest and easiest to change later. Record it under "Decisions made" in `docs/v2-agent-specs.md` and in the run log.
5. Write `v2/runs/<YYYY-MM-DD-HHMM>-spec.md` summarising the new and rewritten cards and any open decisions. Commit, push the work branch, and stop. Don't open a pull request.
