# Planstudio: v1 stays the product, v2 becomes its measurement engine

Direction chosen with the maintainer on 2026-11-11, after a review of scope. This replaces the goal of v2 reaching parity with v1 and taking over.

## 1. Why

v2 was started to fix three things in v1: clear sizes had to be turned into centre lines by hand, conflicting measurements were absorbed silently, and a guessed wall thickness could move a room. The v2 kernel fixed all three by its second week. After that the v2 plan went on to rebuild what v1 already has: permit sheets, the permit review, fixtures, source images, hosting, sharing, an editor. That part is dropped.

**Spike, 2026-11-11** (`v2/spikes/v1-export`): the v2 solution of lgh 154 was written out as a v1 plan. v1 validated it, drew a normal A3 sheet from it, and computed the same room areas to the mm². So a solved set of measurements maps onto v1's wall model without loss.

## 2. The parts, and what may depend on what

```
ways in        the browser editor · the Claude connector (MCP) · the HTTP API · a read-only view
                    │  (each is replaceable; none holds rules of its own)
use cases      lib/plan/service.ts, plus the new lib/plan/measure/
                    │
domain         lib/plan/domain (the plan, sheet, checks)        engine: the v2 kernel as WebAssembly
                    │                                              (measurements → geometry and findings)
storage, auth  lib/plan/storage, lib/plan/auth
```

- **The engine is pure.** Text in, data out: no files, no network, no accounts. It knows nothing about v1 except one output format.
- **Use cases are the only place that joins the two.** A new way in (a different editor, a second API, a phone view) calls the use cases and gets the same answers as the others. This is the rule v1 already follows (`lib/README.md`); the engine is added under it, not beside it.
- **Swapping a part** then means: a new editor replaces one box in the top row; a new API adds one; a different solver replaces the engine behind the same few functions.

## 3. How measured geometry lives in a v1 plan

- A plan gets an optional **measurement document**: the v2 text (rooms with clear sizes, wall thicknesses, openings, laser readings), with a position in the plan.
- The engine turns it into walls, openings and rooms. Those are written into the plan as ordinary v1 elements, marked as **generated** (ids with a fixed prefix).
- **Regenerating** replaces the generated elements only. Everything drawn or traced by hand stays. So one plan can hold a measured apartment next to traced neighbours, as in the Gnejsen 152–154 basplan.
- A generated element is changed by changing the measurements. To edit one by hand it is first **detached** (it becomes an ordinary element and is no longer regenerated).
- Findings (conflicts with both chains of numbers, what to measure next) are stored with the plan and shown wherever the plan is shown.

## 4. Steps

| Step | Work | Size (estimate) |
|---|---|---|
| 1 | Engine as WebAssembly: one small crate exporting check, solve, suggest and "as a v1 plan" (the spike, rewritten in Rust with tests); built by a GitHub Action | 6–8 cards |
| 2 | `lib/plan/measure/`: load the engine; the measurement document on a plan; generate, regenerate, detach | 5–7 cards |
| 3 | Claude connector: tools to write measurements, check them and see conflicts; the guide tells Claude when to measure and when to trace | 3–4 cards |
| 4 | Editor: generated elements shown as locked, a panel with the findings | 3–4 cards |
| 5 | Read-only view for the phone, with a share link | 3–5 cards |

About 20–28 cards, most of them TypeScript in v1. That is against roughly 190 for the parity plan.

## 5. What happens to what was built in v2

| Part of v2 | Fate |
|---|---|
| Kernel: model, text format, solver, conflicts, suggestions, walls, openings | Kept. This is the engine. |
| Diagnostic pictures (conflict, missing, diff) | Kept as engine output; v1 can show them |
| Stdio MCP server and command-line tool | Kept as developer tools; not the product |
| PDF sheets, title block, permit review, fixtures, apartments in v2 | Not used by v1 (v1 has its own). Left in place, not developed further |
| Row 7 cards (sources, upload, calibration, history), hosting proposal, viewer file, v1 import, the new editor, accounts | Dropped. v1 already has sources, hosting, sharing and an editor |
| Angled walls in v2 | Not needed: v1 draws them, and a measured apartment can sit beside hand-drawn angled walls |

## 6. Open points

- **The build runs are set up for Rust cards.** Steps 2–5 are TypeScript in a Next.js app with Playwright tests, so the runner and card format need a v1 variant before cheap runs can build them. `AGENTS.md` also warns that this Next.js version differs from what models know; cards must point at the bundled docs.
- **Generated wall segments meet with visible seams** in the spike's drawing; the exporter should merge collinear segments and make corners meet at centre-line intersections, as hand-drawn v1 walls do.
- **A later editor.** Nothing here chooses one. The SketchUp-style editor can still be built later as another way in.
