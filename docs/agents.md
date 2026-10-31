# Tools for models: the short surface, and measuring it

The scan tools (calibrate, detect, snap, openings, doors, elevation …) are exact but many: a
model has to choose the order, fill in 8–14 parameters and judge pictures. That works for a
large model and is hard for a small one, and every review round re-reads the plan and looks at
images. Three things make it cheaper and easier.

## 1. A short connector: `?tools=basic`

`https://<host>/api/mcp?key=<key>&tools=basic` lists 11 tools (about 2,500 tokens of
definitions; the full list is 31 tools, about 8,500) and sends shorter instructions.

| Tool | What it does |
| --- | --- |
| `plan_next` | Where the plan stands and the one call to make now, arguments filled in. Called after every step. |
| `plan_trace` | A draft from the uploaded drawing: calibrate against the printed outside size, find the house on the sheet, find and fit walls (duplicates and uncertain ones dropped, listed), mark the facade, read openings and doors. Returns what it did, what needs judgement, one picture. Stops with a request for `dimensions` when it cannot calibrate safely (a wrong scale makes every wall wrong). |
| `plan_audit` | The plan against the drawing, as numbered findings with stable ids (`wall:w3`, `door:o4`, `opening:o2`, `plan:outer-size`): walls off their drawn position or thickness (measured on the result, so a slightly skewed drawing does not make noise), openings on solid wall, door swing, outside size against the printed one, review and permit checks. |
| `plan_fix` | `apply` finding ids (or `"alla"`) or `set` simple changes: move/resize/delete a wall, add a wall, set an opening's offset, width, kind and swing, add or rename a room. One revision, then what remains. |
| `plan_view` | One picture: plan over the drawing, the drawing alone, or the sheet; `rect` zooms (the grid is in mm). |
| `plan_create`, `plan_list`, `plan_upload_link`, `plan_get`, `plan_finish`, `plan_guide` | As before. |

The full connector has these too, next to the scan tools, so a large model can mix them.

## 2. Small answers

- `plan_edit`: the new revision, what changed (by id), the findings that are new, no picture
  unless `image: true`. The ops reference moved out of its description into `plan_guide {"topic":"ops"}`.
- `plan_get`: `only: ["walls", …]` for parts, `since: <revision>` for what changed; no picture then.
- A review/rework round with `plan_audit` and `plan_fix` is a short list in, a short list out.

## 3. Measuring: `npm run eval:agent`

```
ANTHROPIC_API_KEY=… npx tsx scripts/eval-agent.mts --model claude-haiku-5-5 --profile basic
ANTHROPIC_API_KEY=… npx tsx scripts/eval-agent.mts --model claude-sonnet-5-5 --profile full
npx tsx scripts/eval-agent.mts --dry          # scripted stand-in: checks the harness without an API
```

It creates a plan, adds the cellar drawing as a source (what the upload page does), tells the
model "I have uploaded a source drawing to the plan, make a plan of it", and lets it call the
tools in a loop (in this process, local store, nothing deployed). Then it scores the plan
against what the drawing prints (outside size 6,08 × 10,50 m, two windows) and prints tool
calls, errors, tokens, seconds, open audit findings and the sheet's title block. The whole
conversation is written to `.visual/eval-<model>-<profile>.md`; add `--price-in/--price-out`
(USD per million tokens) for a cost.

The key is read from the environment only (put it in the session's environment settings,
never in chat) and is not written anywhere. Run each setting a few times: one run is anecdote.
Use it to decide whether a change to the tools helped, not to guess.

### What to expect, honestly

`plan_trace` is a draft, and measured as one. On the hand-drawn, stretched cellar scan it cannot find
the house on the sheet by itself (it says so and asks for the dimension end points instead of
tracing at a wrong scale). With them, one call gave 12 walls (4 marked exterior), 3 doors and 7
"windows" (the drawing has 2: false finds are left for the user to delete), an outside size of
6534 × 10522 mm against the printed 6080 × 10500 (the east wall was found in pieces only, so
the south wall runs past it), and `plan_audit` then found nothing more it could mend on the walls.
So the length of the cellar came out right and the width did not; a model still has to look
at the picture, add the missing east wall (`plan_fix add_wall`, which the audit then fits) and
delete the extra windows. On clean drawings the draft should be closer; that is what
`eval:agent` is for. The scan tools remain the way to exact results on difficult drawings.
