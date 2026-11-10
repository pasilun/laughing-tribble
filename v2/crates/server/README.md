# plan-server

## What it is

`plan-mcp` is a Planstudio MCP server over stdio. It offers four tools: `check` (diagnostics and next steps for a plan), `get` (read a plan as summary, DSL text or solved JSON), `apply` (change a plan with a DSL patch, all or nothing) and `render` (a PNG of the plan with its ids labelled). Plans are `.plan` files under `--root`, one file per plan, named `<plan_id>.plan`.

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
