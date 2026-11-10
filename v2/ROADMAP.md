# Planstudio v2 roadmap

Order of work, decided with the maintainer on 2026-11-10. It replaces the outlook in `docs/v2-week1-pro.md` §8 and the phase order in `docs/v2-kernel-plan.md`. Spec runs write cards in this order and update the status column.

| # | Work | Status |
|---|---|---|
| 1 | Kernel and CLI: model, DSL, solver, walls, openings, areas (week one) | Done |
| 2 | Least squares, suggestions, renders sized for Claude, MCP server with check, get, apply, render (week two) | Done, except W2-R1-f2 (ready) |
| 3 | Audit fixes and validation; closed corners and door swings; PDF sheets; wall attributes and the permit review (week three, cards W3-01…W3-R3) | Cards written 2026-11-10 |
| 4 | `.skp` export through OpenSKP | Needs a spike first, see below |
| 5 | Diagnostic views: conflicts, missing measurements, before/after diff, overlay on a source image (`render` views that answer E022 today) | Not started |
| 6 | Full permit sheet: title block, Swedish texts, before/after sheets, dimension lines | Not started |
| 7 | Import of laser photos and sketches into readings; MCP App "tap the wall"; `find` and `history` tools; command-log storage | Not started |
| 8 | Eval across Haiku, Sonnet and Opus on a fixed task set | Not started |
| 9 | Import of v1 plans and cut-over | Not started |
| 10 | Desktop editor, SketchUp-style (egui/wgpu; lift snapping and the typed-value parser from BenchUp) | Last |
| 11 | Accounts, sharing and MCP OAuth, then the mobile viewer (it needs share links) | Last |

**Dropped:** DXF export.

## Open points

- **`.skp` spike (row 4).** OpenSKP is C++ from a third-party repo. An earlier attempt to compile third-party code in a cloud session was stopped by the safety check, so a build run cannot do this spike. Either the maintainer runs it locally (write a four-wall `.skp`, open it in SketchUp for Web), or `.skp` goes through Trimble's hosted SketchUp connector instead. No cards until that is settled.
- **Solver reuse.** SolidCraft's sketch solver is not used. The in-house axis solver covers straight walls; revisit only when angled walls are needed (row 10).
- **Manual check still open:** add the MCP server to Claude Code on Haiku (`v2/crates/server/README.md`) and run `check` and `render` on `lgh154-b`.
- **Free-standing walls, angled walls, non-rectangular rooms** (`docs/v2-agent-specs.md` §13) are needed before the editor; the spec run for row 10 decides the DSL.
