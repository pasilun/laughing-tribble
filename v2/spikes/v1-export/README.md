# Spike: a v2 solution written as a v1 plan (2026-11-11)

`conv.py PLAN_BINARY FILE.plan OUT.json` runs `plan svg` and `plan solve --json`, and writes a v1 `Plan` (the type in `lib/plan/domain/types.ts`): walls as centre lines with a thickness, openings with an offset along their wall, rooms with a label point and a rectangle.

Result for `fixtures/lgh154-a.plan`: 15 walls, 4 openings, 5 rooms. v1's `validatePlan` returns no errors, `renderSheet` draws a normal A3 permit sheet, and v1's room areas equal v2's to the mm² (Garderob 4 389 600, Hall 1 224 300, Sovrum 3 887 400, Vardagsrum 12 388 800, WC 2 346 300).

It is a throwaway script that reads the SVG text. The real exporter belongs in Rust (`docs/v2-engine-plan.md`, step 1).
