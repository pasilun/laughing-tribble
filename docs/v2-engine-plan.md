# Planstudio: the plan from here

Written 2026-11-11, replacing the earlier text of this file. It gathers the direction, the architecture and the remaining work in one place. Nothing in steps 1–6 is built yet.

Related documents:
- `docs/mcp-contract.md`: the connector contract (ten fixed tools).
- `docs/mcp-design-evidence.md` (on `main`): what building v1 taught us, with numbers.
- `spikes/face-walls/`: the spike behind section 3.
- `v2/spikes/v1-export/` (on `auto/v2-build`): the spike that wrote a kernel solution as a v1 plan.

## 1. Direction

1. **v1 stays the product.** It has the editor, the scan tools, the permit sheets, hosting, accounts and sharing. The plan to rebuild all of that in v2 is dropped.
2. **Changes stay JSON operations.** 535 operations in 89 real calls, none rejected; every error seen was about meaning, not format. A text language for editing is dropped.
3. **The connector becomes a fixed contract** of ten general tools. New capabilities become new operations, actions, views and checks, never new tools.
4. **Walls move from centre lines to faces.** This was decided at the start of v2 and still holds; it is done inside v1's model (section 3).
5. **Measurements become input.** A clear distance between two named faces is something the plan can be told and checked against.
6. **The v2 kernel becomes one part of the engine**: reasoning about measurements. It is connected last, because that part is the least proven.

## 2. Architecture

```
 CLIENTS    Claude            Browser editor      Phone view        a later editor or API
              │ MCP               │ HTTP              │ HTTP              │
 ═════════════╪═══════════════════╪═══════════════════╪═══════════════════╪══════════════
 WAYS IN    Connector contract   HTTP routes
            (ten fixed tools,    (sign-in, parse, status codes)
             one answer shape)
              │ one function per tool                 │
 ═════════════╪═══════════════════════════════════════╪══════════════════════════════════
 ENGINE     Use cases: the only layer that joins the parts below
            Registries: operations · actions · views · checks · formats
              │               │                │                │
            Plan domain     Scan code        Sheets and       Measurement kernel
            walls stored    reads a          export           chains, conflicts,
            on a face;      scanned          PDF, PNG,        what to measure next
            wall bodies     drawing          SVG, DXF         (Rust → WebAssembly)
            computed from
            them; ops,
            checks, rooms
              │
            Storage and accounts
```

- **Above the first line** are clients we do not control. **Between the lines** are the ways in; they hold no rules about plans. **Below** is the engine, where development happens.
- **The connector contract is the one fixed part.** Its tool list does not change when anything in the engine does.
- **The four parts in the bottom row do not call each other.** The use cases join them, so one can be replaced without the others noticing.
- **The editor and Claude use the same use cases**, as today.
- **A wall's body comes from one function** in the plan domain. The scan code, the sheets, the checks and the editor all ask it for a wall's faces, and none of them computes half a thickness itself. During the move (section 3) a temporary centre-line view stands in front of the code that has not been moved yet; it is not part of the end state.

## 3. Walls on faces

**The problem with centre lines.** A wall is stored as a centre line and a thickness. A laser reading is a distance between faces. So every measurement is converted by hand, and changing a thickness moves both faces. v1's history shows the cost: three rounds on one south wall, and a request to "trim the facade from the outside" that the model cannot express.

**The change.** A wall gets an optional reference side. With it, the stored line is one of the wall's faces and the body lies on the other side. Without it, the stored line is the centre line, as today, so every existing plan stays valid.

**The end state: one function for a wall's body.** The plan domain gets a single function that returns a wall's real body (its two faces and its ends, with corners and T-joints resolved). Everything that draws, measures or checks a wall asks it. The centre line stops being stored and is only a value that can be computed.

**The move, in three steps.** There are 32 places in 12 files that assume a body centred on the stored line (the sheet, the scan's opening and door readers, the checks, the export and two in the editor).
1. **Add the reference side and a temporary centre-line view.** The view moves each wall by half its thickness and runs corners and T-joints to where the centre lines meet, and the old code reads it. This is the spike. It keeps every existing plan working and every existing test passing, and it can ship on its own.
2. **Move the 32 places to the body function, a few at a time,** starting with the sheet and the scan readers, then the checks, then the editor. Each move is a small change with the existing tests as the check. The scan's opening reader, which measures ink across a wall, needs the most care.
3. **Delete the view** when nothing reads it.

**Why not keep the view for good.** Two representations of one wall can drift apart (the spike's half-millimetre rounding was exactly that). A new check or reader would read the easy one, the centre line, and throw the faces away again. And a reader that wants "the inner face" would have to work it back out from the centre line and the thickness.

**Spike result** (`spikes/face-walls/`, lgh 154 with every wall stored on a room face, v1's own code unchanged):
- v1 validated the view with no errors and no findings, drew a normal sheet, and computed the same room areas as before.
- Making the south wall 100 mm thinner kept its inner face and the room's area. The same edit on the centre-line plan moved both faces 50 mm and changed the room from 3.887 to 3.980 m².
- A face-referenced wall met a centre-line wall, and a wall at 45°, at one point.

**Not yet tested:** the editor with face-referenced walls; the scan readers writing back to stored walls; shallow angles and three walls at one point; whether every one of the 32 places moves cleanly to the body function (the opening reader that measures ink across a wall is the doubtful one). A wall with an odd thickness has its centre on a half millimetre; the body function should compute from the face and never round it.

## 4. Remaining work

Sizes are estimates. Almost all of it is TypeScript in v1.

| # | Work | What it delivers | Size |
|---|---|---|---|
| 0 | Housekeeping | The dropped v2 cards marked as dropped; the plan documents on one branch | Done 2026-11-11 |
| 1 | Baseline eval | A real model on today's connector, so later changes can be compared. No API key in the app (2026-11-14): run from a session with a subagent instead of `npm run eval:agent` | A session's usage |
| 2 | The connector contract | The ten tools, one answer shape, registries, a generated guide, the frozen-list test, today's 37 tools mapped across | 25–35 cards. **First batch written: `work/cards/S2-01`…`S2-R1` (foundation, frozen list, endpoint, guide, edit, get, list).** Next: `check`, `view`, `manage`, `export`, `source`, `scan`, then removing the old tools |
| 3 | Walls on faces, and better words | The reference side and the temporary centre-line view; the move of the 32 places to one body function, then the view deleted; operations that speak in faces; compass words for hinges and swings; openings anchored to a face; things named by position as well as by id; checks for stale dimensions and for text over walls | 20–28 cards |
| 4 | Measurements as input | State a clear distance between two named faces; the plan's value reported against each; apply by moving a named face | 8–12 cards |
| 5 | The measurement kernel | Measurements checked against each other in chains; conflicts with both chains; what to measure next. Later: a new apartment drawn from measurements alone | 15–25 cards, after a spike |
| 6 | View link for the phone | Dropped 2026-11-14 | – |

**Why this order.** The contract comes first so that steps 3–5 add vocabulary without touching the tool list. Faces come before measurements because a measurement names two faces. The kernel comes last because turning an existing traced plan into the kernel's terms is untested.

**How it is built.** Cards live in `work/cards/`, the rules in `work/CLAUDE.md`, the runner in `work/RUNNER.md`; the two agents are `.claude/agents/v1-implementer.md` (Haiku) and `v1-reviewer.md` (Opus). Runs work on the branch `auto/v1-build`, which the runner creates. The scheduled runs are paused and no trigger exists for this runner yet.

## 5. Decisions (settled 2026-11-14)

- **Laser readings are a source:** a list of dimensions with provenance and tolerance, like a drawing, so "which source wins" is answered the same way as for drawings.
- **Conflicting measurements are saved and flagged:** the plan keeps the last good drawing and shows the open conflict until it is resolved.
- **View links (step 6) are dropped.**
- **No API key for the app:** the baseline eval (step 1) runs from a session with a subagent.
- **Still open:** when the old tools are removed (after the maintainer is sure the ten tools work), and the doorway reader (T-07, parked).

## 6. What happens to v2

| Part of v2 | Fate |
|---|---|
| Kernel: model on faces, solver, conflicts, suggestions | Kept; connected in step 5 |
| Diagnostic pictures (conflict, missing, diff) | Kept as ideas for v1's views |
| Stdio MCP server and command-line tool | Kept as developer tools |
| The text language | Kept inside the kernel as a compact way to read measurements; not an editing interface |
| Sheets, title block, permit review, fixtures, apartments in v2 | Unused; v1 has its own |
| Row-7 cards (W6), hosting v2, the viewer file, v1 import, a new editor, accounts | Dropped |
| `.skp` export, the cross-model eval of v2, DXF from v2 | Dropped or skipped earlier |

A SketchUp-style editor is not ruled out. It would be another client above the first line and needs nothing in this plan to change.
