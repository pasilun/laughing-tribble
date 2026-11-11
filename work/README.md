# work/: building the plan app with scheduled runs

Cards and rules for the work described in `docs/v2-engine-plan.md` (the plan from here) and `docs/mcp-contract.md` (the connector contract). The earlier Rust work has its own cards on the branch `auto/v2-build`, in `v2/cards/`; that work is finished or dropped.

| What | Where |
|---|---|
| The plan, in order | `docs/v2-engine-plan.md` §4 |
| What the connector must be | `docs/mcp-contract.md` |
| What building v1 taught us | `docs/mcp-design-evidence.md` |
| Rules for whoever implements a card | `work/CLAUDE.md` |
| How a scheduled run works | `work/RUNNER.md` |
| The cards | `work/cards/` |
| Run logs | `work/runs/` |

Card ids: `S2-01` is card 1 of step 2 of the plan (the connector contract), `S3-…` is step 3 (walls on faces), and so on. A `-R` card is a reviewer checkpoint; a `-fN` card is a fix a checkpoint asked for.
