# Plan: a better wall reader for scanned archive drawings

Written 2026-11-15, decided with the maintainer after looking at a region trace of flat 154. Walls first, measured on
small sections of the drawing; openings later, with a benchmark of their own. Nothing here changes the connector: a
better reader is a better answer from the same `source` (action "trace") and `scan` calls.

## Why

A trace of flat 154 alone (`source` "trace" with a region, 2026-11-15) scored against the 1999 fixture:

| | Flat 154 west (6 × 5.5 m) |
|---|---|
| Wall length within 100 mm | 58 % |
| Within 50 mm | 41 % |
| Traced length on a real wall | 89 % |
| Median offset | 28 mm |

What went wrong, wall by wall:

| Cause | Example | Length affected |
|---|---|---|
| A. Walls drawn as two thin lines are missed or found on one line | Party wall at x 26 300: 1.5 of 5.1 m found. Bath wall at y 16 700: one line, 56 mm off, half thickness | ≈ 8 m |
| B. A fixture touching a wall merges with it | Cupboard column at x 22 400 read as a 430 mm wall; the thin wall beside it moved 87 mm, 285 mm thick | ≈ 2.5 m + 1 false wall |
| C. Ends stop at a crossing wall's face, not its centre line | West and south walls 200–900 mm short at each end | ≈ 1.5 m |
| D. Handwriting read as a wall | "102 vent" became a 395 mm wall | 1 false wall |
| E. Small tilts not straightened | WC wall 3° off vertical | small |

Underneath, two limits of the image: every archive scan is black and white (no grey levels to separate two lines that
nearly touch) at about 300 dpi, so a 100 mm wall is about 12 pixels across.

## Principles

1. **Small sections first.** Tune on tiles of about 6 × 5 m, where each error can be seen and named; only then check
   the whole sheet. A tile traces in 1–2 s, so an idea is tried in minutes.
2. **Separate benchmarks.** Walls, the cleaning step and openings are each scored on their own, so a wall error never
   hides or excuses an opening error. Openings are scored on the fixture's own walls.
3. **Held-back tiles.** Two tiles are for tuning, two are never looked at while tuning. A change that improves only the
   tuning tiles is overfitted and is dropped.
4. **No regression elsewhere.** Every change also runs the whole-crop benchmark (`e2e/bench-trace-1999.spec.ts`,
   61.9 % today) and the golden and cellar fixtures.
5. **The ink decides where; the newest drawing decides what.** Other drawings only sharpen positions (W6).
6. **I prototype, Haiku implements from cards.** T-07 showed that Haiku cannot design image processing; cards are
   written from code that already holds up on the held-back tiles.

## The test setup (W0)

**Tiles** (plan mm, on the straightened 1999 sheet `a00`, scored against `e2e/fixtures/flat/drawing-1999.json`):

| Tile | Region [x, y, w, h] | What makes it hard | Use |
|---|---|---|---|
| 154 west | [20400, 15500, 6100, 5500] | Cupboards against walls, outlined walls, labels, south facade with niches | Tune |
| 152 wet rooms | [19300, 7800, 5400, 5400] | Stair mass, riser circle, WC and bath fixtures, short walls | Tune |
| 153 kitchen and east | [24400, 7800, 5600, 5400] | Long thin partitions, counters, closets along the east wall | Held back |
| 153–154 middle | [22500, 12800, 7400, 4000] | Thick structural wall, shafts, door-heavy corridor | Held back |

**Scores per tile** (an extension of `lib/plan/bench/score.ts` with walls clipped to the tile, as in
`scripts/score-1999.ts`):
- wall length within 50 and 100 mm, precision at 100 mm, median offset;
- thickness error and end error per matched wall;
- **a per-wall list of what went wrong**, with a cause from the table above (missed, one line of two, merged with a
  fixture, short end, tilted, false: text or fixture), so we count causes instead of guessing them;
- a picture: the tile with the fixture's walls in green and the trace in red.

**Deliverables:** `e2e/bench-walls-tiles.spec.ts` (tagged @slow, writes `test-results/bench-walls-tiles.json` and the
pictures) and the baseline numbers in this document.

## The stages

Each stage: prototype, measure on all four tiles and the regression set, keep or drop, record the numbers here.

| Stage | What | Aimed at | How it is measured |
|---|---|---|---|
| **W0** | Tiles, scores, error causes, baseline | – | The table above, today's reader |
| **W1** | **Cleaning step** before wall detection: keep only ink in long straight runs along the axes (morphological opening with line elements of about 400 mm), drop small loose clusters (< 0.5 m) not touching the wall network. Only for finding walls; the opening reader keeps the original image | D (text), B (curved fixtures), symbols, door swings, dashed boundaries | **Its own score:** wall ink kept (target ≥ 99 %, measured against a mask of the fixture's walls) and other ink removed (higher is better). Picture: kept ink black, removed non-wall ink grey, wrongly removed wall ink red |
| **W2** | Today's detector on the cleaned image | How much W1 alone gives | Wall scores |
| **W3** | **Walls drawn as two thin lines:** find straight edges (line-segment detection on the image), pair parallel edges 60–300 mm apart with an empty core into one wall, centre between them, thickness across both | A | Wall scores; the "one line of two" count should fall to near zero |
| **W4** | **Ends and straightening:** run an end that stops at a crossing wall's face to its centre line (the join rule of T-10); make walls within 3° of an axis exactly straight | C, E | End error; "short end" and "tilted" counts |
| **W5** | **Straight fixtures:** a band whose width jumps along its length is cut there and the thin, steady stretch kept as the wall; a closed rectangle of thin lines pressed against a wall is a fixture | B (cupboards, counters) | "Merged with a fixture" count; thickness error |
| **W6** | **Cross-check with dated drawings:** fit each wall in every registered plan of the same floor (1936 plan, 1936 drain plan, 1936 structural for load-bearing walls) and take the median position. The newest drawing (1999) alone decides which walls exist; a wall missing from an older drawing is reported as "probably added since <year>", never removed or added | Local damage and merged lines in one scan | Wall scores with and without the cross-check; a list of disagreements, which should match the known changes |
| **W7** | **The 2002 ventilation drawing at 1:50** (twice the pixels per mm): fit it to the 1999 sheet, then use it as a fifth drawing in W6 where its wall lines are clear | Merged lines (resolution) | Thickness and offset error on the walls it covers |

Archive drawings and their dates: `docs/archive-drawings.md`.

**Targets for walls,** on every tile, held-back ones included: **85 % of wall length within 100 mm, 90 % precision,
median offset ≤ 15 mm, no false walls from text.** Then the whole crop: at least 80 % (61.9 % today).

## After walls: openings (O-stages, planned later)

- **O0:** an openings benchmark on the same tiles, given the fixture's own walls (the T-07 test is the start), with
  per-opening causes (doorway between cross bars, dashed stretch, gap between ticks, window between reveals).
- Then the parked T-07 doorway reader and the window reader, prototyped against it, on the original (uncleaned) image.
- Last, the whole chain: walls traced by the new reader, then openings on them.

## How it reaches the product

- Stages that hold up become cards for Haiku, written from the prototype as before (`work/cards/W-…`), with the tile
  benchmark as their test and limits that must not drop.
- The cleaning and the cross-check stay inside `source` (action "trace") and `scan` (actions "candidates",
  "snap_walls"): no new tool and no new action is needed. A `view` of the cleaned image could follow if it helps a
  client's Claude judge candidates.
- After each batch, rerun the Sonnet baseline (`docs/trace-workflow-plan.md`) with `scripts/score-1999.ts`.

## Effort

| Stage | Estimate |
|---|---|
| W0 tiles and baseline | half a session |
| W1 cleaning, W2 | one session |
| W3 two-line walls | one to two sessions (the largest gain, the hardest part) |
| W4 ends and straightening | half a session |
| W5 straight fixtures | one session |
| W6 cross-check | one session (registration exists; the date rule is new) |
| W7 the 2002 drawing | half a session, after fitting it |
| Cards for the stages that hold | one session |

## Risks

- **Overfitting to one drawing.** All four tiles come from the same 1999 sheet. Before the cards, the cellar drawing
  (its own fixture is still to be made) should be checked too, or at least looked at.
- **Cleaning loses short wall pieces.** Returns of 200–300 mm beside doorways may fall below the run length; the
  "wall ink kept" score will show it, and the run length is tuned on it.
- **Older drawings disagree for real.** The cross-check must never move a wall towards a position that only an older
  drawing has; it uses the median only where the newest drawing has the wall too.
- **Line-segment detection on black-and-white images** is less exact than on grey ones; if W3 stalls on that, the
  fallback is profiles across the band (what `scan` "profile" does) at each candidate wall.

## Questions for the maintainer

- Can the archive rescan one sheet (A00:24) in grey at 400–600 dpi? It would show how much of the merging is the scan
  rather than the drawing.
- Should the remaining sheets in the Drive folder be indexed (floor, year) now, or only when a stage needs them?

## Results so far (2026-11-15, prototypes in `scripts/wallbench/`)

Run with `npx tsx scripts/wallbench/<script>.mts <tile>`; each writes a picture (fixture green, trace red, orange where
they agree). Scores are wall length within 100 mm of a fixture wall, on the tile only.

**What the pictures showed.** Almost every wall of the 1999 survey is drawn as two thin outlines, one per room, with
the white wall body between them (the big room of 154: two lines 17 px apart, the wall centred in the gap). The old
detector looks for solid bands, so it misses these walls or locks onto one outline. Text and fixtures cause only a few
false walls; most of the loss is missing walls.

**W1 (cleaning), tried first and set aside.** Keeping only ink in long straight runs removes handwriting (as hoped),
but changes nothing for the detector (same 10 walls, same score): text is not what it trips on. A thickness filter
(solid bands only) loses real walls, since partitions are drawn 4–6 px thick, as thin as lettering. Cleaning stays a
possible later step against false walls from fixtures; it is not where the gain is.

**W3 (pairing) first, and it is the gain.** `pairs.mts`: find long axis-aligned lines (runs ≥ 340 mm with gaps ≤ 3 px
bridged, runs of neighbouring rows merged), pair facing lines 40–520 mm apart whose core is empty (centre in the gap,
the gap as thickness), keep unpaired bands ≥ 9 px thick and ≥ 700 mm long.

| Tile | Old detector | Pairing (all pairs) | Pairing + old detector where uncovered |
|---|---|---|---|
| 154 west (tuned on) | 62 % | 78 % | **84 %** (precision 81 %) |
| 152 wet rooms (tuned on) | 37 % | 60 % | **66 %** (precision 63 %) |
| 153 kitchen and east (held back) | 70 % | 64 % | **88 %** (precision 78 %) |
| Middle strip (held back) | 56 % | 72 % | **72 %** (precision 71 %) |

Pairing with only the single nearest partner per line (mutual nearest) was worse (56 % on 154 west): a facade with
hatch lines has nearer lines than the outer face. Median offset falls from 12–50 mm to 7–25 mm where pairs are found.
Both reader kinds together beat either alone on every tile, held-back ones included.

**What is wrong now** (from the pictures): (1) outlines only 3–4 px apart (the central wall of 152) are neither a pair
(gap below the minimum) nor a band (each line too thin): merge lines closer than the minimum gap into one thick line
first; (2) false walls from the underline of lettering, the lines through a WC bowl or sink, and a dashed centre line
paired with a room outline: check the ink coverage of each paired line along the wall (dashes and text strokes are
broken), and reject a line that touches lettering; (3) `joinPieces` bridges gaps of up to 2 m between unrelated short
pieces on one line (a false wall across a kitchen): join only across doorway-sized gaps and only pieces that are walls
by themselves; (4) the dashed partition at y 16 700 in 154 is still missed.

## The annotator experiment (2026-11-15, flat 154 west)

Idea (from the maintainer): let a model look at the tile first and mark what is not wall (text, fixtures, symbols,
dashed lines) and give a point inside every room, then use those marks as a filter and a guide for the detector. The
model decides *what* things are; the ink decides *where* (its boxes and points are rough and never become geometry).
`scripts/wallbench/grid.mts` makes the picture the annotator sees (a grid in tile px), `annotate.mts` applies its marks.

**How the marks are used** (all deterministic):
1. *Remove boxes:* ink inside a box is erased unless it belongs to a straight run that leaves the box (a wall crossing
   a box always does; lettering and an underline touching a wall do not). Boxes of kind "dashed" are not erased (a
   dashed line can be a wall with an opening).
2. *Room points:* a fill from all points at once through white paper. A region that is long and thin (largest
   inscribed circle ≤ 26 px ≈ 220 mm, area > 3 × its circle's square) is the white body of a wall, not a room, and is
   dropped whatever the annotator called it. (The first attempts put an "outside" point inside the south wall's window
   niche; the fill ran along the wall body.)
3. *Walls vs rooms:* a candidate wall is dropped when both its sides lie in the same room (a counter, an underline) or
   when its centre line mostly lies in a labelled room (the white core of a real wall is enclosed by its two outlines
   and no fill from a room point reaches it; a line inside a room is leaked into through dashes).

**Result on flat 154 west** (a fresh Sonnet annotator that never saw the fixture; recall and precision at 100 mm):

| | Recall | Precision |
|---|---|---|
| Pairing + old detector, no marks | 84 % | 81 % |
| + remove boxes (attempt 1 / attempt 2) | 86 % / 84 % | 78 % / 83 % |
| + rooms (attempt 1 / attempt 2) | 80 % / 79 % | 88 % / **95 %** |

**What the maintainer saw in attempt 1, and what changed for attempt 2:** it boxed only part of the kitchen units along
the west wall, gave no point to the small rooms (WC, garderob) and boxed a room as a fixture, and a point landed in the
south wall. Attempt 2 got written conventions: a run of kitchen units is one fixture, boxed end to end; a small closed
outline without inner detail is a room, even a tiny one, and gets a point, never a box. It then gave a point to
nearly every closed outline. It still boxed only the middle of the kitchen run, and misnamed rooms (names are not used).
Both observations are general conventions and belong in the trace guide's registry of drawing conventions.

**Open:** a second pass in which the annotator sees its own marks drawn on the picture and fixes what it missed (the
"judge every step" loop that built the fixture); the false vertical at x≈487 (a cupboard bar paired with an outline);
the dashed partition at y≈330 is still missed; four tiles instead of one.

### Attempt 3: a room census first (maintainer's idea)

The annotator lists the rooms it expects from the evidence before marking anything: one room per handwritten name,
one WC per toilet bowl (a WC often has no label), one closet per empty closed outline, with the count; then one point
per census entry, then the boxes. `scripts/wallbench/census.mts` tabulates, per filled room, the labels and fixtures
inside it and its size, so each region gets a type from its evidence.

| Attempt | Recall | Precision | What the pictures showed |
|---|---|---|---|
| 1: marks only | 80 % | 88 % | kitchen run partly boxed; WC and garderob without points; a point in the south wall |
| 2: + conventions | 79 % | **95 %** | points for nearly every outline; kitchen run still partly boxed; names wrong |
| 3: + census | 79 % | 93 % | **kitchen run boxed end to end**, WC found by its bowl, names match the evidence, six regions for six census entries |

Checks the census allows (deterministic): a region with no label and no fixture under about 0.4 m² is a cupboard, not a
room (the 0.1 m² rectangle); a region with a bowl is a WC; the number of filled regions should equal the census count.

**New finding (from the picture):** the kitchen and the Matvrå regions were separated at y≈500, not at the wall at
y≈660. The wall is a thick dashed partition (the annotator boxed it as "dashed, not a wall"); the fill leaked through
its gaps and the two fronts met in the middle. Next: where two census rooms touch with no ink along their common
boundary, that boundary is an unclosed wall: take its rough ends, look for collinear dashes along it, and propose the
wall (rough ends to `snap_walls`, which fits it to the ink). This should also find the dashed partition that is still
missed.

### Three models, same tile and census prompt (2026-11-15)

Sonnet, Opus and Haiku annotated flat 154 west with the same prompt (one run each; marks in `scripts/wallbench/marks/`,
side-by-side pictures made with `scripts/wallbench/montage.mts`). One run per model on one tile cannot separate a model
effect from run-to-run noise; read it as "does the method survive a weak annotator".

| | Sonnet | Opus | Haiku |
|---|---|---|---|
| Census entries (6 rooms in the tile) | 6 | 6 | **15** |
| Kitchen run boxed end to end | yes | yes (longer) | no |
| WC from the bowl | yes | yes | yes |
| Window hatching erased as "stair treads" | no | no | **yes** |
| Wall recall / precision (100 mm) | 79 % / 93 % | 73 % / 85 % | 72 % / 95 % |
| Dashed partition at y≈330 | missed | missed | found (not by skill) |

Findings: Opus gave no gain over Sonnet. Its two extra false verticals come from boxing a dashed line but not the
cupboard bar beside it. Haiku's census and boxes are the weakest; its 95 % precision is the engine's wall-body guard
dropping four of its junk points. The engine guards (wall bodies, lines inside rooms) matter more than the model. All
three get the Kök/Matvrå boundary wrong the same way (the fill leaks through the dashed partition), and all three leave
the cupboard column at the top left as a false wall: those are engine problems, not annotation problems.

## Top-down: understand the flat first (2026-11-15, maintainer's direction)

Order: (1) understand the flat at a high level (conventions, outline, entrance, rooms, neighbours), (2) clean the ink in a
few passes guided by that, (3) hand the cleaned image to the wall finder, steered by the rooms (a wall where two rooms
meet, none inside a room), (4) compare the result with step 1 and look at it with fresh eyes as a flat. Sonnet only. Every
step produces a picture for the maintainer to judge (`scripts/wallbench/step1viz.mts`; the flat picture with a grid in
plan mm from `flatgrid.mts`).

**Step 1 on flat 154, two runs** (answers in `scripts/wallbench/steps/`; the maintainer's outline and entrance, marked on
the first picture, in `steps/154-step1-reference.json`):
- Run 1 (no rules about what belongs to a flat): west, south and east sides right; took in two of the neighbour's rooms
  in the north-east; entrance guessed on the east wall; north strip named by guess.
- Run 2 (general rules: one entrance from the stair, a room belongs to the flat only if reached from inside it, mark
  uncertain rooms): worse. It dropped the whole north part (entry hall, WC) as uncertain, put the entrance on the west
  wall, and concluded the flat might be only the big room.

**Lesson:** the model cannot see this drawing's door markings (gaps and ticks, no swings), and reasoning about ownership
without doors goes wrong either way; drawing outlines and rectangles is the part models are weakest at. **Next:** split
step 1 into geometry by the engine and judgement by the model: the engine divides the white paper into enclosed regions
(cut at doorway-wide gaps) and numbers them on the picture; the model answers by number which regions are the flat,
which is the entry hall, the name of each, and which are the neighbour's or the stair. The outline then follows exactly
from the chosen regions.

## Paused (2026-11-16): where the work stands

**Step 1 by the model does not work on this drawing** (three Sonnet runs, three different wrong answers about which
rooms are the flat and where the entrance is: it cannot see the door markings or read the handwriting). Step 1 was done
by hand instead, on the engine's numbered regions (`steps/154-step1-manual.json`); in the product that is one or two
answers from the user per flat.

**Step 1a (engine) works:** `regions.mts` divides the paper into regions split at doorway-wide necks, using only the wall
network as barriers (ink pieces at least 2 m across, plus rows of thick dashes, which are walls drawn dashed; lettering,
specks and thin lines left out).

**The whole flat from confirmed rooms** (`flat.mts`, flat 154, scored against the fixture's walls of the flat):

| | Recall (100 mm) | Precision |
|---|---|---|
| Raw drawing (pairing + old detector), walls of the flat | 83 % | 90 % |
| Wall network only as ink | **95 %** | 67 % |
| + room rules (wall bodies from step 1 not counted as spaces) | **95 %** | **80 %** |
| + cutting candidates where they run inside a room | 83 % | 80 % (dropped) |

**The six false walls left** (from the per-wall listing, `DEBUG=1`), and what each needs:
1. A wall drawn on the outline of the stair, x 22671, the full height of the tile, beside the real wall at 22664 with
   thickness 68: a duplicate of a real wall on one of its outlines. Needs: merge a thin candidate into a thicker one
   on the same line within half its thickness.
2. The stair wall at y 15656 run on from 20061 to 26770: right in the west, extended across the hall and bathroom.
   Needs: joins across gaps only where the gap is a doorway between two different rooms.
3. A horizontal at y 15303 across the hall (the underline of a number that the regions treat as a wall).
4. Two verticals at x 22178 and 22455 in the kitchen (the cupboard column; one side is a region-less cupboard cell).
5. A horizontal at y 17008 in the big room (a room number's underline, 374 mm "thick").

Items 3–5 are lettering and furniture that the wall network keeps because they touch a wall: the annotator's boxes
(which worked on the tile) are the tool for them. Next when resumed: put the annotator's text and fixture boxes into
`flat.mts`, fix items 1–2, then run the held-back tiles and the whole crop with no tuning.
