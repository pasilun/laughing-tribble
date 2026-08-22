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

## Visual verification

Geometry and rendering changes MUST be validated visually before claiming done:

1. Run `npm run visual` — boots the dev server, renders every fixture from
   `fixtures/cases/*.json` on `/review/<case>` (deterministic: fixed viewport,
   no orbit damping), waits for the app's own `data-render-state="complete"`
   handshake, and writes screenshots to `.visual/actual/<case>/`
   (`plan.png`, `iso-3d.png`, `page.png`) plus `.visual/manifest.json`.
2. **Actually read the PNGs** (they are images — look at them) and compare each
   against the case's `description` field. Check orientation (N up in plan),
   opening positions/sides, roof shape, proportions.
3. A case passes only when its render state was `complete`, its screenshots
   match the description, and no console errors appear for it in the manifest.

Fixtures are the single source of truth for visual cases. When a spec changes
geometry intentionally, update the fixture description in the same change.
