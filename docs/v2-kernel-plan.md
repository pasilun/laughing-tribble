# Planstudio v2: a CAD-style kernel in Rust, MCP-first, shared by web editor and mobile viewer

## Context

v1 (this repo) stores a wall as a free centre line `a→b` plus a thickness. Joints are two wall ends within 1 mm of each other, openings sit at an `offset` along `wall.a`, room areas come from a raster flood fill, and a `Dimension` is two loose points that drive nothing. That fits tracing a scan. It fits badly the work of drawing from laser measurements, which are clear sizes between wall faces.

Drawing lgh 154 showed three concrete failures:

- Face measurements have to be converted to centre lines by hand.
- Conflicting measurements (4.49 m against 2.36 + 0.09 + 2.09 = 4.54 m) are absorbed silently, as a south-wall step and 10 mm fudges.
- A guessed outer thickness can shift a room.

Exploring v1 found about 600 call sites of the centre-line model in about 45 files, and no schema version on stored plans. A staged in-place refactor would spend most of its effort keeping the old model alive, so v2 is a **separate project**.

Decisions made with the user:

- **New repo, monorepo.** v1 keeps running until v2 reaches parity.
- **Language:** a **Rust kernel compiled to WASM** for the browser and native for the server.
- **Scan and trace tools:** stay in v1 as the import path first, and are ported last.

## Architecture

**Principle: one pure kernel, one command API, thin clients.**

1. **Kernel (`core`, no I/O).** Exact integer-mm geometry and the model:
   - **Nodes.** Walls reference nodes, so a joint is a shared node and not a 1 mm coincidence.
   - **Walls.** A wall has `from`, `to`, `thickness` and `ref: left|center|right`. `ref` says which face the node line is, so a wall measured from the inside keeps that face and a wrong thickness only grows outward.
   - **Openings.** Anchored to a wall end or centre with a distance and a width.
   - **Rooms.** Derived closed regions from the planar graph of wall faces, with exact polygon area and clear sizes.
   - **Dimensions.** Driving or reference. A driving dimension is a constraint. The solver is axis-aligned first (a linear system per axis) and reports over-constraint in domain terms, for example "4.49 measured, 4.54 implied, 50 mm apart".
   - **Phases.** The per-element `phase` tag (`existing|demolish|new`) is carried over unchanged.
2. **Command API (the only way to change a plan).** A tagged `Command` enum, applied all-or-nothing, with a `dry_run` that returns a diff and diagnostics.
   - Commands are semantic: `SetClearSize`, `PlaceWall`, `MoveNode`, `SetDimension`, `AddOpening`.
   - Schemas come from the Rust types (`schemars`), and JSON Schema generates the MCP tool schemas, the REST/OpenAPI definitions and the TypeScript types for the web editor.
3. **Storage as a command log plus snapshots.** This gives undo, revision history, compare and provenance (agent or human) without extra machinery.
4. **Render-neutral scene.** The kernel emits primitives with semantic ids. Backends produce SVG (in Rust, so output is identical everywhere), PDF (via an SVG-to-PDF crate) and DXF.
5. **Three clients on the same API:**
   - **MCP server.** MCP-first: every result carries a picture and the diagnostics.
   - **Web editor.** Loads the kernel as WASM and sends the same commands. Dragging is a command preview.
   - **Mobile viewer.** A read-only PWA that loads the scene or SVG, with pan, zoom and share links. No edit code ships to it.

## LLM-first interface design

Models are good at names, topology, small integers, editing structured text and fixing their input from a precise error. They are bad at absolute coordinates, long arithmetic, left/right conventions, angles and reading measurements off images. The interface is built around that.

1. **Intent layer is the source of truth.** The document stores what was measured: rooms with clear sizes, partitions with thickness, openings addressed by room and side. The kernel resolves coordinates, so a model never computes one. Resolved geometry is a build artefact. Every dimension carries `source: measured | printed | estimated | assumed` (and optional tolerance), so reports can say what was measured and what was estimated.
2. **A compact text DSL that round-trips.** `get` returns it and `apply` accepts patches to it. Example: `Garderob 1860×2360; Sovrum below Garderob, wall 90; Sovrum.south window 1350 from west 380`. Units are mm, with `1.86 m` parsed as well.
3. **Names and compass directions, not a/b and left/right.** `hinge south, opens into Vardagsrum`. Ids are semantic (`Garderob.east`). Commands upsert by name, so retries are safe.
4. **About 7 tools:** `apply` (all-or-nothing, with `dry_run`), `get` (views: summary, dsl, json, svg), `check`, `render`, `find`, `import`, `history`. Verbs live in the DSL, so a cheap model has fewer choices. A basic profile exposes the minimum.
5. **Structured verification instead of vision.** `apply` returns the diff and diagnostics with numbers, plus suggested next steps. The picture is optional and small.
6. **Actionable errors.** "Unknown room 'Sovrun', did you mean 'Sovrum'?" and "over-constrained: 4.49 measured vs 4.54 implied; choose which to trust". Conflicts are where the model should ask the user.
7. **Axis-aligned first-class.** Angled walls only through an explicit angle.
8. **MCP details:** output schemas, read-only and idempotent hints, the plan as an MCP resource, and prompts for the working order.
9. **Cost control.** Deltas after edits, not full state. Pagination and field selection on `get`. Small images only on request.
10. **Eval gate.** A fixed task set (for example draw lgh 154 from a measurement list) runs on Opus, Sonnet and Haiku, with pass rate and tokens per task. The target is that the cheapest tier passes.

## Models and cost (estimates, prices cached 2026-10-06, per 1M tokens)

Prices: Fable 5.1 $10 in / $50 out; Opus 5.5 $4 / $20; Sonnet 5.5 $2 / $10; Haiku 5.5 $0.10 / $0.50 (prompts up to 100K). Cache reads are about $0.20 on Opus 5.5 and Sonnet 5.5.

**Building it:**
- Opus 5.5 for the kernel, solver, command schema, DSL and architecture reviews.
- Sonnet 5.5 for the server and MCP adapter, web editor, viewer, tests, importer and CI.
- Haiku 5.5 for fixtures, docs and mechanical edits.
- Fable 5.1 only if the solver design stalls (2.5× Opus 5.5).
- Rough planning figure: $400–1,000 total, assuming 150–300 sessions of about 4M cached input, 0.3M fresh input and 60K output each (about $3.50 per Opus session, $2.20 per Sonnet session). Unmeasured: meter Phase 1 and extrapolate.

**Running it (LLM using the MCP tools), per drawing like lgh 154, assuming 150K in / 5K out uncached:** Haiku 5.5 about $0.02, Sonnet 5.5 about $0.35, Opus 5.5 about $0.70. Prompt caching on the stable prefix cuts the input side by up to about 90%.

**Runtime tiers:** Haiku 5.5 is the floor the eval gate must pass, Sonnet 5.5 is the default, Opus 5.5 is for ambiguous cases (measurement conflicts, reading a photo).

**API constraints that shape the tool design:**
- Forced `tool_choice` (`any`/`tool`) returns a 400 on Opus 5.5 and Sonnet 5.5. Tools must work with `auto` plus `strict: true` schemas and clear descriptions.
- Thinking can't be disabled on Opus 5.5. Effort defaults to `medium` on Opus 5.5 and Haiku 5.5. The eval sweeps effort per tier.
- Keep Haiku prompts under 100K tokens, since beyond that its price is five times higher.

## Licence and constraint solver

- v2 is **GPL-3.0**, like v1 (decided with the user). GPL and LGPL dependencies are therefore allowed.
- The first solver (axis-aligned dimensions, a small linear system per axis) is written in-house, so licence does not constrain Phases 0–4.
- For general constraints later, evaluate an existing solver (SolveSpace's solver, FreeCAD's `planegcs`; D-Cubed is commercial and out). Verify each licence against its current licence file first.
- Browser delivery of the WASM kernel counts as distribution, so GPL source must be offered alongside the web app. Record this in the repo's README and release process.
- A GPL solver compiled into the WASM bundle is fine under this choice. An LGPL one still needs the relinking terms honoured (build instructions or object files published).

## Reuse, don't build

Candidate list from memory. **Phase 0 includes a spike** that verifies each one (current licence, WASM compatibility, maintenance) before any dependency is adopted.

- **Auth, accounts, sharing, MCP OAuth:** use an auth provider with OAuth 2.1 support (for example WorkOS AuthKit, Clerk or Auth.js). Do not port v1's home-built accounts, invitations and OAuth.
- **Geometry:** `geo`, `i_overlay`, `cavalier_contours` for union, area, offsets and containment. Rooms are the holes of the union of wall polygons, so no custom half-edge code.
- **Solver:** `nalgebra` or `faer` for the axis-aligned linear system. For general constraints evaluate SolveSpace's solver or FreeCAD's `planegcs`.
- **Types and contracts:** `serde`, `schemars`, `ts-rs` or `specta`, `utoipa`. **WASM:** `wasm-bindgen`, `wasm-pack`, `wasm-opt`.
- **MCP and HTTP:** the official Rust MCP SDK (`rmcp`) and `axum`.
- **DSL parser:** `winnow` or `chumsky`.
- **Export:** `svg2pdf` and `resvg` for PDF and PNG, the `dxf` crate for DXF, IFC (IfcOpenShell) as an export only.
- **Storage:** SQLite or libSQL with a command-log table (v1 already uses Turso). Blobs on Vercel Blob, S3 or R2. Managed hosting.
- **Web editor and viewer:** render the kernel's SVG scene with a pan/zoom library. No custom rendering engine.
- **Collaboration (later):** Yjs, Automerge or Loro, or server-authoritative commands.
- **Scan pipeline:** OpenCV, and check for pretrained floor-plan parsing models before porting v1's custom scanner.
- **Tests and evals:** `proptest`, `insta`, Playwright, and an existing eval harness instead of a custom one.
- **Checked, not adopted:** `react-planner` (cvdlab, MIT). Its model is vertices, lines between shared vertices, holes with an `offset`, and auto-detected areas, with wall thickness only as a free-form property. There is no face reference, no dimensions or constraints, and its state lives in Redux and Immutable.js, which conflicts with a kernel that owns the truth. Upstream looks stale (last push April 2024 per an aggregator; a TypeScript fork, `archef2000/react-planner`, shows October 2025 commits). Useful only as a UI reference (catalog, plugins, 2D plus 3D). Confirms explicit shared vertices as the right topology.
- **Stays custom:** the intent layer and command API, over-constraint diagnostics, the scene model and the Swedish permit checks.
- All of the above are compatible with GPL-3.0 (permissive, MPL and LGPL), subject to the LGPL relinking terms noted above.

## Repo layout (new repo)

- `crates/core`: model, faces, solver, commands, diagnostics
- `crates/render`: scene, SVG, PDF, DXF
- `crates/checks`: ports of v1's `plan_review`, `plan_check` and structure rules
- `crates/import-v1`: reads v1 revisions (centre-line JSON) and builds v2 plans
- `crates/server`: HTTP and MCP adapter and storage
- `crates/wasm`: `wasm-bindgen` bindings
- `crates/cli`: apply commands to a plan, render, run acceptance cases
- `web/`: TypeScript and React editor
- `viewer/`: mobile PWA
- `packages/types`: generated TypeScript types from the schema

## Phases

**Phase 0: Spec and acceptance cases**
- Write the model spec and invariants.
- Turn real cases into fixtures: lgh 154 from the laser measurements, v1's `flat`, `golden` and `cellar` fixtures, and the 153/154 plan (rev 50).
- Precondition: the user creates an empty repo. This session's GitHub scope is only `pasilun/laughing-tribble`, so I can't create one, but I can add it with `add_repo` once it exists.

**Phase 1: Kernel and CLI**
- Model, face geometry with exact mitre and T-joins, command application, the solver and conflict diagnostics.
- Property tests (`proptest`): joints stay closed, a wall's faces stay parallel at its thickness, and commands are all-or-nothing.
- Intent layer and the text DSL (parser, printer, round trip) with `source` and tolerance on dimensions.
- **Acceptance:** lgh 154 built from clear sizes and 90 mm partitions only, written as a DSL document of a few lines. No south-wall step, no fudges, the 4.49 against 4.54 conflict is reported with its numbers, and changing an outer thickness moves no room.

**Phase 2: Render and export**
- SVG, PDF and DXF from the scene.
- Compare against v1's output on the fixtures. Differences should be only exact mitres.

**Phase 3: Checks and rooms**
- Port the review, permit and structure checks onto polygons.
- Exact areas and clear sizes replace the raster flood fill.

**Phase 4: Server and MCP**
- The 7-tool surface described above, generated from the schema, with `dry_run`, structured diagnostics, optional picture and command-log storage.
- Run the cross-tier eval (Opus, Sonnet, Haiku) here, before the web editor, because the tool design is the main risk for cheap models.
- Open question: reuse v1's accounts, sharing and OAuth for MCP, or start simpler. This is a large port and is its own sub-phase.

**Phase 5: Web editor**
- WASM kernel, canvas rendering from the scene, drag as a command preview, typed dimensions that drive geometry, face-referenced wall drawing.

**Phase 6: Mobile viewer**
- Read-only PWA with pan, zoom, share links and offline view.

**Phase 7: Import and cut-over**
- `import-v1` converts old plans, and the v1 scan tools feed v2 through it.
- Cut-over criteria: lgh 154 and the golden, flat and cellar fixtures round-trip and render within tolerance, and the MCP tool set covers v1's editing flow.

**Later: scan pipeline**
- Port or replace the scan and trace tools. A Python/OpenCV service that calls the kernel's API is an option because it is batch work.

## Verification

- `cargo test`, `cargo clippy` and `wasm-pack test` in CI.
- Property tests for the kernel invariants.
- Acceptance fixtures from Phase 0 run through the CLI.
- An MCP integration test using a real client against the server, plus an agent eval comparing v1 and v2 on the same drawing task.
- Playwright for the web editor and viewer, with a mobile viewport for the viewer.
- Visual diff of rendered sheets against v1 on the fixtures.

## Risks and open questions

- **Hosting.** v1 is on Vercel. A long-lived Rust server fits Fly.io or Cloud Run, while the WASM kernel can also run inside a thin TypeScript adapter on Vercel. Decide before Phase 4.
- **Auth and sharing.** v1 has accounts, sharing, invitations and OAuth. Porting them is a project in itself, so it needs an explicit decision.
- **Rust and WASM toolchain.** Bundle size, bindings and contributor ramp-up. Keep the kernel API narrow.
- **Scan tools.** About 215 call sites in v1 tuned on golden data. They stay in v1 until the kernel is stable, so there are two codebases for a while.
- **Phases (före/efter).** They still share one geometry. A real fix (positions versioned per view) is out of scope.
- **Solver scope.** Axis-aligned only at first. General angles and arcs come later.
- **Scale.** A multi-week effort with one maintainer. Each phase should be shippable on its own.
