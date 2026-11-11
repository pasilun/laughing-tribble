# Planstudio v2 roadmap

> **Direction changed, 2026-11-11.** v1 stays the product and the v2 kernel becomes its measurement engine: see `docs/v2-engine-plan.md`. The table below is the earlier parity plan. Rows 1–6b are built; rows 7 and 9–14 are dropped under the new direction (the row-7 cards W6-01…W6-R2 stay in `v2/cards` as `ready` but are not to be built). The scheduled runs are paused.

Order of work, decided with the maintainer on 2026-11-10. It replaces the outlook in `docs/v2-week1-pro.md` §8 and the phase order in `docs/v2-kernel-plan.md`. Spec runs write cards in this order and update the status column.

| # | Work | Status |
|---|---|---|
| 1 | Kernel and CLI: model, DSL, solver, walls, openings, areas (week one) | Done |
| 2 | Least squares, suggestions, renders sized for Claude, MCP server with check, get, apply, render (week two) | Done |
| 3 | Audit fixes and validation; closed corners and door swings; PDF sheets; wall attributes and the permit review (week three) | Done |
| 5 | Diagnostic views: conflicts, missing measurements, diff (week four) | Done |
| 6 | Permit sheet: title block, Swedish texts, before/after sheets, dimension chains on two sides (week four) | Done |
| 6b | Model extensions: fixtures, wall stubs, rooms in parts, apartments, balconies, black-and-white sheets (week five) | Done. Angled walls and free room outlines: later |
| 7 | Source images the v1 way (no LLM call in the server): `source` statements, upload, calibration, `source_view`, `overlay`, `find`, `history`, command log | Dropped 2026-11-11 (W6-01…W6-R2 are marked `dropped`) |
| 12 | View-only viewer as one self-contained HTML file (`export --format html`): zoom, layers, tap for details. Opens on a phone with no server | Proposed 2026-11-11 (`docs/v2-deploy-plan.md`) |
| 13 | `plan-tools` (pure tool layer, JSON in and out) and `plan-wasm`; CI for `wasm32` | Proposed |
| 14 | Hosted v2 inside the existing Vercel app: Blob storage, MCP endpoint behind v1's OAuth, upload link, read-only view links `/v/<token>` | Proposed; needs the maintainer's decisions 1 and 2 in the deploy plan |
| 6c | Angled walls and free room outlines | Later; needed before row 9 covers plans like Gnejsen 48 A/B |
| 9 | Import of v1 plans and cut-over | Not started |
| 10 | The editor (technology to be decided again once row 14 runs: Rust egui, or a browser editor on the WebAssembly kernel) | Last |
| 11 | Accounts and sharing | Nothing new if v2 is hosted inside the v1 app |

**Dropped:** DXF export. **Skipped:** the cross-model eval (row 8), and `.skp` export (row 4) for now.

## Open points

- **Deployment and the viewer** are planned in `docs/v2-deploy-plan.md`. Rows 12–14 are a proposal until the maintainer confirms the order and the two decisions.
- **`.skp`** is skipped. When it comes back: OpenSKP is third-party C++ that a cloud run could not compile earlier, so it needs a local spike or Trimble's hosted connector.
- **Solver reuse.** SolidCraft's sketch solver is not used. The in-house axis solver covers straight walls; revisit with angled walls (row 6c).
- **Manual check still open:** add the MCP server to Claude Code on Haiku (`v2/crates/server/README.md`) and run `check` and `render` on `lgh154-b`.
- **Row 7 has no LLM call (maintainer, 2026-11-10).** The model that calls the MCP tools reads the image itself, as in v1. PDF sources and G4/CCITT TIFFs are open.
- **Small flaws without cards:** no warning when a door swing crosses a fixture; stubs ignore the before/after filter on sheets; marks in the missing view can cross a room label; a title text cannot contain a double quote; a demolished room's name still prints on the after sheet; interior dimension lines and chains on the south and east sides.
- **Out-of-date documents:** `docs/v2-kernel-plan.md` is the plan of 2026-11-09 and carries a note at its top saying what this roadmap replaced. The PDF copies in `docs/` are older still.
