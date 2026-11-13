# Plan: tracing a scanned drawing with the user's own Claude

Written 2026-11-13. Decided with the maintainer: the next step for turning old scanned drawings into plans is a
**workflow that the user's own Claude follows through the connector**, not a model inside Planstudio. Planstudio pays
nothing per drawing; the quality depends on the client's model.

## Why

- **Pretrained models do not read these drawings.** A FloorplanVLM-style adapter (Qwen2.5-VL-3B, the only runnable form
  of that paper) scored 0 % of wall length within 100 mm on the 1999 survey; its outline was 600 mm wider than the
  image. Everything open is trained on CubiCasa5K (Nordic CAD plans, non-commercial licence). See
  `docs/spike-pretrained-scan.md`.
- **The custom tracer finds 61.9 % of wall length** (`e2e/bench-trace-1999.spec.ts`). Its errors are of a kind a
  person spots at a glance: text and fixtures read as walls, door markings missed, a riser symbol read as a column.
- **The fixture for that benchmark was built by Claude and the maintainer together** (2026-11-12): the engine measured
  (snapping to ink, the audit), Claude judged in small zoomed crops, the maintainer corrected about ten times. The
  result is the best trace of the survey there is.

The workflow writes that way of working into the engine, so that any client's Claude can follow it: the engine
proposes and measures, Claude judges in small pieces, the engine checks, and only what stays unclear goes to the person.

## The rule

**Claude decides what is there; the ink decides where.** Claude names elements (this is a wall, that is a bathtub, this
hollow stretch is a door) and gives rough positions only to point at something; every position that is saved comes from
snapping to the drawing or from a printed dimension. This is the contract's rule ("never take a measurement from a
picture") made workable.

## The workflow, as Claude will see it

1. **Calibrate and draft.** `source` (action "trace") with the printed outer size: a first draft from the custom tracer
   (today 62 % of wall length).
2. **Outline first.** `check` (scope "trace") names the outline as the first piece to review: exterior walls, the stair,
   the party walls. Claude looks at the numbered view of that piece and answers by number.
3. **Room by room.** `check` lists the pieces of the plan (rooms where it can find them, else tiles of about
   4 × 4 m) with what is unreviewed or flagged in each; its `next` is the view of the next piece.
4. **In each piece:** keep, drop or relabel each numbered candidate; add what is missing by pointing ("a wall from
   about here to about there"), which the engine snaps; read the doorways from the drawing's markings.
5. **Verify.** For each piece, a fresh look at the overlay and the audit's findings for it; fix and repeat until the
   piece is clean.
6. **Ask.** What is still unclear (a door the drawing does not mark, a symbol it cannot place) goes to the person as one
   short list, not as guesses.
7. **Finish** as today: rooms, title block, export.

## What the engine needs (the cards)

None of this changes the tool list; each is a new name in a registry or a new field in `data`.

| # | Card | What | Size |
|---|---|---|---|
| T-01 | **Answers carry their substance in `data`** | Some clients read only `structuredContent`. Today the text of `get` (the listing), `scan` (the readings) and `guide` lands only in the text block, so such a client sees an answer with no content (seen in this session). Put the listing, the readings and the guide text in `data` too. | S |
| T-02 | **The default source is the calibrated one** | With several sources, views, scans and audits take the first one; on the basplan that was the unstraightened scan and every check looked wrong. Default to the source the plan was calibrated or registered against, and say which one was used. | S |
| T-03 | **Guide topic "trace"** | The working order above, the rule, and the drawing conventions found so far: doorway markings (a hollow stretch between cross bars, a dashed stretch, a gap between ticks), a round symbol by a wet room is a riser (solid), counters, WC bowls, basins, bathtubs and boxes in closets are fixtures, a tapered stair wall is a mass, labels and underlines are text. Generated from a registry of conventions so a new one shows the same day. | S |
| T-04 | **Numbered candidates** | `view` (view "candidates", region): the drawing with the plan's walls and the detector's unused proposals drawn and numbered. `data.candidates` lists each number with its id, kind (wall in the plan, proposal), rough position and length. | M |
| T-05 | **Answer by number** | Operations for `edit`: keep a proposal (`accept`, by number from the last candidates view, snapped on the way in), drop a wall (`delete`, exists), add a wall from rough ends and snap it (`add` with `snap: true`), mark a wall as a mass, mark an element as checked. | M |
| T-06 | **Pieces and progress** | `check` (scope "trace"): the plan split into pieces (outline, then rooms from the room grid, else tiles), each with unreviewed walls, open audit findings and unmarked doorways; `next` is the view of the first unfinished piece. Progress lives in the plan as a list of checked pieces with the revision they were checked at, so a later change reopens them. | M |
| T-07 | **Doorway markings** | A `scan` action that reads the three doorway markings along one wall and proposes openings (the custom opening reader misses all three on the survey; this was the largest gap in the fixture work). | M |
| T-08 | **The experiment** | A Sonnet agent with only the connector, no person, follows `guide` (topic "trace") on a fresh copy of the 1999 survey; its result is scored with `lib/plan/bench/score.ts`. Recorded: the scores, number of calls, image tokens, time, and every question it would have asked. | M |

T-01 and T-02 are worth doing whatever happens; T-03 to T-07 are the workflow; T-08 decides whether it works.

## Order and checkpoints

1. **T-01, T-02** (fixes that matter already).
2. **T-03, T-04, T-05**: enough to try the loop by hand in a session like this one, on the cellar drawing (which has no
   fixture yet). Checkpoint: is answering by number faster and more reliable than editing coordinates?
3. **T-06, T-07.**
4. **T-08** against the 1999 fixture. Then a fixture for the cellar drawing, and the same experiment there.

## Success

The experiment, with no person: **at least 85 % of wall length within 100 mm, precision at least 90 %, 7 of 7 windows,
and most doorways (15 of 23)**, against 61.9 % / 84 % / 7 / 6 today; at a cost that a user would accept from their own
Claude (a few hundred calls at most). The questions it asks should be ones the drawing cannot answer.

If it falls clearly short, the useful parts stay (T-01, T-02, T-07 help every user) and the next option is a
server-side variant with the same steps (a `trace` mode that calls the API), which needs an API key and a decision on
cost.

## How it is built

Cards T-01 to T-07 go to the build runner (`work/cards/`, Haiku implements, Opus reviews), written from code
prototyped first, as for the connector batches. T-08 is run from a session with the Agent tool. Nothing here changes
the connector contract: the tool list stays frozen.
