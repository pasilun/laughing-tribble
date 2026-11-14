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

## Hand trial, cellar drawing (2026-11-13, after T-01 to T-04)

Plan `kallare-handtest-av-sparningsf-4e8e43488b98556b`: the cellar drawing (calibrated, primary), a fresh draft from
`source` "trace", then the walls by the method, done by Claude in a session with the production connector.

**Calls for the walls:** 4 candidate views (6 × 6 m regions), 3 snaps, 6 edits: 13 calls, no coordinate typed except
two rough ends that the snap fitted and one bend point (see below).

**What worked**
- Answering by number. 18 candidates judged; 1 accepted as is, 3 turned into a mass (a chimney block), 2 confirmed a
  wall that needed joining, the rest rejected (an edge of an existing wall, stair treads, the outside stair). Positions
  all came from the ink.
- Judging in small regions with the drawing under the plan: the stair treads that the draft had as three walls were
  obvious at once, and so was the chimney block.
- Unknown names and limits answered clearly (`candidates` before the deploy, a region over 6 × 6 m).

**What the trial found missing**
1. **Too-short walls.** The candidates skip anything that overlaps an existing wall, so the missing part of a wall that
   is too short (the east wall stopped 2 m short at both ends; a dividing wall had a 2 m gap) was never offered. Fix:
   offer the parts of a detected piece that extend beyond an existing wall's ends, as "extend wall X to …".
2. **Re-fitting an existing wall.** `snap_walls` with `walls` only adds, so extending a wall takes an edit and then a
   snap by id. Fix: let `walls` carry an existing id and treat it as an update, or say so in the guide.
3. **Curved walls.** None in the model; the curved wall became a straight part and an angled part. The bend's lower
   end was read off the picture (about y 6400), which the rule forbids. A snap that fits a straight wall at any angle
   to a stretch of ink, given rough ends, would close this.
4. **Draft walls that are not walls.** Most of the work was spotting wrong walls already in the draft (stair treads),
   which the candidates do not show. T-06 should list, per piece, the draft walls to look at first: short, parallel,
   evenly spaced ones (treads), walls inside a room with free ends, walls the audit finds no ink for.
5. **Openings still fail** on this drawing with "fetch failed" (`UND_ERR_SOCKET`, Sentry PLAN-TOOL-2), in `trace` and
   in `scan` "openings" over all walls. Needs fixing before T-07.

**Verdict for the checkpoint:** answering by number is faster and safer than editing coordinates, and keeps the rule.
Before T-06 and T-07, add 1 and 2 (small), and fix 5.

## Scored trial on the 1999 survey (2026-11-13)

Plan `gnejsen-152-154-sparningstest--91c5c5f2d4b5c139`: the straightened survey `a00` (the whole sheet, not the crop),
`source` "trace", then the walls of 152–154 by the method, by Claude without the maintainer's help, in production.
Scored with `lib/plan/bench/score.ts` against the fixture, counting traced walls inside the fixture's area
(x 19000–30100, y 7500–21300). Walls only; doorways were not reached.

| | Draft (`trace`) | After the method | Fixture benchmark (crop, `trace` only) |
|---|---|---|---|
| Wall length within 100 mm | 44.6 % | **73.5 %** | 61.9 % |
| Within 50 mm | 41.8 % | 68.6 % | 55 % |
| Traced length on a real wall (100 mm) | 79.2 % | **96.8 %** | 84.1 % |
| Median offset | 5 mm | 8 mm | 12 mm |

**Calls:** 5 candidate views, 3 snaps, 5 edits (13 calls) for about 60 % of the floor area of the fixture. The draft took
longer than 60 s on the whole sheet (about 40 Mpx) and timed out for the client, though it finished and saved.

**What the method fixed:** 12 draft "walls" deleted (room labels "102 vent", "Tamb.", "102 vent" in 154, kitchen counters
and cupboards, duplicates); 16 walls added or joined, all at positions from the ink (candidates or snaps from rough ends).

**What is left (to reach the 85 % target):**
- Not reviewed: the south half of 154 (the dining room and the large rooms) and 152's south-west; and the doorways.
- The draft read the whole sheet (other flats too): 80 walls outside the fixture's area, which a real user would not
  want. `trace` needs a region (the part of the sheet the user asks for).
- A time limit: a whole sheet takes over a minute; `trace` should work in a region or in steps.

### Trial finished (revision 14)

Walls of all three flats reviewed, then the opening reader (which no longer fails: the "fetch failed" fix holds) over
17 walls, its 31 proposals judged against the drawing, the doubtful ones removed.

| | Draft | Walls by the method | Finished (rev 14) | Target |
|---|---|---|---|---|
| Wall length within 100 mm | 44.6 % | 73.5 % | **77.0 %** | 85 % |
| Traced length on a real wall | 79.2 % | 96.8 % | **99.6 %** | 90 % |
| Median offset | 5 mm | 8 mm | 5 mm | |
| Doorways found | – | – | **5 of 23** (3 extra) | 15 |
| Windows found | – | – | **1 of 7** (3 extra) | 7 |

About 30 calls in all. Precision is now excellent; recall is limited by short wall pieces in the wet rooms and closets.

**Openings are the gap.** The reader's proposals for exterior walls ("centre mark, width estimated" at 700 mm) land
beside the real windows, and it misses most doorways drawn as hollow stretches between cross bars. Within the rule
(no positions read off a picture) the method has no way to add an opening the reader does not offer: `edit` takes an
offset, which Claude can only read off the picture. So T-07 (reading the three doorway markings, and windows as the
whole stretch between reveals, with offsets from the ink) is what decides the doorway and window score, and is the next
step. Until then a user's Claude either leaves doorways out or breaks the rule.

**Bias:** the trial was run by the same Claude that built the fixture and knew where its doors are. It used that
knowledge only to choose which proposals to keep, never to place anything; a fair test is T-08 (a fresh agent).

### Correction (2026-11-14): how the trial was scored

The numbers above counted only walls with both ends inside the fixture's area, which leaves out the exterior walls
that run on past the three flats. Cutting each wall at the area's edge instead (`scripts/score-1999.ts`, mode `clip`,
the rule used from now on) gives for revision 14: **94.9 %** of wall length within 100 mm, 97.9 % on a real wall,
doorways 7 of 23 (3 extra), windows 3 of 7 (4 extra). On walls the method already passes the 85 % target.

## Baseline: Sonnet with today's connector (2026-11-14)

Step 1 of `docs/v2-engine-plan.md`, run from a session with no API key: two fresh Sonnet agents, each with only the
ten connector tools, no repository, nobody to ask, and the user's request "draw the existing walls, doorways and
windows of flats 152–154" with their rough area. Each got a plan with only the straightened sheet `a00` (already at
scale, so no calibration). Scored with `scripts/score-1999.ts` (clip).

| | Run 1 | Run 2 | Hand trial (method, rev 14) | Target |
|---|---|---|---|---|
| Wall length within 100 mm | 83.7 % | 67.7 % | 94.9 % | 85 % |
| Traced length on a real wall | 84.7 % | 91.1 % | 97.9 % | 90 % |
| Median offset | 10 mm | 5 mm | 5 mm | |
| Doorways | 2 of 23 | 2 of 23 | 7 of 23 | 15 |
| Windows | 7 of 7 (1 extra) | 6 of 7 (1 extra) | 3 of 7 | 7 |
| Tool calls | 24 | 25 | about 30 | |
| Time | 3.1 min | 3.2 min | | |

**What the agents did.** Neither made a draft with `source` "trace" nor followed the trace method; both drew the walls
from rough positions and fitted them with `snap_walls`. Run 1 drew the whole area; run 2 left out the west part
(x 19 000–22 600). Both read the window positions off the picture, because the opening reader proposed gaps in solid
wall and its window methods found nothing on the exterior walls: windows score well, but by breaking the rule. Neither
found the doorways drawn as hollow stretches; both asked whether dashed stretches are doorways.

**Faults found in the connector:**
- `scan` "snap_walls" with new rough walls (`args.walls`) answered "Internal error" three times; it only worked after
  the walls were added with `edit` and snapped by id.
- `edit` answered "Internal error" once, though the revision was saved; once a 502 with nothing saved, after which
  `get` briefly said "document not found".
- `get` warns that the source is not calibrated although it has a scale and is the primary source.

**What it says.** Without being led, Sonnet does not find the trace workflow (T-03's guide topic is not where it starts).
Walls are close to the target in a good run; doorways are the gap, as in the hand trial, and windows are only found by
reading the picture.
