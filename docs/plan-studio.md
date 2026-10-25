# Planritning före/efter (plan studio)

Draws, versions and exports floor plans for an **anmälan** about interior
work, e.g. joining two neighbouring apartments: a new opening in the wall
between them, a kitchen removed, a radiator moved, ventilation adjusted.

## Use it

- `/plans` — list and create plans (empty or the made-up example).
- `/plans/<id>` — the editor (desktop). Phones get a read-only sheet + PDF.
- Claude, via MCP (`/api/mcp`): `plan_list`, `plan_create`, `plan_get`,
  `plan_edit`, `plan_check`, `plan_revisions`.

Typical flow: create a plan → *Underlag* tab → load the archive scan from
Bygg- och plantjänsten (TIF works) → *Kalibrera*: click both ends of the
scale bar (or a known dimension) and type the real length → draw walls on
top (*Rita längs väggliv* follows the wall face you see on the scan) →
mark walls/openings/fixtures as *Befintlig / Rivs / Ny* → fill in the title
block → check the *Kontroll* tab → *Spara* → *Exportera* PDF.

## Access

Set `PLAN_PASSWORD` in the deployment. Then `/plans` asks for it once
(httpOnly cookie), the API accepts `Authorization: Bearer <password>`, and
Claude's MCP connector uses `/api/mcp?key=<password>` for the plan tools.
Without `PLAN_PASSWORD` (local development) everything is open. Plan ids
carry a 64-bit random suffix.

## Model (`lib/plan/types.ts`)

Integer millimetres, x right / y down. Walls are centre lines with a
thickness and a phase (`existing | demolish | new`), optional load-bearing,
fire rating before/after and apartment-boundary flags. Openings sit on a
wall at an offset from its `a` end. Före and efter are **one model**: före
shows today (new work hidden), efter marks demolition (dashed) and new
work (black).

## Editing (`lib/plan/ops.ts`)

Every change — editor or Claude — is a list of small operations applied
all-or-nothing (`add`, `update`, `delete`, `moveVertex`, `moveWall`,
`setWallLength`, `setSheet`, `setTitleBlock`, `setUnderlay`). Moving a wall
end drags walls joined at that point. Nothing is regenerated.

## Versions (`lib/plan/store.ts`)

Append-only revisions (`plans/<id>/rev-NNNN.json` + `head.json`) in a
private Vercel Blob store, or `.data/` locally. Saves carry the revision
they were based on; a stale base is rejected (409) so Claude and the editor
never overwrite each other. *Utfärda* sets the next revision letter
(A, B, …) in the title block.

## Output (`lib/plan/sheet.ts`, `lib/plan/export.ts`)

A3/A4 at 1:50 or 1:100, drawn in paper millimetres so the PDF prints at
true scale at 100 %: title block, legend, scale bar, north arrow, room
names/areas, fire-cell boundary, automatic dimensions for new openings
(width + distance from the nearest wall face) and demolished walls.
Exports: vector PDF, SVG, PNG (embedded Liberation Sans), DXF R12 in mm
with layers (`A-VAGG-BEF`, `A-VAGG-RIV`, `A-VAGG-NY`, …) for consultants.

## Checks (`lib/plan/checks.ts`)

Flags what the drawing should show — missing title-block fields, brf name
used instead of fastighetsbeteckning, plan not fitting the sheet, demolished
load-bearing wall, opening in a fire-cell boundary without a stated
boundary after, removed kitchen without plugged connections, ventilation
changes. Never a legal judgment.

## Scan tools for Claude (`lib/plan/scan/`)

Claude traces source drawings itself. The editor is the fallback for small
fixes. Every tool is an MCP tool. `scripts/plan-tool.ts` runs the same
handlers against the local store:
`npx tsx scripts/plan-tool.ts <tool> '<json>' [--file path] [--out dir]`.

- `plan_source_add`: adds a source drawing (TIF, including G4; PDF; PNG;
  JPG). The server converts it to grey PNG (sharp; pdf.js plus
  @napi-rs/canvas at 200 dpi) and places it in plan mm from its scale and
  dpi. A plan can hold several sources (`sources[]`), e.g. an archive drawing
  and the owner's own drawing.
- `plan_scan_view`: a crop in plan mm with a labelled grid. With the
  overlay on, the plan's walls are drawn on top.
- `plan_scan_profile`: the ink runs along a line. Use it to measure a wall's
  thickness and position to about one pixel.
- `plan_scan_calibrate`: a least-squares scale from known distances (laser,
  dimension figures, scale bar). Reports the residual of each measurement.
  It scales around an anchor so that tracing near the anchor stays put.
- `plan_scan_detect_walls`: proposes horizontal and vertical walls, as either
  filled bands or pairs of outlines, each with a confidence. It changes
  nothing.
- `plan_scan_snap_walls`: places rough walls (or existing ones) on the
  drawing. It takes cross-sections, fits a robust line, and uses the median
  thickness. Ends are joined at centreline intersections, and openings keep
  their place. The tool reports a confidence per wall. A wall it can't find
  is left where it was and flagged.
- `plan_scan_openings`: finds openings where both drawn faces of a wall
  stop, and reads each one as a door (with its swing) or an open passage.
  It doesn't detect windows. It also can't read drawings that mark doorways
  only by dashing one face (e.g. Stockholm's 1999 informationsritningar).
- `plan_scan_elevation`: reads windows from a facade drawing (a source added
  with `view: "elevation"`) onto a facade wall. A window is a group of
  long horizontal lines with the same ends, stacked: sill, head and
  transom. Speckle never forms long runs. You give the floor's band of
  height and two anchors that link facade x to plan points (e.g. the
  building's corners); this also handles a mirrored facade. The tool marks
  the wall `exterior` and records evidence on each window.
- Door symbols: `plan_scan_openings` also scans each wall's line for door
  symbols (a swing arc and a straight leaf) at 600–1000 mm widths, on both
  sides and with either hinge end, allowing ±0.2 m sideways. A cheap arc
  test picks candidates and the leaf+arc test decides. This finds doors in
  walls that can't be located in the drawing (mostly door, or drawn more
  than 0.15 m off), and gives their width and swing.
- Method selection: `plan_scan_openings` runs every detector, tests each
  on the plan's known openings (doors and passages), and by default uses
  those that find at least a quarter of them. Drawings use one or two
  conventions, so a method that finds no known openings in a drawing only
  finds noise there. On Gnejsen: the 1936 drainage drawing → dashed only;
  the owner's drawing → gaps and door symbols; the 1999 A00:24 → none. The
  preview is a numbered review image: green = door symbol, orange =
  dashed, yellow = gap, blue = window, teal B = confirms an existing
  opening.
- `plan_openings_report`: every opening with its evidence (which drawing,
  which method, which position), the spread between the drawings, and
  conflicts. A conflict is an opening that a current survey (source role
  before/after) draws as solid wall, or one with no evidence at all.
  `plan_scan_openings` and `plan_scan_elevation` record evidence: a find
  that matches an existing opening (overlapping by at least half) is added
  as evidence, and new finds are added only if listed in `accept` after a
  preview. Sources carry a `year`: old drawings show the building as it
  was built.
- `plan_scan_doors`: reads door hinges and swings off a source. It scores all
  four options per door: a straight leaf from the hinge (line-centre fit) plus
  an arc of constant radius around it. It lets the symbol slide up to about
  15 cm off the plan. Shape, not just ink presence, matters: at the common 60°
  leaf angle the symbol is nearly mirror-symmetric, and with thick lines a
  presence test can't tell the hinge from the free jamb. `plan_get` describes
  every door in words ("gångjärn vid västra karmen …, öppnar mot norr").
- `plan_scan_register`: aligns one source to another (scale and offset) by
  matching ink. It searches coarse to fine with a symmetric overlap score and
  refines the best coarse candidates. Use it to bring a ventilation or
  structural drawing onto the architectural plan.
- `plan_scan_diff`: compares two calibrated sources (före/efter). Red means
  removed, blue means added.
- `plan_import`: creates a plan from full plan JSON.

Measured dimensions (laser) take precedence over the drawing. Snap is a
check on those walls, not something to apply to them. Accuracy on
synthetic scans (`e2e/plan-scan.spec.ts`): within 1.5 px of the true
centreline at 1:100/300 dpi and at 3.6 mm/px, for both filled and outlined
walls.

## Tests

`e2e/plan-*.spec.ts`. Browser tests need Chromium; set
`PW_CHROMIUM_PATH=/opt/pw-browsers/chromium` where the bundled one is
missing. `npx tsx scripts/render-plan.ts demo .visual/plan` renders the
example sheets to PNG for a visual check.

Test data in this repo is made up. Real project material (archive scans,
addresses, apartment numbers) stays out of the repo.
