---
id: F-R1-f3
title: "comparePlans and the compare check read the view"
tier: H
status: in_progress
depends: []
spec: ["work/cards/F-R1.md (defect 3)", "docs/v2-engine-plan.md §3 (Walls on faces)"]
files: [lib/plan/assist/compare.ts, lib/plan/connector/checks/index.ts, e2e/faces-compare.spec.ts]
attempts: 0
---
Do: `comparePlans` in `lib/plan/assist/compare.ts` (lines ~23, ~79-93) measures from the stored line. Apply `centreLines` to both plans at the top of `comparePlans`. In `lib/plan/connector/checks/index.ts` line ~52, pass `centreLines(plan)` to `describeRef` so walls are named from the view. A plan with no face-referenced wall is unchanged.

New pure spec `e2e/faces-compare.spec.ts` (no browser, imports from `@/lib/...`): comparing the lgh154-face fixture (`e2e/fixtures/faces/lgh154-face.json`) with its own `centreLines` view reports 0 mm difference for every wall.

Done when: `npm run typecheck && npm run lint` pass and `CI=1 npx playwright test e2e/faces-compare.spec.ts --reporter=line` passes.
