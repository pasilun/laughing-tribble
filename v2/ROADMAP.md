# Planstudio v2 roadmap

Order of work, decided with the maintainer on 2026-11-10. It replaces the outlook in `docs/v2-week1-pro.md` §8 and the phase order in `docs/v2-kernel-plan.md`. Spec runs write cards in this order and update the status column.

| # | Work | Status |
|---|---|---|
| 1 | Kernel and CLI: model, DSL, solver, walls, openings, areas (week one) | Done |
| 2 | Least squares, suggestions, renders sized for Claude, MCP server with check, get, apply, render (week two) | Done 2026-11-10 |
| 3 | Audit fixes and validation; closed corners and door swings; PDF sheets; wall attributes and the permit review (week three, cards W3-01…W3-R3) | Done 2026-11-10 |
| 4 | `.skp` export through OpenSKP | Skipped for now (maintainer, 2026-11-10) |
| 5 | Diagnostic views: conflicts, missing measurements, diff (cards W4-01…W4-R1). Overlay on a source image moves to row 7 | Done 2026-11-10 |
| 6 | Permit sheet: title block, Swedish texts, before/after sheets, dimension chains on two sides (cards W4-09…W4-R2) | Done 2026-11-10 |
| 6b | Model extensions that v1 plans and the editor need: free-standing walls, wall stubs and partitions, non-rectangular rooms, fixtures (kitchen, WC, shower, furniture), balconies, several apartments and a stairwell in one plan (`docs/v2-agent-specs.md` §13). Angled walls are left for later (maintainer, 2026-11-10) | Done 2026-11-10 (W5-01…W5-R2): fixtures, stubs, rooms in parts, apartments, sheet style. Angled walls and free room outlines: later |
| 7 | Source images, the v1 way (no LLM call in the server): the user uploads a drawing or photo through a link, the server stores it and hands it back to the calling model as an image or a crop, calibration against printed dimensions is deterministic, and the `overlay` view draws the plan over it. Plus the `find` and `history` tools and command-log storage | Cards written 2026-11-10 (W6-01…W6-R2): `source` statements and assets, upload link, least-squares calibration, `source_view`, `overlay`, `find`, `history`, JSONL command log. PDF and G4/CCITT TIFF: open |
| 8 | Eval across Haiku, Sonnet and Opus on a fixed task set | Skipped (maintainer, 2026-11-10) |
| 9 | Import of v1 plans and cut-over | Not started |
| 10 | Desktop editor, SketchUp-style (egui/wgpu; lift snapping and the typed-value parser from BenchUp) | Last |
| 11 | Accounts, sharing and MCP OAuth, then the mobile viewer (it needs share links) | Last |

**Dropped:** DXF export. **Skipped:** the cross-model eval, and `.skp` export for now.

## Open points

- **`.skp` (row 4)** is skipped for now. When it comes back: OpenSKP is third-party C++ that a cloud run could not compile earlier, so it needs a local spike or Trimble's hosted connector.
- **Solver reuse.** SolidCraft's sketch solver is not used. The in-house axis solver covers straight walls; revisit only when angled walls are needed (row 10).
- **Manual check still open:** add the MCP server to Claude Code on Haiku (`v2/crates/server/README.md`) and run `check` and `render` on `lgh154-b`.
- **Free-standing walls, angled walls, non-rectangular rooms** (`docs/v2-agent-specs.md` §13) are needed before the editor; the spec run for row 10 decides the DSL.
- **Not yet carded from rows 5–6:** door swings can cross a small room's label; interior dimension lines; chains on the south and east sides; v1's kitchen-plug, ventilation and property-name checks (they need fixtures).
- **Row 7 has no LLM call (maintainer, 2026-11-10).** The model that calls the MCP tools reads the image itself, as in v1 (`plan_upload_link`, `plan_source_add`, `plan_view`). `docs/v2-kernel-plan.md` point 6 of "Giving the model vision" ("read with structured outputs") is superseded: the server never calls a model.
- **Angled walls: later.** The real plans have a few (the stairwell walls of the Gnejsen 48 A/B plan taper), so they are needed before those plans can be imported in full, but not in the first batch of row 6b.
