# Planstudio v2: a CAD-style kernel in Rust, MCP-first, with a SketchUp-style desktop editor and a mobile viewer

## Context

v1 (this repo) stores a wall as a free centre line `a→b` plus a thickness. Joints are two wall ends within 1 mm of each other, openings sit at an `offset` along `wall.a`, room areas come from a raster flood fill, and a `Dimension` is two loose points that drive nothing. That fits tracing a scan. It fits badly the work of drawing from laser measurements, which are clear sizes between wall faces.

Drawing lgh 154 showed three concrete failures:

- Face measurements have to be converted to centre lines by hand.
- Conflicting measurements (4.49 m against 2.36 + 0.09 + 2.09 = 4.54 m) are absorbed silently, as a south-wall step and 10 mm fudges.
- A guessed outer thickness can shift a room.

Calibrating the Gnejsen 152–154 basplan against new laser readings showed the same pattern at a larger scale. Chained measurements exposed 205 mm and 228 mm errors, an implausible 294 mm WC wall, and walls that should align but didn't. Each one took several manual rounds to find and fix.

Exploring v1 found about 600 call sites of the centre-line model in about 45 files, and no schema version on stored plans. A staged in-place refactor would spend most of its effort keeping the old model alive, so v2 is a **separate project**.

Decisions made with the user:

- **New repo, monorepo.** v1 keeps running until v2 reaches parity.
- **Language:** Rust throughout. The kernel compiles to WASM for the browser and to native code for the server and desktop.
- **Editor:** a SketchUp-style 2D desktop editor written in Rust (egui and wgpu), running natively and in the browser. It replaces the earlier TypeScript and React web editor; see "Research" for why.
- **Licence:** GPL-3.0, like v1.
- **Scan and trace tools:** stay in v1 as the import path first, and are ported last.

## Architecture

**Principle: one pure kernel, one command API, thin clients.** Meaning (walls, rooms, measurements) is the source of truth, and geometry is computed from it.

1. **Kernel (`core`, no I/O).** Exact integer-mm geometry and the model:
   - **Nodes.** Walls reference nodes, so a joint is a shared node and not a 1 mm coincidence.
   - **Walls.** A wall has `from`, `to`, `thickness` and `ref: left|center|right`. `ref` says which face the node line is, so a wall measured from the inside keeps that face and a wrong thickness only grows outward.
   - **Openings.** Anchored to a wall end or centre with a distance and a width.
   - **Rooms.** Derived closed regions from the planar graph of wall faces, with exact polygon area and clear sizes.
   - **Dimensions.** Driving or reference. A driving dimension is a constraint, solved by SolidCraft's sketch solver (see "Research"), which reports over-constraint. Messages are in domain terms, for example "4.49 measured, 4.54 implied, 50 mm apart".
   - **Phases.** The per-element `phase` tag (`existing|demolish|new`) is carried over unchanged.
2. **Command API (the only way to change a plan).** A tagged `Command` enum, applied all-or-nothing, with a `dry_run` that returns a diff and diagnostics.
   - Commands are semantic: `SetClearSize`, `PlaceWall`, `MoveNode`, `SetDimension`, `AddOpening`.
   - Schemas come from the Rust types (`schemars`). JSON Schema generates the MCP tool schemas and the REST/OpenAPI definitions.
3. **Storage as a command log plus snapshots.** This gives undo, revision history, compare and provenance (agent or human) without extra machinery.
4. **Render-neutral scene.** The kernel emits primitives with semantic ids. Backends produce SVG (in Rust, so output is identical everywhere), PDF (via an SVG-to-PDF crate), DXF and SketchUp `.skp`.
5. **Three clients on the same API:**
   - **MCP server.** MCP-first: every result carries the diagnostics and, on request, a picture.
   - **Desktop editor.** Rust (egui and wgpu), native on Windows, macOS and Linux and in the browser through WASM. It links the kernel directly and sends the same commands. Dragging is a command preview.
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
8. **MCP details:** output schemas, read-only and idempotent hints, the plan as an MCP resource, and prompts for the working order. SolidCraft's `solidcraft-cli mcp`, which can drive the live app, is a reference design.
9. **Cost control.** Deltas after edits, not full state. Pagination and field selection on `get`. Small images only on request.
10. **Eval gate.** A fixed task set (for example draw lgh 154 from a measurement list) runs on Opus, Sonnet and Haiku, with pass rate and tokens per task. The target is that the cheapest tier passes.

## Models and cost (estimates, prices cached 2026-10-06, per 1M tokens)

Prices: Fable 5.1 $10 in / $50 out; Opus 5.5 $4 / $20; Sonnet 5.5 $2 / $10; Haiku 5.5 $0.10 / $0.50 (prompts up to 100K). Cache reads are about $0.20 on Opus 5.5 and Sonnet 5.5.

**Building it:**
- Opus 5.5 for the kernel, solver integration, command schema, DSL and architecture reviews.
- Sonnet 5.5 for the server and MCP adapter, editor, viewer, tests, importer and CI.
- Haiku 5.5 for fixtures, docs and mechanical edits.
- Fable 5.1 only if a design problem stalls (2.5× Opus 5.5).
- Rough planning figure: $400–1,000 total, assuming 150–300 sessions of about 4M cached input, 0.3M fresh input and 60K output each (about $3.50 per Opus session, $2.20 per Sonnet session). Reusing the solver and the editor pieces below should pull it toward the low end. Unmeasured: meter Phase 1 and extrapolate.

**Running it (LLM using the MCP tools), per drawing like lgh 154, assuming 150K in / 5K out uncached:** Haiku 5.5 about $0.02, Sonnet 5.5 about $0.35, Opus 5.5 about $0.70. Prompt caching on the stable prefix cuts the input side by up to about 90%.

**Runtime tiers:** Haiku 5.5 is the floor the eval gate must pass, Sonnet 5.5 is the default, Opus 5.5 is for ambiguous cases (measurement conflicts, reading a photo).

**API constraints that shape the tool design:**
- Forced `tool_choice` (`any`/`tool`) returns a 400 on Opus 5.5 and Sonnet 5.5. Tools must work with `auto` plus `strict: true` schemas and clear descriptions.
- Thinking can't be disabled on Opus 5.5. Effort defaults to `medium` on Opus 5.5 and Haiku 5.5. The eval sweeps effort per tier.
- Keep Haiku prompts under 100K tokens, since beyond that its price is five times higher.

## Research: existing open-source tools (checked 2026-11-09)

Prompted by the Hacker News thread ["KetchUp – Open-source SketchUp alternative built with Rust and WebGPU"](https://news.ycombinator.com/item?id=50418176). BenchUp and SolidCraft were cloned and their code read; the others were checked through their pages and listings.

### BenchUp, formerly KetchUp: borrow from it, don't fork
[github.com/BenchUp3D/editor](https://github.com/BenchUp3D/editor). MIT, Rust, about 103k lines in two crates (`benchup-core` about 19k, `benchup-app` about 83k), committed daily.

- **What it has:**
  - A working SketchUp-style tool set: Select, Line, Rectangle, Push/Pull, Offset, Move, Rotate, Paint, Tape Measure, Protractor, Dimensions, Erase.
  - Snapping with red/green axis locks, endpoint, midpoint and on-edge.
  - Groups, components, tags, an outliner, undo history, autosave, and a top orthographic view.
  - A typed-value input that understands units and formulas (`60cm+89mm`).
  - Native desktop and browser builds from one Rust codebase (egui interface, wgpu rendering, no JavaScript framework).
  - SketchUp `.skp` import through OpenSKP.
- **Why not fork:**
  - Its model is free-form 3D geometry (vertices, edges, faces with holes), exactly like SketchUp, and the tools edit that geometry directly. Line adds edges, Push/Pull extrudes faces into prisms, and a Dimension is a label pinned to two vertices that changes nothing.
  - In v2 the geometry is computed from walls, rooms and measurements. The same tools must create and move walls, keep openings attached, re-derive rooms and solve driving dimensions. The part of every tool that decides what a click or typed value does to the document has to be rewritten.
  - Tagging raw faces as "walls", as SketchUp architecture plugins do, breaks what this project needs. Nothing stops a corner drag from making a wall non-parallel or the wrong thickness. Laser measurements can't drive geometry. Room areas, permit checks and före/efter sheets need meaning the geometry doesn't hold.
  - About 57 files are woodworking-specific (joinery, grain, stock, cutting plans, fasteners, time estimates). Accounts and sharing depend on the author's PHP server.
  - The code is tightly coupled (`app.rs` 6.5k lines, `renderer.rs` 7.7k, `sidebar.rs` 5k), and it changes daily, so a fork would drift fast.
- **What to lift, keeping MIT attribution:**
  - The snapping engine (`benchup-core/src/inference.rs`, about 1.5k lines). It is 3D but already supports snapping on a plane and works through an abstract `FaceQuery` interface over the geometry.
  - The typed-value parser (`benchup-app/src/precision.rs`), dimension rendering, undo history and shortcuts.
  - The egui and wgpu application setup as a template.
- **Benchmark:** BenchUp is the yardstick for how SketchUp-like the editor feels. HN commenters found its Push/Pull, default snapping and rectangle naming felt unlike SketchUp. That is why the acceptance test below is "a SketchUp user without docs".

### SolidCraft: adopt its sketch constraint solver
[github.com/tangency-labs/solidcraft](https://github.com/tangency-labs/solidcraft). MIT or Apache-2.0, Rust, a parametric Fusion-360-style CAD with a built-in MCP server, about 2.5M lines.

- Its `solidcraft-sketch` crate (`crates/sketch`, about 33k lines, `#![forbid(unsafe_code)]`) is a 2D constraint solver:
  - points and curves, geometric constraints and **driving dimensions**;
  - a Levenberg–Marquardt solver per connected component;
  - degree-of-freedom analysis that detects over- and under-constrained sketches;
  - a constructive seed that keeps a sketch from flipping into a mirrored solution when a dimension changes.
- Its dependencies are small: `solidcraft-geom` and `solidcore-record` (NVIDIA, Apache-2.0). It already runs in SolidCraft's browser app.
- **Why adopt it:** it replaces both the in-house axis-aligned solver and the GPL alternatives (SolveSpace's solver, FreeCAD's `planegcs`) from the earlier plan. It is also GPL-3.0-compatible with no relinking burden in the WASM bundle.
- **Risk:** it lives inside a very large, fast-moving repo. Vendor a pinned copy of the three crates behind a thin adapter in our kernel, so it can be swapped out.

### OpenSKP: SketchUp import and export
[github.com/iamahsanmehmood/openskp](https://github.com/iamahsanmehmood/openskp). MIT, reverse-engineered, not affiliated with Trimble. C++17, TypeScript, Python, .NET and Dart.

- Reads SketchUp files from 2013 onward (both the classic and the 2021+ container). Per its README it also **writes** `.skp`, in the 2013–2020 container.
- **Why it matters:** SketchUp for Web on the free plan imports only `.skp`, `.jpg` and `.png`; DXF and DWG import need a paid plan ([SketchUp help: file management](https://help.sketchup.com/en/sketchup-web/file-management)). A native `.skp` export is therefore what lets the user open plans in their SketchUp. OpenSKP avoids depending on Trimble's hosted SketchUp service.
- **Verify in the Phase 0 spike:** a file OpenSKP writes opens in SketchUp for Web, with walls, tags and groups intact.

### Checked, not adopted
- **Hew** ([listing](https://alternativeto.net/software/hew/about/)): a SketchUp-like modeller where every shape is a solid. AGPL-3.0, early-stage with a small community, imports `.skp` only from 2017. Nothing it offers isn't already covered by BenchUp and OpenSKP.
- **"ingetrazo"** (a SketchUp clone with an MCP server, mentioned on HN): not found. The closest matches are MCP bridges that drive a desktop SketchUp you own, such as [sketchup-mcp2](https://github.com/zinin/sketchup-mcp2).
- **react-planner** (cvdlab, MIT): its model is vertices, lines between shared vertices, holes with an `offset`, and auto-detected areas, with wall thickness only as a free-form property. There is no face reference and no dimensions or constraints, and its state lives in Redux and Immutable.js, which conflicts with a kernel that owns the truth. Upstream looks stale; a TypeScript fork (`archef2000/react-planner`) shows October 2025 commits. It confirms explicit shared vertices as the right topology.
- **Trimble's SketchUp MCP connector:** a hosted service that runs Python against a live SketchUp model and returns a `.skp` download link. It works today and is the fallback if OpenSKP's writer falls short, but it is a paid, external dependency.

## Licence

- v2 is **GPL-3.0**, like v1 (decided with the user).
- The adopted pieces are all compatible: BenchUp (MIT), SolidCraft (MIT or Apache-2.0), solidcore-record (Apache-2.0), OpenSKP (MIT).
- Keep each upstream's licence file and attribution alongside the vendored code.
- Browser delivery of the WASM editor counts as distribution, so GPL source must be offered alongside it. Record this in the README and the release process.

## Reuse, don't build

**Phase 0 includes a spike** that verifies each item (current licence, WASM compatibility, maintenance) before adoption.

- **Constraint solver:** SolidCraft's `solidcraft-sketch`, vendored and pinned behind an adapter.
- **Editor interaction:** from BenchUp, the snapping engine, typed-value parser, dimension rendering, undo history, shortcuts and egui/wgpu setup.
- **SketchUp files:** OpenSKP for `.skp` export, and import as a reference underlay.
- **Auth, accounts, sharing, MCP OAuth:** an auth provider with OAuth 2.1 support (for example WorkOS AuthKit, Clerk or Auth.js). Do not port v1's home-built accounts, invitations and OAuth.
- **Geometry:** `geo`, `i_overlay`, `cavalier_contours` for union, area, offsets and containment. Rooms are the holes of the union of wall polygons, so no custom half-edge code.
- **Types and contracts:** `serde`, `schemars`, `utoipa`. **WASM:** `wasm-bindgen`, `trunk` (as BenchUp uses).
- **MCP and HTTP:** the official Rust MCP SDK (`rmcp`) and `axum`.
- **DSL parser:** `winnow` or `chumsky`.
- **Export:** `svg2pdf` and `resvg` for PDF and PNG, the `dxf` crate for DXF, OpenSKP for `.skp`, IFC (IfcOpenShell) later as an export only.
- **Storage:** SQLite or libSQL with a command-log table (v1 already uses Turso). Blobs on Vercel Blob, S3 or R2. Managed hosting.
- **Mobile viewer:** the kernel's SVG scene with a pan/zoom library. No custom rendering engine.
- **Collaboration (later):** Yjs, Automerge or Loro, or server-authoritative commands.
- **Scan pipeline:** OpenCV, and check for pretrained floor-plan parsing models before porting v1's custom scanner.
- **Tests and evals:** `proptest`, `insta`, Playwright for the viewer, egui's test harness for the editor, and an existing eval harness instead of a custom one.
- **Stays custom:** the intent layer and command API, the wall/room/opening model, how each editor tool maps to kernel commands, over-constraint messages, the scene model and the Swedish permit checks.

## Desktop editor: SketchUp-style 2D

The user knows SketchUp and wants the same experience, tools and shortcuts on desktop, in 2D. The editor copies SketchUp's interaction model, much of it lifted from BenchUp. Underneath, every tool produces kernel commands on walls, rooms and openings, instead of editing free lines and faces. Desktop first, mouse and keyboard; touch is secondary, and mobile stays view-only.

| SketchUp tool (key) | v2 tool, same key by default |
|---|---|
| Select (Space) | Select walls, rooms, openings, fixtures. Double-click a room to select its walls. |
| Entity Info | Inspector panel: thickness, reference face, phase, flags, measured values and their source |
| Line (L) | Wall: click-click chain. Type a length in the Measurements box, or `length;thickness`. Tab or the arrow keys pick the reference face (left/centre/right). |
| Rectangle (R) | Room by clear size: type `1860,2360` and the walls are placed around it at the chosen thickness |
| Push/Pull (P) | Drag a wall face to resize a room; type the distance or the new clear size. Moves the wall, keeps its openings, re-derives the rooms. |
| Offset (F) | New parallel wall at a typed distance from a face (for example a partition 1060 from the north face) |
| Move (M) | Move walls, openings, fixtures. Ctrl to copy, arrow keys to lock an axis. Joined walls follow through shared nodes. |
| Rotate (Q) | Fixtures and furniture; walls only through an explicit angle |
| Tape Measure (T) | Measure and place guides. A "record" toggle stores the reading as a dimension with `source: measured`. Also used to scale an imported photo or scan, like SketchUp's resize trick. |
| Dimension (D) | Place a dimension. Double-click the value to edit it: a driving dimension runs the solver and moves the geometry, a reference one only displays. Conflicts are shown with the numbers. |
| Eraser (E) | Delete. Deleting a wall merges its two rooms and removes its openings. |
| Paint Bucket (B) | Paint the phase (existing, demolish, new) onto walls and openings |
| Tags | Layers: före/efter, furniture, dimensions, underlay |
| Scenes | Saved views: Före, Efter, permit sheet, working view |
| Components / 3D Warehouse | Fixture and furniture library (kitchen, WC, shower, beds, wardrobes) |
| Groups / Outliner | Apartments and rooms as groups; an outliner tree of apartments, rooms, walls |
| Measurements box | Always active, bottom right: type without clicking first. Accepts mm, `1.86 m` and formulas (from BenchUp's parser). |

**Inference and navigation:**
- SketchUp-style coloured hints, adapted from BenchUp's engine to wall faces and corners: endpoint, midpoint, on face, red/green axis locks, parallel and perpendicular, and dotted inference lines from points you hover over. Shift locks the current inference.
- Scroll to zoom at the cursor, middle-drag to pan, Shift+Z for zoom extents.
- Esc cancels, and Ctrl+Z / Ctrl+Y undo and redo.
- Shortcuts can be changed; SketchUp's are the defaults.

**Acceptance:** a SketchUp user redraws lgh 154 from the laser measurements in under 15 minutes without reading docs, and any conflicting measurements are flagged on the way.

## Repo layout (new repo)

- `crates/core`: model, faces, commands, diagnostics, and the solver adapter
- `crates/render`: scene, SVG, PDF, DXF
- `crates/skp`: `.skp` export (and underlay import) via OpenSKP
- `crates/checks`: ports of v1's `plan_review`, `plan_check` and structure rules
- `crates/import-v1`: reads v1 revisions (centre-line JSON) and builds v2 plans
- `crates/server`: HTTP and MCP adapter and storage
- `crates/editor`: the SketchUp-style editor (egui and wgpu), built native and for the browser with `trunk`
- `crates/cli`: apply commands to a plan, render, run acceptance cases
- `vendor/`: pinned copies of `solidcraft-sketch`, `solidcraft-geom`, `solidcore-record` and the lifted BenchUp modules, each with its licence and source commit
- `viewer/`: mobile PWA

## Phases

**Phase 0: Spec, acceptance cases and reuse spike**
- Write the model spec and invariants.
- Turn real cases into fixtures: lgh 154 from the laser measurements, the calibrated Gnejsen 152–154 basplan (rev 40), v1's `flat`, `golden` and `cellar` fixtures, and the 153/154 plan (rev 50).
- Spike, one or two days each:
  - Solve lgh 154's walls as a SolidCraft sketch, including the 4.49 against 4.54 conflict.
  - Snap on a 2D plan with BenchUp's inference engine.
  - Write a `.skp` with OpenSKP and open it in SketchUp for Web.
- Precondition: the user creates an empty repo. This session's GitHub scope is only `pasilun/laughing-tribble`, so I can't create one, but I can add it with `add_repo` once it exists.

**Phase 1: Kernel and CLI**
- Model, face geometry with exact mitre and T-joins, command application, the solver adapter and conflict diagnostics.
- Property tests (`proptest`): joints stay closed, a wall's faces stay parallel at its thickness, and commands are all-or-nothing.
- Intent layer and the text DSL (parser, printer, round trip) with `source` and tolerance on dimensions.
- **Acceptance:** lgh 154 built from clear sizes and 90 mm partitions only, written as a DSL document of a few lines. No south-wall step, no fudges, the 4.49 against 4.54 conflict is reported with its numbers, and changing an outer thickness moves no room.

**Phase 2: Render and export**
- SVG, PDF, DXF and `.skp` from the scene.
- Compare against v1's output on the fixtures. Differences should be only exact mitres.

**Phase 3: Checks and rooms**
- Port the review, permit and structure checks onto polygons.
- Exact areas and clear sizes replace the raster flood fill.

**Phase 4: Server and MCP**
- The 7-tool surface described above, generated from the schema, with `dry_run`, structured diagnostics, optional picture and command-log storage.
- Run the cross-tier eval (Opus, Sonnet, Haiku) here, before the editor, because the tool design is the main risk for cheap models.
- Open question: reuse v1's accounts, sharing and OAuth for MCP, or start simpler. This is a large port and is its own sub-phase.

**Phase 5: Desktop editor**
- egui and wgpu app, native and browser, starting from BenchUp's setup. Lift the snapping engine, typed-value parser, dimension rendering, undo history and shortcuts.
- Each tool maps to kernel commands as in the table above. Dragging previews a command, and typed dimensions drive geometry through the solver.
- Build Select, Wall (L), Room (R), Push/Pull, Tape Measure and Dimension first, then the rest.
- Acceptance: the SketchUp-user test above.

**Phase 6: Mobile viewer**
- Read-only PWA with pan, zoom, share links and offline view.

**Phase 7: Import and cut-over**
- `import-v1` converts old plans, and the v1 scan tools feed v2 through it.
- Cut-over criteria: lgh 154, the basplan and the golden, flat and cellar fixtures round-trip and render within tolerance, and the MCP tool set covers v1's editing flow.

**Later: scan pipeline**
- Port or replace the scan and trace tools. A Python/OpenCV service that calls the kernel's API is an option because it is batch work.

## Verification

- `cargo test` and `cargo clippy` in CI, for native and `wasm32` targets.
- Property tests for the kernel invariants.
- Acceptance fixtures from Phase 0 run through the CLI.
- An MCP integration test using a real client against the server, plus an agent eval comparing v1 and v2 on the same drawing task.
- Editor tests with egui's test harness. Playwright for the viewer, with a mobile viewport.
- Visual diff of rendered sheets against v1 on the fixtures.
- `.skp` exports opened in SketchUp for Web as a release check.

## Risks and open questions

- **Hosting.** v1 is on Vercel. A long-lived Rust server fits Fly.io or Cloud Run. Decide before Phase 4.
- **Auth and sharing.** v1 has accounts, sharing, invitations and OAuth. Porting them is a project in itself, so it needs an explicit decision.
- **Borrowed code drift.** BenchUp and SolidCraft change daily. Vendor pinned copies with recorded source commits, keep adapters thin, and update deliberately.
- **OpenSKP writer.** Writes only the 2013–2020 container and is reverse-engineered. If SketchUp for Web rejects its files, fall back to Trimble's hosted connector.
- **egui look and accessibility.** egui doesn't look native, and its accessibility is weaker than a web UI's. Acceptable for a desktop CAD tool; the viewer stays a plain web page.
- **Rust and WASM toolchain.** Bundle size and contributor ramp-up. Keep the kernel API narrow.
- **Scan tools.** About 215 call sites in v1 tuned on golden data. They stay in v1 until the kernel is stable, so there are two codebases for a while.
- **Phases (före/efter).** They still share one geometry. A real fix (positions versioned per view) is out of scope.
- **Solver scope.** Walls stay axis-aligned first-class in the UI and the DSL. SolidCraft's solver handles general angles and arcs when they're needed.
- **Scale.** A multi-week effort with one maintainer. Each phase should be shippable on its own.
