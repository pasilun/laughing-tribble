# plan-server

## What it is

`plan-mcp` is a Planstudio MCP server over stdio. It offers five tools: `check` (diagnostics and next steps for a plan), `get` (read a plan as summary, DSL text or solved JSON), `apply` (change a plan with a DSL patch, all or nothing), `render` (a PNG of the plan with its ids labelled) and `export` (a print-ready PDF sheet, written to `<root>/exports/<plan_id>.pdf`; the result gives the path, paper and scale). Plans are `.plan` files under `--root`, one file per plan, named `<plan_id>.plan`.

Example `export` call (arguments): `{"plan_id": "lgh154-a", "format": "pdf", "paper": "a3", "scale": 25}`. `paper` and `scale` are optional (a3 and the first standard scale that fits). The plan must have no errors; run `check` first.

## Build

```sh
cd v2 && cargo build --release -p plan-server
```

## Add to Claude Code

```sh
claude mcp add planstudio -- /ABSOLUTE/PATH/v2/target/release/plan-mcp --root /ABSOLUTE/PATH/plans
```

## Try it

Ask Claude: "check plan lgh154-a and tell me what to measure next".
