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
   the cellar drawing).

## Limits

A hand-drawn 1:100 sheet has pen lines 50–100 mm wide in reality: asking for better than
about 50 mm from it is false precision. Beyond that only a measurement on site helps.

## Scoring

`e2e/plan-cellar.spec.ts` runs the cellar drawing (`e2e/fixtures/cellar/kallare.png`)
through the dimension finder, the straightening and the window reader with the printed
size and the expected windows as the truth.

`npx tsx scripts/score-trace.mts <host> <key> <plan-id> --printed 6080x10500
[--reference <plan-id>]` scores any plan on a host: outside size against the printed one,
what `plan_finish` would still flag, and (with a reference plan of the same floor) the
wall and opening match from `e2e/golden.ts`. The reference is another tracing, not the
truth; room areas are compared by room id, so they match only between plans that share ids.
