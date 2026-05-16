# Agent Instructions

This repo is an autonomous AI dev loop. To avoid drift, instructions live in
**one** place each — do not duplicate them here:

- **Loop contract** (your rules, protected paths, invariants, tooling,
  stack, commands): [`CLAUDE.md`](./CLAUDE.md)
- **Product domain** (what the app is, glossary, what's parked):
  [`docs/product-context.md`](./docs/product-context.md)
- **Knowledge base** (deeper product/regulatory notes, indexed):
  [`docs/wiki/`](./docs/wiki/index.md)
- **Spec authoring rules**: `agents/spec/system-prompt.md`
- **How the loop runs end-to-end**: [`README.md`](./README.md)

Read `CLAUDE.md` first. It is authoritative; if anything elsewhere conflicts
with it, `CLAUDE.md` wins.
