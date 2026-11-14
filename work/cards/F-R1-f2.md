---
id: F-R1-f2
title: "finishPlan measures the envelope on the view"
tier: H
status: in_progress
depends: []
spec: ["work/cards/F-R1.md (defect 2)", "docs/v2-engine-plan.md §3 (Walls on faces)"]
files: [lib/plan/assist/finish.ts, e2e/faces.spec.ts]
attempts: 0
---
Do: in `lib/plan/assist/finish.ts`, `envelope` (around line 55) builds the outer box from `wallQuad` of the stored line. Make it read `centreLines(plan)` (import from `@/lib/plan/domain/faces` style relative path per neighbouring code). Only `envelope` changes; `fitOuter` gets the same view through its caller. Add ONE new test at the end of `e2e/faces.spec.ts` (do not change existing tests): a plan with a 4000×3000 mm room whose walls are face-referenced on the inner faces with 300 mm thickness yields the outer dimension "4600 × 3600" from `finishPlan`. The existing finish specs must pass unchanged.

Done when: `npm run typecheck && npm run lint` pass and `CI=1 npx playwright test e2e/faces.spec.ts e2e/connector-finish.spec.ts --reporter=line` passes (if `e2e/connector-finish.spec.ts` does not exist, run the finish-related specs found with `grep -l finish e2e/*.spec.ts`, and say which).
