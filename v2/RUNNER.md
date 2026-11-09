# Planstudio v2 runner

Scheduled sessions start with "Follow v2/RUNNER.md, build run" or "Follow v2/RUNNER.md, spec run".

## Branches

- Work branch: `auto/v2-build`. If your session instructions name a branch to develop on, use that one instead.
- Pull requests go against `claude/drawing-154-measurements-6pt6ko`.
- Never push to `main` or to the PR base, and never merge a pull request. The maintainer merges.

## Build run (Haiku runs the session)

Setup:
1. If the repo isn't checked out, clone https://github.com/pasilun/laughing-tribble.
2. `git fetch origin`. Check out the work branch; if it's missing, create it from `origin/claude/drawing-154-measurements-6pt6ko`. Then rebase on that branch.
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
8. Push the work branch. Open a pull request against the PR base, or update the open one, titled "v2 automated build". The summary lists:
   - cards done;
   - cards blocked, with reasons;
   - reviewer findings;
   - the last test result.
9. Write `v2/runs/<YYYY-MM-DD-HHMM>.md` with the same summary plus the number of reviewer calls. Commit, push and stop.

Never:
- edit tests, fixtures or public signatures unless a card says so;
- touch files outside `v2/` and `.claude/agents/v2-*`;
- add dependencies a card doesn't name;
- work on two cards at once;
- start the next week's cards before the current week's checkpoint cards are done.

## Spec run (Opus runs the session)

1. Do the same setup as a build run, steps 1–3. Also read `docs/v2-kernel-plan.md`, `docs/v2-agent-specs.md`, `docs/v2-week1-pro.md` and the last five files in `v2/runs/`.
2. **Unblock.** For every `blocked` card: read its reason and the run logs. Either rewrite the card smaller with pseudo-code, or split it, and set it back to `ready` with `attempts: 0`.
3. **Refill.** If fewer than 6 cards are ready or will become ready when current cards finish:
   - write the next batch of 15–25 cards, following the format of the existing cards;
   - follow the order in `docs/v2-week1-pro.md` §8 (week 2: MCP server over the core, PNG renders sized for Claude with labels, weighted least squares from the agent specs P1-08; then week 3, and so on);
   - for each card give exact inputs, outputs, files, spec references and a test that proves it done;
   - add pseudo-code for anything a Haiku-class model would otherwise have to design;
   - add a reviewer checkpoint card after every 5–7 cards.
4. If a week's work needs a design decision the specs don't make, don't guess. Write it under "Open decisions" in the pull request summary and leave those cards out.
5. Commit, push, and open or update the pull request with a summary of the new and rewritten cards. Stop.
