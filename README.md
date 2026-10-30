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
  DXF for CAD. A plan with changes (demolished or new parts) gets a före and an
  efter sheet; a plan of what exists is one sheet, titled "befintlig".
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
| `PLAN_USERS` | One access key per person: `anna:<hash>, bo:<hash>` (made by `npm run user:add <id>`). Each person has their own plans and files. Without any sign-in variable everything is open locally and refused on Vercel. See [docs/deploy.md](docs/deploy.md). |
| `PLAN_PASSWORD` | Older single-password mode, used only when `PLAN_USERS` is not set: everyone shares the same plans. |
| `PLANS_READ_WRITE_TOKEN` | Token of a **private** Vercel Blob store connected with the prefix `PLANS`. Tried first. |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob token. Plans are stored in a private Blob store; when the project holds several store tokens (`PLANS_`, `BLOB_`, `public_`), the app uses the first that is private. |
| `PLAN_STORE=fs` | Force filesystem storage even when a Blob token is set. |
| `PLAN_DATA_DIR` | Filesystem root for plans (default `.data/`). |

Without a Blob token, plans are written to `.data/` on disk. On Vercel the disk
is ephemeral, so connect a Blob store to the project.

## MCP

The endpoint is `/api/mcp` (streamable HTTP). Add it as a connector in Claude
with your personal key in the URL:

```
https://<host>/api/mcp?key=<your key>
```

The key can also be sent as `Authorization: Bearer <key>`.

Plan tools:

- Start here: `plan_guide` (the working order for a plan traced from a drawing) and
  `plan_upload_link` (a link where the user drops the drawing; a chat attachment
  cannot be passed to a tool). The server also sends a short version of the guide as
  its MCP `instructions` when a client connects.
- Plans: `plan_list`, `plan_create`, `plan_get`, `plan_edit`, `plan_check`,
  `plan_review`, `plan_finish`, `plan_revisions`, `plan_import`, `plan_compare`
- Scanning: `plan_source_add`, `plan_scan_view`, `plan_scan_profile`,
  `plan_scan_calibrate`, `plan_scan_detect_walls`, `plan_scan_missing_walls`,
  `plan_scan_snap_walls`, `plan_scan_openings`, `plan_scan_elevation`,
  `plan_openings_report`, `plan_scan_doors`, `plan_scan_register`,
  `plan_scan_diff`

`plan_edit` takes a `base_revision`; if the plan has changed since, the edit is
rejected and the plan must be read again.

Drawings reach a plan through `/plans/<id>/upload` (browser) or
`POST /api/plans/<id>/sources?id=…&filename=a.png&scale=100&dpi=300` with the raw
bytes and the personal key (up to 4.4 MB: Vercel's request limit). Both register the
file as a source like `plan_source_add`.

## Deploy

Vercel's Git integration deploys every push: `main` to production, other
branches to previews. There is no deploy workflow in GitHub.

In the Vercel project, set `PLAN_USERS` and connect a Blob store. Region and
security headers are in `vercel.json`. Setup, adding people, migrating existing
plans and troubleshooting a failed deploy: [docs/deploy.md](docs/deploy.md).

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
