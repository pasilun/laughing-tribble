# Planstudio

A web app for drawing interior floor plans (planritningar) for Swedish building
permit applications: before and after drawings at true scale, printed as A3/A4
sheets. Claude can draw and edit plans through MCP tools, including tracing
walls from scanned archive drawings.

The app is in Swedish; this README is in English.

## Features

- **Plan editor** (`/plans`): canvas with walls, openings, fixtures, rooms,
  notes and dimensions. Undo/redo, a checks tab, and a revision history.
  Every save is an immutable revision; stale edits are rejected (409).
- **Scan tools**: calibrate a scanned drawing against known lengths, detect and
  snap walls, read door swings and windows, register several drawings, and
  flag walls that are drawn but missing from the plan.
- **Checks and review**: required elements, scale fit, overlaps, room
  connectivity, entrances, and structural checks (load-bearing walls, joints).
- **Output**: A3/A4 sheets at 1:50, 1:100, 1:150 or 1:200 as PDF and PNG, and
  DXF for CAD.
- **MCP**: the same operations exposed as tools at `/api/mcp`.

See [`docs/plan-studio.md`](docs/plan-studio.md) for the editor and the model,
and [`docs/plan-review.md`](docs/plan-review.md) for the review rules.

## Quick start

```bash
npm install
npx playwright install chromium   # first time, for tests
npm run dev                       # http://localhost:3000/plans
```

| Script | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build and server |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm test` | Playwright (starts the dev server unless `CI` is set) |

Scripts for working on plans from the command line (local file store):

```bash
npx tsx scripts/plan-tool.ts <tool> '<json args>' [--out dir] [--file path]
npx tsx scripts/render-plan.ts demo .visual/plan   # render example sheets to PNG
```

## Configuration

| Variable | Purpose |
| --- | --- |
| `PLAN_PASSWORD` | Protects `/plans`, `/api/plans` and `/api/mcp`. Unset means everything is open, which is only for local development. |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob token. When set, plans are stored in a private Blob store. (`public_READ_WRITE_TOKEN` is also accepted.) |
| `PLAN_STORE=fs` | Force filesystem storage even when a Blob token is set. |
| `PLAN_DATA_DIR` | Filesystem root for plans (default `.data/`). |

Without a Blob token, plans are written to `.data/` on disk. On Vercel the disk
is ephemeral, so connect a Blob store to the project.

## MCP

The endpoint is `/api/mcp` (streamable HTTP). Add it as a connector in Claude
with the password in the URL:

```
https://<host>/api/mcp?key=<PLAN_PASSWORD>
```

The password can also be sent as `Authorization: Bearer <PLAN_PASSWORD>`.

Plan tools:

- Plans: `plan_list`, `plan_create`, `plan_get`, `plan_edit`, `plan_check`,
  `plan_review`, `plan_revisions`, `plan_import`, `plan_compare`
- Scanning: `plan_source_add`, `plan_scan_view`, `plan_scan_profile`,
  `plan_scan_calibrate`, `plan_scan_detect_walls`, `plan_scan_missing_walls`,
  `plan_scan_snap_walls`, `plan_scan_openings`, `plan_scan_elevation`,
  `plan_openings_report`, `plan_scan_doors`, `plan_scan_register`,
  `plan_scan_diff`

`plan_edit` takes a `base_revision`; if the plan has changed since, the edit is
rejected and the plan must be read again.

## Deploy

Pushes to `main` deploy to Vercel through `.github/workflows/deploy.yml`, then
smoke-test `/plans/login` and `/api/mcp`.

Required GitHub configuration:

- Secrets: `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`
- Variable: `PROD_URL`

In the Vercel project, set `PLAN_PASSWORD` and connect a Blob store. Region and
security headers are in `vercel.json`.

## Layout

```
app/plans/                 editor pages and login
app/api/plans/             plan REST API (list, get, ops, checks, sheet, assets)
app/api/mcp/               MCP endpoint
lib/plan/                  model, ops, geometry, sheet, export, checks, review, store
lib/plan/scan/             scan tools and MCP tool definitions
components/plan-editor/    canvas, editor, inspector, snapping, history
scripts/                   plan CLI, rendering, golden-file and test-scan generators
e2e/                       Playwright tests (plan-*.spec.ts, golden fixtures)
docs/                      plan-studio.md, plan-review.md
```

## History

The earlier bygglov 3D/IFC app and its autonomous development loop were removed
in this cleanup. The last commit with them is tagged `archive/bygglov-3d`.
