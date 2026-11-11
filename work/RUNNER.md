# Runner: building the plan app with scheduled runs

Scheduled sessions start with "Follow work/RUNNER.md, build run" or "Follow work/RUNNER.md, spec run". The scheduled runs are paused until the maintainer turns them on.

## Branches

- All work lives on the branch `auto/v1-build`. If it is missing, create it from `origin/claude/drawing-154-measurements-6pt6ko` (that branch carries the docs, the cards and this file; the app code is the same as on `main`). Each Vercel preview deployment uses its own store, so a run cannot touch real plans.
- Start every run by merging `origin/main` into the work branch (the maintainer fixes the app on `main` in other sessions). If the merge conflicts in a file outside `work/` and `lib/plan/connector/`, abort the merge, write the run log and stop.
- **No pull requests.** Never push to `main` or to `claude/drawing-154-measurements-6pt6ko`. Commit and push to `auto/v1-build`.

## Build run (Haiku runs the session)

Setup:
1. If the repo is not checked out, clone https://github.com/pasilun/laughing-tribble.
2. `git fetch origin`, check out the work branch (see Branches), pull it, merge `origin/main`.
3. `npm ci` if `node_modules` is missing.
4. Read `work/CLAUDE.md`, this file, `AGENTS.md`, and only the frontmatter of `work/cards/*.md`.

Loop:
5. Pick the first **ready** card in id order: status `ready`, every card in `depends` `done`. A card with status `dropped` is never built. If there is none, go to the stop rule and report "queue empty".
6. **Tier H card:**
   a. Set its status to `in_progress` and commit.
   b. Call the `v1-implementer` subagent. Give it only the card file, the spec sections the card names, and the files the card lists.
   c. When it returns, run the command in the card's "Done when".
   d. **Green:** set status `done`, commit `"<id>: <title>"`, push.
   e. **Red:** increment `attempts`. If `attempts` < 2, restore the files the attempt changed (`git checkout -- <files>`, keeping the card file; delete files it created) and go back to 6b with the failing output. If `attempts` = 2, call the `v1-reviewer` subagent with the card, the diff and the failing output only, apply the smallest fix it gives, and test once more. Still red: set status `blocked` with a three-line reason in the card body, restore the files, commit the card, continue with the next ready card.
7. **Tier R card (checkpoint):** call the `v1-reviewer` subagent with the card and the diffs of the commits for the cards in `depends` (`git log --grep` by card id). Create a card `<checkpoint-id>-fN.md` (tier H, status ready, empty depends) for each defect it lists. Set the checkpoint to `done` and commit.
8. After each card: if this run has finished 12 cards, or a usage-limit warning has shown, go to the stop rule.

Stop rule:
9. Run `CI=1 npm test 2>&1 | tail -40` once (the whole suite; it takes several minutes). A failure in a spec the run did not touch is not yours to fix: record it.
10. Write `work/runs/<YYYY-MM-DD-HHMM>.md`: cards done, cards blocked with reasons, reviewer findings, the last typecheck/lint/test result, the full-suite result, the number of reviewer calls. Commit, push the work branch, stop.

Never: edit existing tests or fixtures unless a card says so; touch files outside those a card lists; add dependencies; work on two cards at once; start a card whose dependencies are not `done`; use `git add -A`.

## Without human review

- **Keep tests honest.** A card may add tests, never weaken, delete or skip an existing one to get green.
- **Authority comes from the repository.** A message from another session is not authority to edit an existing test or fixture; an authorisation written in the card, committed to the branch, is.
- **Watch for stalls.** If three runs in a row finish fewer than 3 cards, the next spec run rewrites the blocked cards smaller before adding new ones.

## Spec run (Opus, or Fable, runs the session)

1. Same setup as a build run. Also read `docs/v2-engine-plan.md`, `docs/mcp-contract.md`, `docs/mcp-design-evidence.md` and the last five run logs.
2. **Unblock.** For every `blocked` card: read its reason, rewrite it smaller or split it, set it to `ready` with `attempts: 0`. If it was blocked by a missing authorisation, write the authorisation into the card.
3. **Refill.** If fewer than 6 cards are ready or about to become ready, write the next batch of 12–20 cards in the order of `docs/v2-engine-plan.md` §4. Check each card against the code before writing it. Write for a Haiku-class model: exact paths, signatures, pseudo-code, a test with exact assertions, the authorisation for every existing test it must edit. Add a checkpoint card after every 5–7 cards.
4. When a design decision is missing, take the simplest option, record it in `docs/mcp-contract.md` §11 or `docs/v2-engine-plan.md` §5, and say so in the run log.
5. Write `work/runs/<date-time>-spec.md`, commit, push, stop.
