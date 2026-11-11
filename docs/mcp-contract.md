# Planstudio connector contract (version 1)

Written 2026-11-11. This is the contract between Claude and Planstudio: the list of MCP tools and the shape of every call and answer. It is meant to stay fixed while everything behind it changes.

It replaces the current connector (37 tools, `/api/mcp`). Breaking today's clients is accepted; after this change they should not need to register again. Smaller models may do worse with these general tools than with many specific ones; that is accepted for now and can be improved later inside the contract (through the guide, the answers and the engine), not by adding tools.

Evidence behind the choices: `docs/mcp-design-evidence.md` (on `main`).

## 1. The rule

**A tool's schema never names anything the engine can add.**

- The **connector layer** owns the tool list, sign-in, the outer shape of each call and answer, and how a result is packed for Claude.
- The **engine** owns every rule about plans: which operations, views, checks, scan readers and export formats exist, what is valid, what the findings are, and what to do next.

Where does a thing belong? If it changes when we learn something about drawing plans, it is the engine's and must not appear in a schema. If it changes when the MCP protocol or a client changes, it is the connector layer's.

"Engine" here means everything under the connector: `lib/plan/service.ts`, the domain, the scan code, storage, and the measurement kernel. How that is divided is free to change.

## 2. The ten tools

The names are bare verbs with no prefix: the same tools serve floor plans, site plans and any later kind, and clients already qualify a tool with the connector's name. Each description opens with "Planstudio:" so a tool is recognisable where a client shows the bare name.

The list is fixed. So are the names, the fields in the table, and the three hints (read-only, destructive, idempotent), because clients store them when the connector is added and use them for permission prompts. That is also why reading and writing are separate tools.

| Tool | Reads or writes | Fixed fields | Open slot (the engine's vocabulary) |
|---|---|---|---|
| `guide` | reads | `topic?` | topics |
| `list` | reads | `what?`, `plan_id?`, `query?`, `limit?`, `cursor?` | what can be listed |
| `get` | reads | `plan_id`, `parts?`, `since?`, `format?` | parts, formats |
| `check` | reads | `plan_id`, `scope?`, `against?` | check families |
| `view` | reads | `plan_id`, `view?`, `region?`, `max_tokens?`, `options?` | views, options |
| `scan` | reads | `plan_id`, `action`, `args?`, `max_tokens?` | scan actions |
| `edit` | writes | `plan_id`, `base_revision`, `ops`, `dry_run?`, `message?`, `image?` | operations |
| `source` | writes | `plan_id`, `base_revision?`, `action`, `args?`, `dry_run?` | source actions |
| `manage` | writes, can remove | `action`, `plan_id?`, `args?` | manage actions |
| `export` | writes a file or link | `plan_id`, `format`, `options?` | formats, options |

What each is for:

- **`guide`**: how to work, and the engine's current vocabulary with examples. With no topic it returns the working order and the list of topics.
- **`list`**: the person's plans, and for one plan its revisions, shares and tags. Site plans are plans of another kind and are listed here too.
- **`get`**: a plan's content, whole or in parts, or only what changed since a revision.
- **`check`**: everything that is wrong or unfinished, and the next call to make. It gathers what today's `plan_check`, `plan_review`, `plan_audit`, `plan_next`, `plan_finish` and `plan_compare` do.
- **`view`**: one picture: the plan, the plan over a source drawing, a source alone, a sheet, a diagnostic view.
- **`scan`**: reading a source drawing without changing the plan: find walls, read openings and doors, measure a profile, propose a trace. Proposals come back as operations for `edit`.
- **`edit`**: every change to a plan's content, as a list of operations applied all-or-nothing against a known revision.
- **`source`**: getting a drawing in and placing it: an upload link, add, calibrate, straighten, register.
- **`manage`**: create, copy, rename, tag, share, trash and restore.
- **`export`**: the sheets as PDF, PNG, SVG or DXF, and a link to open the plan.

## 3. Field shapes

Fixed fields are typed in the schema. Open slots are typed only as far as this table says; the engine checks the rest and answers with a finding when something is unknown.

| Field | Schema | Meaning |
|---|---|---|
| `plan_id` | string | The plan. Its kind (floor plan, site plan) follows from the id |
| `base_revision` | integer | The revision the caller last read. A stale one is refused (§5, `stale-revision`) |
| `ops` | array of objects, each with a required string `op`; other properties free | The operations. The schema lists no operation names and no operation fields |
| `action` | string | Which action. The schema lists none |
| `args` | object, properties free | The action's arguments |
| `view`, `format`, `topic`, `what` | string | A name from the engine's vocabulary |
| `parts`, `scope` | array of strings | Names from the engine's vocabulary |
| `options` | object, properties free | Named options of a view or format |
| `region` | `{ "id": string }` or `{ "rect_mm": [x, y, w, h] }` | Zoom to an element or a rectangle in plan mm |
| `against` | object, properties free | What to compare with (another plan, a printed size, a source) |
| `since` | integer | Only what changed after this revision |
| `max_tokens` | integer | Size budget for a picture. Default 1600 |
| `dry_run` | boolean | Work everything out, save nothing |
| `image` | boolean | Return a picture with the answer. Default false |
| `message` | string | The revision note |
| `query`, `limit`, `cursor` | string, integer, string | Search and paging |

A tool's **description** is part of the contract too. It says what the tool is for in two or three sentences, gives at most three examples that will never be withdrawn, and points to `guide` for the rest. It never lists the vocabulary.

## 4. Answers

Every answer has a short text for Claude to read and the same structured object:

```jsonc
{
  "ok": true,                    // false: nothing was saved
  "contract": 1,                 // this document's version
  "engine": "2026.11.2",         // the engine's version, for bug reports and guides
  "plan_id": "…",
  "revision": 31,                // the plan's revision after the call
  "changed": [ { "kind": "wall", "id": "v12", "what": "moved 114 mm south" } ],
  "findings": [ /* §5 */ ],
  "next": [ /* §6 */ ],
  "data": { }                    // the tool's own result; its content is the engine's
}
```

- Keys are never removed or renamed. A key that does not apply is left out.
- Pictures are separate image blocks after the text. Their scale and origin are in `data.image` (`mm_per_px`, `origin_mm`, `size_px`).
- `changed` and `findings` carry only what is new since the caller's revision, unless asked otherwise.

## 5. Findings and errors

One shape for everything the engine has to say: a refused call, a broken rule, a conflict between measurements, a missing title-block entry, an uncertain scan reading.

```jsonc
{
  "id": "wall:v12:thickness",    // stable for this plan while the cause remains
  "code": "E003",                // stable for ever; new causes get new codes
  "level": "error",              // error | warning | info
  "message": "…",                // names things by position as well as by id
  "refs": ["v12", "Sovrum.south"],
  "fix": [ { "op": "…" } ],      // optional: operations that mend it
  "data": { }                    // numbers behind the message
}
```

- A call that cannot be carried out is a normal answer with `ok: false`, `isError: true` and its findings. It is never a protocol error.
- An unknown operation, action, view, part, format or topic is a finding with the code `unknown-name`, the valid names, and the nearest match. This is how a session learns vocabulary it has never seen.
- A stale `base_revision` is a finding with the code `stale-revision` and the current revision.

## 6. Next steps

`next` is the engine telling Claude what to do, as calls ready to make:

```jsonc
{ "tool": "edit", "arguments": { "plan_id": "…", "base_revision": 31, "ops": [ … ] }, "why": "…" }
```

A session can therefore use an operation it has never heard of. `check` always returns `next`; the other tools return it when there is something to say.

## 7. What may change, and how

| Change | Allowed? |
|---|---|
| A new operation, action, view, part, check, format, topic or finding code | Yes, at any time. It appears in `guide` the same day |
| A new optional field inside an operation or `args` | Yes |
| Renaming an operation or action | The old name stays as an alias for good |
| A new optional fixed field on a tool | Only with a new contract version, and old calls must still work |
| A new tool | Only for a new *kind of interaction* that none of the ten can carry (for example a job that runs for minutes and is polled). Not for a new capability |
| Removing or renaming a tool or a fixed field, or changing a hint | No. That is a new connector at a new address |
| Changing what a finding code means | No. New meaning, new code |

## 8. How the contract is kept

1. **A frozen tool list.** One test compares the published tool names, schemas, descriptions and hints with a file in the repo. Any difference fails the build, so the list cannot change by accident.
2. **The guide is generated.** Operations, actions, views, parts, checks and formats are held in registries in the engine. `guide` is written from those registries, and a test fails if the engine accepts a name the guide does not list.
3. **One function per tool.** The connector layer is an adapter from a tool call to one of ten engine functions with the same fields, each returning the answer of §4. It holds no rules, no defaults that depend on a plan, and no text about plans.
4. **Two versions in every answer.** `contract` changes only by §7; `engine` changes with every release.
5. **Golden conversations.** A few recorded sessions (a measured flat, a traced cellar) are replayed against each engine release; the calls must still be accepted.

## 9. Where today's tools go

| Today | In the contract |
|---|---|
| `plan_guide` | `guide` |
| `plan_list`, `plan_revisions`, `site_list` | `list` |
| `plan_get`, `site_get`, `plan_openings_report` | `get` (parts) |
| `plan_check`, `plan_review`, `plan_audit`, `plan_next`, `plan_compare`, the checking half of `plan_finish` | `check` (scope, against) |
| `plan_view`, `plan_scan_view` | `view` (views) |
| `plan_scan_detect_walls`, `plan_scan_missing_walls`, `plan_scan_openings`, `plan_scan_doors`, `plan_scan_elevation`, `plan_scan_profile`, `plan_scan_diff`, the reading half of `plan_trace` | `scan` (actions) |
| `plan_edit`, `site_edit`, `plan_fix`, `plan_scan_snap_walls`, the fitting half of `plan_finish`, the writing half of `plan_trace` | `edit` (operations; a finding is applied with an operation that names its id) |
| `plan_upload_link`, `plan_source_add`, `plan_scan_calibrate`, `plan_scan_dimension`, `plan_scan_register` | `source` (actions) |
| `plan_create`, `site_create`, `plan_import`, `plan_tags`, the share tools, `doc_trash` | `manage` (actions) |
| The sheet and file links returned by several tools | `export` |

## 10. Not part of the contract

These are the engine's and are described by `guide`, not here:

- the operations and their fields, including the planned measurement operations (a clear distance between two named faces; moving a wall face while the other stays) and compass words for hinges and swings;
- the names of views, parts, scan actions, checks and formats;
- the wording of messages and the working order;
- which part of the engine does what: TypeScript domain, scan code, measurement kernel.

## 11. Open points

- **Site plans** are folded in as a kind of plan. If their operations turn out to share nothing with floor plans, they still fit: the vocabulary is per kind, and `guide` says which applies.
- **Server instructions** (the text a client reads when the connector is added) are stored by clients like the tool list. They should be three lines that will not age: call `guide` first, call `check` after each step and follow `next`, never take a measurement from a picture.
- **Runtime tool-list updates.** MCP has a notification for a changed tool list, but which clients act on it is not verified. The contract assumes none do.
- **Untested:** how well models work with open operation lists and named actions compared with today's typed tools. `npm run eval:agent` can measure it once it runs with a real key.
