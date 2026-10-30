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
