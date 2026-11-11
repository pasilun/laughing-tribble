# Evidence for the next version of the Claude connector

Written 2026-11-11 for a design decision: should Claude change plans through JSON operations (`plan_edit`
today) or a compact text format, and should measurement-level operations (room sizes, laser readings between
wall faces) be added to the flow? This file records what this project actually learned, and how sure we are.
Nothing in the code was changed to write it.

## How to read this

Every point is tagged:

- **[measured]** a number from a test, a tool, a log or a count made for this file. The method is given.
- **[observed]** something that happened while working and is visible in the conversation log, with date, time and
  who/what did it. It is one occurrence, not a rate.
- **[decision]** a decision or reason as I read it from the history (the conversation, commit messages, code
  comments). Not measured.
- **[gap]** the history does not show it, or nobody ever measured it. A gap is stated, not filled.

Sources:

1. The full conversation log of this session: 11,542 messages, 2026-10-20 → 2026-11-11 (`…/1ab33331-….jsonl`
   under `~/.claude/projects/`, not in the repo). `#N` below is the line number in that file. I searched it by
   keyword; counts from it are **lower bounds**, and tool results in my extract were cut at 900 characters.
2. The repo at `main` (commit 8a04e51), its commit messages, `docs/agents.md`, `docs/plan-studio.md`.
3. Two Drive files written on 2026-10-26: `rapport.md` and `bilaga-B-revisionslogg.md` (the 44 revisions of the
   city-drawings-only plan).
4. `plan_list` / `plan_revisions` read through the connector on 2026-11-06 for the lgh 152–154 plans.

### Who did the work (model attribution)

Almost all plan building in this history was done by **Claude Code in this session calling the same tool
handlers** (through `scripts/plan-tool.ts`, through small scripts, and later through the deployed connector) —
not by a small model talking to the connector in a chat. That limits what the history can say about small models.

The session's model, from the `/model` commands in the log **[observed]**:

| Period (UTC) | Model |
|---|---|
| until 2026-10-25 19:20 | no setting in the log; commit trailers say Opus 5.5 (46 of the 124 `Co-Authored-By` trailers in the repo; 70 say Sonnet 5.5, 8 name no model) — **[gap]** per message |
| 10-25 19:20 – 20:53 | claude-haiku-5-5 |
| 10-25 20:53 – 10-26 06:55 | claude-sonnet-5-5 |
| 10-26 06:55 – 16:51 | claude-opus-5-5 |
| 10-26 16:51 – 16:54 | claude-haiku-5-5 |
| 10-26 16:54 – 10-27 10:53 | claude-sonnet-5-5 |
| 10-27 10:53 – 10-30 07:45 | claude-opus-5-5 |
| 10-30 07:45 – 11-11 | claude-sonnet-5-5 (no later `/model` in the log; trailers agree) |

One more model episode: on 2026-10-31 07:29–07:35 the owner ran **"Sonnet" in claude.ai** against the
deployed connector (the exact version is not recorded) — section 3.

A credential was pasted into the chat on 2026-10-31 07:06 (#18039). It is deliberately not reproduced here. The
assistant declined to use it and asked the owner to revoke it; the log never shows that it was revoked.

---

## 1. Why plan changes are JSON operations

### What was decided and why — [decision]

The first plan, 2026-10-20 10:21 (#56), starts from the repo's earlier 3D/IFC product, whose MCP tool
`update_building` "needs the **full parameter set** and rebuilds everything, so it can't make small edits", and
whose saves "**overwrite** the last one". It sets the rule that everything since has followed:

> "the semantic model is the only source of truth. The drawing is always rendered from it, deterministically.
> Claude and the hand editor both change the model through small operations, and every change is saved as a new
> revision."

Planned: `edit_floor_plan(model_id, base_revision, ops[])` with semantic ops, "a raw JSON-Patch fallback covers
anything else", `base_revision` so that a hand edit made meanwhile rejects Claude's edit, and "the model is
validated after every edit".

The reasons the owner and I wrote down on 2026-10-20 (#135, #146), after the owner said "To produce these
drawings I did it manually in SketchUp – Claude python was not good enough":

- "Coordinates calculated 'in its head' with no visual check" → operations on named elements plus a rendered
  preview back to Claude after every change.
- "Measurements guessed from images" → measurements must come from the owner or from a calibrated drawing,
  "never from Claude estimating pixels".
- "Everything rebuilt on each change" → each change touches only what it changes.

The code states the same rule in `lib/plan/domain/ops.ts` ("Claude and the editor both change a plan only through
these, so an edit never regenerates parts it doesn't touch") and `lib/plan/mcp/mcp-tools.ts` ("Claude never
regenerates a plan: it reads it, then sends small operations against a known revision, and gets a rendered
preview back").

Earlier lessons from the 3D product exist only as commit subjects (May 2026, other sessions, not in this log), e.g.
`0e3e692` "opening offsetFromStart always from SW corner (fixes mirrored north/west wall placement)",
`dc0a869` "MCP returns params + warning alongside URL to prevent hallucination", `2b7408f` "model summary to MCP
tool response for self-correction", `c34041c` "hinge and swing parameters to door openings". I only know the
subjects. **[gap]** what failed there, with which model, how often.

### Alternatives — what was considered, tried, or never touched

| Alternative | Status | Evidence |
|---|---|---|
| **Whole-plan replace** | Exists, not what Claude edits with. The editor saves the whole plan (`PUT /api/plans/:id`, now `replacePlan`); `plan_import` and `plan_create {plan}` take a whole plan; `plan_get include_json` returns one (13 mentions). | [observed] #7303: "The editor saves the whole plan through the plan route, not through ops." Used for copying and branching a plan (`copy_sources_from`), and exporting `plan-rev44.json`. **[gap]** no comparison of edit-by-whole-plan vs edit-by-ops was ever run, and nothing shows that Claude tried replacing a plan to edit it. The reason is the 2026-10-20 reasoning above. |
| **Raw JSON-Patch fallback** | Planned 2026-10-20, never built (no such op in `ops.ts`). | [decision]; no later mention. |
| **Text format / DSL for plans** | **Never proposed or tried in this history.** A search for "DSL" and "text format" finds only your request of 2026-11-11 and an unrelated Swedish passage. | **[gap]** — there is no evidence for or against it from this project. |
| **propose_floor_plan → verify → commit** | Planned 2026-10-20 (a verification report before anything is saved), never built. `plan_check`, `plan_review` and later `plan_audit` took over the verification role. | [decision] from the plan text; no log of why it was dropped. |
| **Higher-level verbs** | Built 2026-10-31, commit `254aad3`: `plan_fix` (verbs: move/resize/delete a wall, add a wall, set an opening's offset/width/kind/swing, add/rename a room, or apply audit findings by id), `plan_next`, `plan_trace`, `plan_audit`, `plan_view`. The `?tools=basic` profile contains **no `plan_edit`** (11 tools). | [decision] — reasons in the next block. Never evaluated (section 3). |
| **ASCII floor plan in tool results** | Added in the 3D product (`b24ed95`, May). The current tools return PNG. | **[gap]** why. |

Why higher-level verbs were added (2026-10-31 07:02, #18027) — [decision], numbers [measured] that day:

- 26 tools = about 7,200 tokens of definitions sent every turn; `plan_edit` alone had a 3,544-character
  description (the ops reference); `snap_walls` and `source_add` take 14 parameters; `plan_get` of the 32-wall flat
  model = 6,600 characters ≈ 1,900 tokens; each `plan_edit` result carried the full summary, the checks and a
  1600 px image. "A rework loop of 10 small fixes re-reads the whole plan and sees 10 images."
- For a small model, the stated failure modes were sequencing (choose the order of ~15 calls), parameters (8–14),
  **"it has to write raw ops with mm coordinates"**, and judging overlays. This is a hypothesis; the same message
  says so ("a guess"), and the harness meant to test it was never run (section 3).

What changed in response: `plan_edit` now returns only the new revision, what changed by id and the *new*
findings, no picture unless `image:true`; the ops reference moved into `plan_guide {"topic":"ops"}`
(`plan_edit` description: 3,544 → 1,360 characters today); `plan_get` takes `only` and `since`.

Decision on 2026-10-31 07:49 by the owner: **pause connector work for general chat** — "working in claude code and
making some use of the tools have been more successful". So nothing was decided about whether `plan_edit` should
leave the short set for good (#18295 listed it as open).

### What the operations are used for — [measured]

All 89 `plan_edit` calls made through the deployed connector (2026-10-31 21:29 → 2026-11-06 18:44, Claude in
Claude Code, Sonnet 5.5), counted from the log:

- 535 operations, mean 6.0 per call, median 3, max 69.
- By kind: `update fixture` 84, `add fixture` 61, `update note` 47, `update room` 44, `add opening` 40,
  `update dimension` 37, `update wall` 27, `update opening` 27, `delete opening` 26, `add wall` 26, `delete wall` 19,
  `delete fixture` 18, `add note` 15, `add room` 12, `update zone` 11, `add dimension` 11, **`moveVertex` 8**,
  `setTitleBlock` 7. `moveWall`, `setWallLength` and `scale` were not used in these 89 calls.
- `image:true` was requested in 67 of the 89 calls (so a picture came back on 75 %).
- 0 of the 89 were rejected (no error flag, none starts with "Ingen ändring sparades").
- The `ops` JSON of the 89 calls totals 54,554 characters minified (≈ 613 per call, ≈ 175 tokens at 3.5
  characters per token). Of those characters, **41 %** are JSON punctuation (`{}[]":,`) and **21 %** are key
  names. That is the most a compact text form could remove from the *input*, in characters; I did not measure
  tokens and did not write the alternative form. Bigger numbers are on the output side: `plan_get` ≈ 1,900 tokens
  for a 32-wall plan and an image per call.

Counting caveat: this is one user, one model, one flat, edited mostly by small updates. It says what *this* use
looks like, not what a small model would need.

### What the history does and does not say about JSON as the problem — [observed], inference mine

None of the failures in section 2 was a JSON syntax error. They were about **ids, missing fields, the meaning of
`hinge`/`swing`, offsets measured from an end, and centre line vs face**. Nothing in the history shows the JSON
format as the cost; nothing shows that a text format would help or hurt either.

---

## 2. Where models struggled with the operations

Each row is one thing seen, with the model that did it where the log lets me say.

| What | Evidence | Model / when | How often | What we changed |
|---|---|---|---|---|
| **Hinge and swing written from memory** | #3148, #3372: "11 of the 13 [doors] had the hinge on the wrong side, opened the wrong way, or both. That came from my original hand tracing, where I guessed the hinge values." Cause given: "written in the plan's abstract format: 'hinge at the a or b end, swing left or right seen from a to b'. Nothing checked them." | Opus 5.5 (trailer of `eef65f4`, 2026-10-22 18:23) | 11 of 13 doors in one trace [observed] | `plan_scan_doors` (`eef65f4`) scores all four hinge/swing options by shape; the ops text says "hinge/swing: don't set them by eye"; `plan_get` lists each door in words ("gångjärn vid västra karmen, öppnar mot norr"). |
| The correction was also wrong once | #3185 (2026-10-22 18:09): the leaf and the arc of a door symbol were mixed up; fixed after the overlay drew the plan's leaf and arc on the drawing. | Opus 5.5 | 1 of 13 re-checked | overlay now draws each door's leaf and arc. |
| Hinge flipped on a guess | #11192 (2026-10-26 20:11): a message was cut off; both hinges were flipped "on a guess", "they still open the same way". | Sonnet 5.5 | 2 doors | no tool change. |
| Door swing checked, but not what it opens into | #10804 → #10871 (2026-10-26 17:45–17:49): swings were tested against walls and doors only; the owner pointed out the room size on the other side matters. | Sonnet 5.5 | 3 entrance doors | a different check was run by hand; not a tool. |
| **Offsets measured from the wall's a-end** | Openings are stored as `offset` from `wall.a`. Moving a wall's start moved its openings (#7040, 2026-10-25 20:06): the render showed an entrance opening "shifted 230 mm west, off the gap in the wall". In Appendix B: rev 28 (+230 mm on 3 openings) and rev 38 (+180 mm on 3) rewrite offsets by hand to keep absolute positions. | Haiku-labelled session (rev 28); rev 38 on 2026-10-26 12:07 (Opus 5.5) | seen twice in one wall | `9c527ac`: "moving a wall's start moves its openings with it, so they stay where they were drawn" (in `ops.ts`). |
| **Missing / invalid fields** | Appendix B rev 43 (2026-10-26 12:45) saved an opening with `offset: null`; rev 44 corrected it. #10331 (13:48): `operation 2 (add): Cannot read properties of undefined (reading 'id')` (an `add` with no usable `item`). | Opus 5.5 | 2 | `2232bab`: validation rejects an opening without a numeric offset and width. |
| **Id reuse / wrong id** | #10915 (17:55): `operation 14 (add): wall sk-153-schakt finns redan` (should have been an `update`). #11300 (22:08): a script crashed on a wall id (`block-152` vs the real `bv-152-block`). Connector era: `plan_get` with an empty id twice (`ogiltigt plan-id ""`, 2026-11-02 15:05). | Sonnet 5.5 | 3 + 2 | validation text names the problem; nothing structural. |
| **A snap that tilts or moves things** | Rev 14 applied a fit to 9 walls "unintentionally", reverted in rev 15–16 (2026-10-25 17:43). Rev 18 fitted `entre` as (22782,13003)→(22600,15675), a tilted wall; rev 20 "rak igen". | model not recorded **[gap]** (probably Opus) | 2 episodes | `plan_scan_snap_walls` squares walls by default (`square: args.square !== false`); `prior_thickness` option after a 200 mm prior was wrong for a 400 mm wall (#7008, Haiku-labelled session). |
| **Scale / stretched scans** | The Sonnet run (section 3) calibrated one scale (−24.96 %) and never straightened. `plan_audit` then proposed 78–80 mm wall moves that would have pushed the outside size to ≈ 10,578 mm against a printed 10,500 (the scan was stretched ≈ 0.8 % / 0.4 %). | Sonnet in claude.ai, 2026-10-31; the audit flaw was mine | 1 run | `67d1910` (audit names the stretch and stops proposing wall fixes); `plan_scan_dimension apply` straightens; `fit_outer`. |
| **The tool surface made a model say före/efter for a plan of what exists** | #18362: "Sonnet also talked about före and efter – why?" Links, a `view` argument on 6 tools, "default efter", "Före shows today; efter marks rivs/ny" in the ops text. | Sonnet in claude.ai | 1 run | `7dfb44b`: one sheet and one link for a plan with no changes; no `view` in the basic profile. |
| **Guessing the interpretation of an owner's drawing symbol** | #1710 (2026-10-22 10:31): a "frame" was in fact the entrance wall between two doors. | model not recorded | 1 | none. |
| **Centre line vs face (this week)** | The owner's laser readings are between wall faces; the model stores centre lines + thickness. For the south wall I converted faces ↔ centre lines by hand three times (revs 27 and 29 were 12 operations each: 4 `moveVertex` for the walls that end on it, a thickness update, fixtures, a zone, dimensions). | Sonnet 5.5, 2026-11-06 | 3 rounds for one wall | no tool change. |
| **A position inside the wall thickness** | The owner: balcony doors "reach only 45 cm into the room although they are 65 long". Leaves were always hung at the wall face; no field said where in a 445–559 mm wall the frame sits. Seen only after zooming a render. | Sonnet 5.5, 2026-11-06 | 4 doors | `opening.inset` (`3a3bea8`). |
| **Stale dimensions after wall moves** | After the owner moved walls in the editor (rev 26) the bottom dimension chain (1890 / 121 / 3514 / 5530) still showed the old values; the check did not flag it. | 2026-11-06 | 4 dimensions | none yet. |
| **Check texts use ids** | The owner: validation "mentions walls with code names that are hard to understand and not marked in the plan" (e.g. "Dörr yt-s.bd154-v går in i yt-s, lg-153-154-n"). | 2026-11-06 | all wall/opening findings | The web editor's Kontroll tab now says "väggen mellan Hall och Kök (2,4 m)" and numbers findings on the drawing (`checkPlan(plan,{plain:true})`, `e80fe0f`). **The connector's output still uses ids** (Claude needs them). |
| `plan_view` with `what:"plan"` ignores `rect` | Returned the whole sheet when a zoom was asked for (2026-11-06). I did not look at the cause. | — | 1 | none. |

How the answers were shaped by these (all [decision], dated above): `plan_audit` (numbered findings with stable ids and
the fix as ready ops), `plan_fix` (apply by id), `plan_next` (the next call, arguments filled in), the `basic`
profile, and the guide text ("Read hinge and swing from the drawing, do not guess"; "Never guess a measurement"). **[gap]**
Whether any of these made a smaller model better. No small model was run with them.

---

## 3. Results from `npm run eval:agent` and other runs where a model drew through the tools

### `eval:agent` — **no result with a model exists**

- The harness exists (`scripts/eval-agent.mts`, commit `254aad3`, documented in `docs/agents.md`): it adds the cellar
  drawing as a source, tells the model to "make a plan of it", loops tool calls in-process, then scores outside
  size against the printed 6,080 × 10,500 mm, the windows (2 in the drawing), tool calls, errors, tokens,
  seconds, open audit findings, and writes the conversation to `.visual/eval-<model>-<profile>.md`.
- It was **never run against the API**: "`ANTHROPIC_API_KEY` … no key in this session" (#18034, 2026-10-31
  07:05); the same statement is repeated in #18285 and #18411. `docs/agents.md` itself says "run each setting a few
  times: one run is anecdote".
- Two **dry runs** with a scripted stand-in are the only files: `.visual/eval-dry-basic.json` and
  `.visual/eval-dry-full.json` (the folder is git-ignored; present in this container only). The numbers show the
  harness works, not anything about a model: tool definitions 2,497 tokens / 11 tools (basic) against 8,483 / 31
  (full); both ran 4 scripted calls (`plan_next`, `plan_trace`, `plan_audit`, `plan_fix`); the `tokens`
  (5,000 in / 500 out) are placeholders.
- Today's tool sizes, same method (`description + JSON schema`, ÷ 3.5 characters per token) — [measured] 2026-11-11:
  full = **39 tools ≈ 9,300 tokens**; basic = **11 tools ≈ 2,250 tokens**. (26 tools ≈ 7,200 on 2026-10-31.)

### The one model run through the connector in a chat

2026-10-31 07:29–07:35, the owner ran "Sonnet" in claude.ai on a hand-drawn cellar scan. I read the result back
at 07:35–07:38 (#18315–#18358). Plan `ny-planritning-d5b0cb766cbfc2a2`, **10 revisions in about 6 minutes**:
source added; calibrate (−24.96 %); rough walls; snap; openings and doors; rooms, stairs, scale 1:100 and floor
in the title block; `plan_finish`; two further edits (an opening, a pillar). [observed] from revision log.

- Good: outside size 6,080 × 10,500 drawn and dimensioned; all four rooms with right names and areas; a kinked
  wall traced as three segments; the stair and the "9" compartment placed; a window 1,455 mm wide.
- Wrong or missing: the **left north window missing** (and the audit then concluded "Pannrum has no window");
  title block Fastighet / Adress / Lägenhet / Ritad av **empty** although `plan_finish` says to ask; a door
  between Pannrum and Tvättstuga that "looks invented" (drawing shows a wall stub); one scale, never straightened.
- `plan_audit` on it: 20 findings (1 error, 18 warnings), 12 fixable — most wall findings were the stretched-scan
  artefact above.
- It used calibrate / snap / openings, **not** `plan_trace` / `plan_audit` / `plan_fix`. That is *not* a finding
  about the new tools: the commit with them was pushed at 07:27 and the next deploy was still queued at 07:38, and
  claude.ai caches a connector's tool list. **[gap]** whether the new tools were even available to that run.
- Not recorded: tokens, cost, number of calls, exact model version.

Before that, seven cellar-type plans from other chat attempts are in the list (revisions 13, 8, 8, 5, 1, 3, 2;
"Källarvåningen …"). **[gap]** which model/profile made them; I did not read their histories.

### Tool-call counts, for scale — [measured], lower bounds

- Through the deployed connector, 2026-10-31 → 11-06 (Sonnet 5.5 in Claude Code): 177 plan-tool calls —
  `plan_edit` 89, `plan_get` 29, `plan_view` 14, `plan_revisions` 10, `plan_list` 9, `plan_scan_view` 7,
  `plan_import` 4, `plan_tags` 3, others 1–2.
- Through `scripts/plan-tool.ts` or scripts, 2026-10-22 → 11-11: at least 349 command mentions —
  `plan_scan_view` 71, `plan_scan_openings` 56, `plan_edit` 52, `plan_get` 34, `plan_scan_snap_walls` 24,
  `plan_scan_profile` 24, `plan_source_add` 16, `plan_scan_doors` 15, `plan_scan_elevation` 13,
  `plan_scan_register` 11, `plan_compare` 9. This counts command text, not executions, and many edits were
  written as TypeScript scripts that call `handlePlanTool`, which this count does not see.
- Real cost per run (tokens, dollars) was not recorded for any of these. **[gap]**

### What the cellar tracer does without a model — [measured], `docs/agents.md`

`plan_trace` on the hand-drawn, stretched cellar scan could not find the house on the sheet by itself and asked
for dimension end points; with them: 12 walls (4 exterior), 3 doors, 7 "windows" (drawing has 2), outside size
6,534 × 10,522 mm against 6,080 × 10,500 (east wall found only in pieces), and `plan_audit` found nothing more to mend
on the walls. This is the draft a model starts from.

---

## 4. How the flat (lgh 152–154) and the whole-floor plans were made

### The plans and their revision counts — [measured] unless marked

| Plan | Revisions | Notes |
|---|---|---|
| Predecessor "ny från a00-24" | 51 | Drive report; walls from the 1999 drawing placed/snapped; sources straightened (rotated 0.73°, shear 0.96°). |
| City-drawings-only 1 tr (`gnejsen-1-tr-endast-stadens-ri-…`) | **44**, 2026-10-25 12:50 → 10-26 12:46 | Appendix B. 3 flats, 30 walls (13 load-bearing), 30 openings, 20 rooms. |
| Laser-based "befintligt idag" (the owner's SketchUp as the source) | **≥ 39 on 2026-10-26** (first mention rev 2 at 12:58, rev 39 at 22:09) | 86 user messages that day; many are circled screenshots. |
| Whole floor, 14 flats, 48B drawn and 48A mirrored | rev 15 (10-27 07:56) → rev 25 (10-28 13:07); numbers from the assistant's own messages, two sibling plans share some numbers | "Mirroring was an assumption, not a finding" (#13904) — then tested against the 1936 drawing; also "I had numbered 48A's flats wrong" (#14068). |
| Flat "ändring 153/154" | 50 (2026-10-30 → 11-03) | |
| "förslag B" | 15 | |
| **"basplan"** (current) | 25 on 11-04, 29 on 11-06 | Rev 9–25 (17 revisions) in one day, 2026-11-04 05:20–18:31, one or two per sketch the owner sent. Rev 26 was made by the owner in the editor (moved a wall, furniture, openings, widths). Rev 27–29: south wall, balcony doors, south wall again. |
| The cellar | 3 min from "Kan du göra en plan av denna" to a first sheet (2026-10-30 07:32 → 07:35, Claude Code, model not recorded — likely Opus 5.5) | The 2026-10-31 Sonnet run took 6 min (section 3). |

### Which steps took the most rounds, and why — from Appendix B (44 revisions) — [measured], my reading of the messages

- **Openings from scans: 12 of 44 revisions** (3, 4, 6, 7, 8, 10, 11, 13, 21, 22, 32, 33) plus 3 that remove openings
  (5 = delete all so they are rebuilt only from the tools; 9 and 12 = a false find from scan noise, and "the arc
  was the WC bowl").
- **Wall positions and thickness: 8** (14, 17, 18, 26, 27, 36, 37, 38). Rev 36 moved the Kokvrå outer wall **about
  425 mm west**: the plan's inner face (x ≈ 20,335) sat on a stove symbol and the label; three drawings gave
  ≈ 19,905 (#8947: "that was a misreading on my part"). The same morning "I dismissed some of that hatching as scan
  noise" (#8954) — the load-bearing masonry in 152.
- **Corrections of earlier revisions: at least 7** (9, 12, 15, 16, 20, 40, 44) — false finds, an unintended fit,
  a tilted wall, an undone shaft, the missing offset.
- Owner knowledge that the drawings could not give: 35, 39–42 (shaft, balconies, "Kokvrå box is not a shaft",
  door swings removed).

### What caused the rework

1. **Scale and straightening of the scans** — [measured] A00:24 needed +0.44 % scale from 16 measurements (RMS 43 mm),
   rotation 0.73° and shear 0.96°; "where those measurements came from is not recorded". The archive against the
   laser: x −0.42 %, y +0.30 % (stated in the plan for the laser-based model, #9816, 2026-10-26 12:54; how it was measured is not shown there).
2. **Wall positions and thicknesses, drawing vs laser** — [measured], `plan_compare`/Drive report: most walls within
   50–185 mm; the Kokvrå wall 615 mm off before rev 36; the wall 152/153 is **195 mm** in the archive and **111 mm**
   by laser; later the owner measured 285 and 180 mm walls (#10907).
3. **Openings** — [measured]: against the laser, 6 within ≈ 100 mm, **8 off by 150–400 mm** (mostly from 1936 centre
   marks), 6 drawn open but solid in the laser (probably closed after 1999), 2 doors only in the laser; 15
   doorways have an *estimated* width (800 or 700 mm).
4. **Doors' hinge and swing** (section 2).
5. **Facts from the owner after the fact** (ordering of "which source wins" — #11283: "Most differences come from
   measurements you gave me after the PDF was made, so first I need to know which source wins").
6. **Looking-glass fixes: labels and furniture over walls** — [measured] 4 of the 25 basplan revisions (10, 14, 16, 19) only
   move text or furniture that overlapped a wall or each other.

### The same SketchUp PDF compared twice — [observed] and the most relevant for measurement-level operations

The owner's SketchUp drawing ("Planritning Efter", dimension labels = laser readings between wall faces) was
compared with a plan **by hand** on two occasions:

- **2026-10-26 20:19** (#11283): 23 room dimensions against the laser-based plan rev 38. **11 of 23 differ by
  ≥ 100 mm** (e.g. 154 Vardagsrum N–S +182, 154 Sovrum N–S +176, 154 WC N–S −129, 152 Sovrum E–W +120). The note:
  "My readings of where the dimension lines start are approximate, and some labels don't quite match the drawn
  geometry in the PDF. Treat the table as about ±30 mm." Applied as rev 39 after the owner chose which source wins.
- **2026-11-06** (this session): 18 comparisons against the archive-derived basplan rev 25. N–S dimensions in the south
  were **60–190 mm shorter in the laser** (153 Sovrum −113, 154 Sovrum −188, 154 Vardagsrum −60); 152/153 Vardagsrum
  width −73; W–E dimensions within ±50 mm, and the east wall evidence was contradictory (−73 and +29).
  I computed plan values from centre lines and thicknesses (inner face = centre ± thickness/2); no tool did.
  I then moved the south wall's inside 114 mm (rev 27), the owner said the facade was too thick and asked for it to
  be trimmed from the outside (rev 29): **the unit the owner thinks in is the clear distance between faces**,
  and what he asks to keep fixed is "the room size".

Both comparisons are tables made by script/hand from numbers read off an image (section 5). **[gap]** No tool takes "distance
between these two faces = N" as input, or reports "this plan has 3,610 where you measured 3,550". The existing
measurement inputs are `plan_scan_calibrate` / `plan_scan_dimension` (known distances between points *on a source
image*, to fix its scale), the `scale` op (whole drawing), and `plan_compare` (plan against a reference *plan*).

---

## 5. What we learned about pictures

All [observed], one occurrence each unless a number is given.

**When looking found what the numbers missed**

- Openings shifted by a wall-end edit: the numbers passed; the render over the scan showed the entrance
  opening 230 mm off its gap (2026-10-25 20:06, #7040).
- The Kokvrå wall: a median fit across three drawings put the face under a stove symbol and a label; the
  picture of the symbol inside the wall made it plain (2026-10-26 12:03).
- Door symbols: leaf and arc drawn from the plan on top of the drawing turned "I think the hinge is…" into a
  checkable thing (2026-10-22 18:06); the shape-scoring tool was also debugged by drawing the sample points on the
  image (#3272, #3296).
- Text over walls and furniture over furniture: only visible in renders; `plan_check` does not detect it
  (4 of 25 basplan revisions fixed this).
- The balcony door reach: the plan looked right and passed every check; zooming a 3× crop and reading the owner's
  sentence showed the representation had no room for a frame inside the wall (2026-11-06).
- Missing left window and an invented door in the Sonnet run — found by reading the plan back against the picture;
  the audit's conclusion ("Pannrum has no window") followed the gap instead of questioning it.

**When reading positions from a picture went wrong**

- A symbol read wrong (#1710), the door correction read wrong once (#3185), the Kokvrå hatching "dismissed as scan noise"
  (#8954).
- "The profile numbers are too noisy to read the west wall by eye, so I'll overlay" (#6865, 19:56) and six minutes
  later "the image pixels don't give me reliable millimetre positions, so I'll measure the lines directly" (#6965,
  20:02): a picture is good for *where to look*, not for the millimetres.
- This week: the SketchUp PDF's dimension labels are **drawn as outlines, not text** (a text extraction found none), so they were read from the rendered page. Measuring
  the same page in pixels disagreed with the labels by about 2 % (3.07 vs 3.13 m, 4.61 vs 4.70 m), so I used the
  printed labels. On 2026-10-26 the same remark: "some labels don't quite match the drawn geometry".
- A scan that is stretched (0.8 % / 0.4 %) turns correct walls into "findings" in `plan_audit`; the numbers were
  internally consistent and wrong; the picture alone would not have shown 80 mm.

**Cost** — [measured] 67 of 89 connector edits asked for a picture back; the default is no picture since `254aad3`.
The 2026-10-31 estimate: one 1600 px image per edit made a ten-fix rework loop read ten images. No test has
compared a rework loop with and without pictures. **[gap]**

---

## 6. What I would keep exactly, and what I would change

This section is **my judgement from the evidence above**, not a measured result.

### Keep exactly as it is

1. **Edits as small operations against a base revision, all-or-nothing, with 409 on a stale base.** Behind it: the
   rule in section 1; `9c527ac` tests that two saves from one revision give one kept and one conflict; no rejected
   edit in 89 connector calls. The failures seen were semantic, not format.
2. **Stable string ids, integer mm, x right / y down, `update` with a patch.** `update` is the commonest op by far
   (≈ 60 % of the 535).
3. **Server-side validation with a plain reason** ("wall … finns redan", "an opening needs a numeric offset").
   Two of the three real bad edits would have been silent without it.
4. **`plan_edit` returning only what changed and only the new findings; picture on request.** (Keep `image` opt-in
   even though it is used a lot.)
5. **`plan_scan_doors` and the rule "never set hinge/swing by eye"; `plan_get` describing each door in words.**
   11/13 wrong when written from memory is the largest single number in this file.
6. **Evidence per opening** (`evidence[]`, `plan_openings_report`) and **revisions with author and message**: the
   Appendix B log is what made the 44-revision history reviewable at all.
7. **`plan_audit` with stable finding ids and the fix attached, `plan_fix` by id, `plan_next`**, and the
   `basic` profile — as an *unproven* surface, not a proven one.
8. **Server-rendered pictures with a mm grid and an overlay of plan on source** (`plan_scan_view`).
9. **Both tool profiles and a short `plan_guide`**; the instruction "draw what the drawing shows, no changes unless asked".

### Change if it were built again

1. **Let measurements be input.** Add a way to state "clear distance between face A and face B = N mm" (rooms,
   wall-to-wall, opening to wall), apply it by moving a named wall's face and the walls that end on it, and report
   the plan's current value against each stated one. Both SketchUp comparisons and the south-wall rounds were this,
   done by hand. See section 7.
2. **Name things by position as well as by id in everything Claude reads** (wall: "between Hall and Kök, 2.4 m";
   opening: "door, west wall of Barnrum"). Ids stay as the handle. The web editor now does this; the connector does not.
3. **Input words instead of `a`/`b` + `left`/`right`.** Output already says "gångjärn vid västra karmen, öppnar mot
   norr". Accept that vocabulary on input too. Offsets "from the wall's a-end" were the cause of the 230/180 mm
   shifts; anchoring an opening to a face or a neighbouring wall would avoid the repair.
4. **A frame position inside the wall** for every door (`inset` is a first step) and a **wall face** as a first-class
   reference: one thickness change moves the face while the other face stays (done by hand 3 times).
5. **Check that dimensions still describe the walls** they were drawn between (stale chain after wall moves), and
   check for text/furniture overlapping walls (4 of 25 revisions).
6. **Run `eval:agent` with a real key before changing the tool surface again.** The whole short-profile/audit/next
   design rests on a hypothesis about small models that nobody has tested.
7. Record **model, profile, tool calls, tokens and cost** for every real run. None exists for anything before 2026-11-11.

---

## 7. What the evidence says about the two questions asked

### JSON operations or a compact text format?

- **[gap]** There is no experiment, and no mention in the history, of a text format. Anything claimed about it
  would be a guess.
- **[measured]** In 89 real calls the operation JSON was ≈ 613 characters per call, 41 % punctuation and 21 % key
  names. A compact form could shrink the input by something like that share of characters. The input is a small
  part of the tokens of a call: the answer (`plan_get` ≈ 1,900 tokens for 32 walls) and an image dominate.
- **[observed]** The errors seen are not format errors. A text format would not by itself remove: wrong ids,
  missing fields, hinge/swing meaning, offsets from an end, face vs centre line. It would move some of them from a
  validator to a parser.
- A fair test would run the same task with both forms on the same model and count rejected edits, tokens and rework
  rounds; the harness in `scripts/eval-agent.mts` is the place, and it has not run.

### Add measurement-level operations to the existing flow?

- **Evidence for** [observed]: the same comparison done by hand twice (2026-10-26, 2026-11-06) with a ±30 mm
  reading error; 11 of 23 dimensions ≥ 100 mm off on the first; 3 rounds on one wall on the second; the owner
  thinks in clear room sizes and "keep the room size, change the wall".
- **What the existing flow already gives**: `plan_compare` (plan against a reference plan), `plan_scan_calibrate`
  / `plan_scan_dimension` (distances on a source image), `scale`.
- **What is not known** [gap]: how often a model would state measurements in this form, which form is least
  error-prone (face to face, centre to centre, room size), and whether the owner's laser readings should be a
  *source* (a list of dimensions with provenance and tolerance, like a drawing) rather than an operation. The 2026-10-26
  report decided "the owner's laser model: a score only", and the 44-revision plan was built without it; a few
  hours later (#9816, 12:54) the laser model became "the authority on dimensions" in a separate plan (≥ 39 revisions).
