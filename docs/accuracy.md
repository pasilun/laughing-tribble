# Accuracy of traced plans

A plan traced from a drawing is only as good as the scale it was calibrated to and the
walls it was snapped to. The printed dimensions on the drawing are the truth; everything
else is measured against them.

## What the tools do

1. **`plan_scan_dimension`** – Claude gives the rough ends of the printed overall dimension
   lines and their printed values. The end strokes (extension lines, ticks) are found in
   the image to about a pixel (`lib/plan/scan/dimension.ts`), so the scale does not depend
   on eyeballed pixel positions. A scan is often stretched more along one axis than the
   other (the cellar drawing: 6.41 mm/px across, 6.33 mm/px along, 1.3 %); when the
   horizontal and vertical dimensions disagree by more than 0.5 % `apply` resamples the
   image to one scale. Do this before tracing.
2. **Snapping** (`plan_scan_snap_walls`) fits each traced wall to the ink.
3. **`plan_finish`** with `printed_outer_mm` compares the traced outside size with the
   printed one (more than 30 mm off is flagged) and with `fit_outer` scales the plan to
   it when it is less than 3 % off (op `scale`: per axis, wall thicknesses and opening
   sizes stay, the source follows).
4. **Window bands** (`plan_scan_openings`, method `fönsterband`) – older drawings fill the
   wall black and leave a window as two thin face lines with an empty core. A hollow
   stretch between solid parts of an exterior wall is a window; its width is the whole
   stretch (flagged "kontrollera bredd"). Judged from the ink across the wall, not from
   the nominal thickness (stable for ±60 mm in position and 260–380 mm in thickness on
   the cellar drawing). A narrow dark post inside a hollow stretch (up to ~250 mm: a mullion, the
   rounded blob in the right cellar window) does not end the window; piers are wider. The
   cellar's right window is therefore ~1.5 m, from pier to pier, not the 0.9 m after the post.

## Limits

A hand-drawn 1:100 sheet has pen lines 50–100 mm wide in reality: asking for better than
about 50 mm from it is false precision. Beyond that only a measurement on site helps.

## The flat as a golden case

`e2e/plan-flat.spec.ts` uses the user's model of lgh 152–154 (`e2e/fixtures/flat/reference.json`,
rev 40) and a crop of the 1999 survey (`a00-crop.png`, the straightened A00:24, 1.4 × 1.7k px).
The model's walls are shifted by a seeded error (60 and 120 mm), the snapper puts them back,
and the openings are read from the drawing with the walls only. Both are scored against the model.

The model was traced from this same drawing, so the score says how well the tools reproduce a
careful tracing; it is not independent truth (the cellar's printed dimensions are). The north-west
corner of 152 (kitchenette, WC, stair; `UNCERTAIN` in the spec) is where the laser measurements and
the model differ most: measured, listed, kept out of the limits.

Baseline today (the limits in the spec): walls median ~25 mm off, about three quarters within
50 mm, none further than 150 mm and none turned. **Windows 7 of 7 found, none extra** (method
`fönsterlinjer`, see below). Doors and openings 4 of 18: the model's openings are laser measurements
(independent of the drawing), and the survey shows only a few of them: doorways as a dashed face
or a centre mark are read, but the entrance doors in the stair wall and several WC and closet doors
are drawn as an unbroken wall, so no drawing reader can find them.

The 1999 survey draws an exterior wall as two face lines with a white core and a window as two thin
sill lines across that core between chamfered reveals. `findWindowLines` (`plan_scan_openings`,
method `fönsterlinjer`) finds stretches of an exterior wall whose core carries thin line ink and no
thick stroke (not a pier or a crossing wall), and extends them by the reveals (70 mm a side). Tested
for wall position ±28 mm and thickness 340–455 mm: 63 of 63 windows. Where windows are read on a
facade, the gap and dash readers are ignored on that wall (they find the wall between the windows).
The two window methods are for two drawing styles: `fönsterband` for a wall drawn solid black with
hollow window stretches (the cellar), `fönsterlinjer` for an outlined wall with sill lines.

Found by this case: a fit through two stray cross-sections made a short wall a 10 m diagonal at 74° and
still reported "ok". Now a fit that leaves the search window, rests on fewer than three sections or
turns a wall more than 4° does not move the wall (or only its position), and says so.

## Scoring

`e2e/plan-cellar.spec.ts` runs the cellar drawing (`e2e/fixtures/cellar/kallare.png`)
through the dimension finder, the straightening and the window reader with the printed
size and the expected windows as the truth.

`npx tsx scripts/score-trace.mts <host> <key> <plan-id> --printed 6080x10500
[--reference <plan-id>]` scores any plan on a host: outside size against the printed one,
what `plan_finish` would still flag, and (with a reference plan of the same floor) the
wall and opening match from `e2e/golden.ts`. The reference is another tracing, not the
truth; room areas are compared by room id, so they match only between plans that share ids.

## The 1999 survey as drawn (fixture)

`e2e/fixtures/flat/drawing-1999.json` is lgh 152–154 exactly as the 1999 survey (A00:24, straightened, crop
`a00-crop.png`, placement `case.json`) draws it: no laser measurements, no later changes (the kitchen wall in 153 is
whole, no shower cabins), no rooms, fixtures or door swings (the survey does not show which way a door opens; every door
is a plain opening). 35 walls, 2 masses (the tapered stair wall in 152 and the stack beside its G), 23 doorways and
7 windows. It was built with the maintainer room by room on 2026-11-12 and is the reference for scoring a trace of the
survey from scratch. `e2e/plan-flat-1999.spec.ts` checks it stays valid. Change it only with the maintainer.

Door markings in this survey that a reader has to know: a doorway in a solid wall is a hollow stretch between two cross
bars; in a double-line wall it is a gap between two ticks; a dashed stretch of wall is a doorway too. A round symbol by a
wet room is a stack (stam), drawn as a solid mass. Counters, WC bowls, basins and the boxes inside closets are drawn
fixtures, not walls.

### Benchmark: tracing the survey from scratch

`e2e/bench-trace-1999.spec.ts` (`@slow`) runs `source trace` on an empty plan with the crop at its known scale and
scores the result against the fixture with `lib/plan/bench/score.ts` (walls by length within 50/100/200 mm of a
reference centre line, precision within 100 mm; doorways and windows by centre within 300 mm on the right wall line;
door swings not scored). The scores go to `test-results/bench-trace-1999.json`. Baseline 2026-11-12:

| | Result |
|---|---|
| Wall length found within 100 mm | 24.7 % (34 of 112 m traced; 19.3 % within 50, 26.6 % within 200) |
| Traced length that is on a reference wall | 80.8 % |
| Median offset of walls found | 59 mm |
| Doorways found | 1 of 23 (6 extra) |
| Windows found | 2 of 7 (1 extra) |

What is missing, from the picture of the trace: the east and west exterior walls, most of the north and south walls,
nearly all partitions drawn as two thin lines (the room-dividing walls in 152 and 153, the hall walls), the wet-room
block, and every doorway drawn as a hollow stretch, a dashed stretch or between ticks. Some traced walls are text
underlines and room labels ("102 vent", "Hall").

After the double-line work (2026-11-12): wall length found within 100 mm **61.9 %** (from 24.7 %), precision 84.1 %,
median offset 12 mm, windows **7 of 7**, doorways 6 of 23. Three changes in `lib/plan/scan/detect.ts`,
`lib/plan/scan/pieces.ts` and `lib/plan/assist/trace.ts`:
- a long face line pairs with each shorter piece of the opposite face (a face broken by crossing walls), unless the
  piece is a lone short line (a fixture edge beside a wall: a bathtub rim, a box in a hall);
- pieces are joined before short ones are dropped, and the detector may return more than 150 proposals to trace;
- a thick wall found as two strips side by side (an exterior wall with window sills between its faces) is merged into
  one, and a long detected wall the snapper cannot confirm is kept where it was detected.
The golden case (`e2e/plan-golden.spec.ts`) is a synthetic drawing made from its reference: exact, but clean, so it
guards against regressions (it caught the fixture edges above) rather than measuring real scans.
