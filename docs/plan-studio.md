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

## Tests

`e2e/plan-*.spec.ts`. Browser tests need Chromium; set
`PW_CHROMIUM_PATH=/opt/pw-browsers/chromium` where the bundled one is
missing. `npx tsx scripts/render-plan.ts demo .visual/plan` renders the
example sheets to PNG for a visual check.

Test data in this repo is made up. Real project material (archive scans,
addresses, apartment numbers) stays out of the repo.
