---
id: F-R1-f1
title: "Audit wall fixes refuse face-referenced walls"
tier: H
status: done
depends: []
spec: ["work/cards/F-R1.md (defect 1)", "docs/v2-engine-plan.md §3 (Walls on faces)"]
files: [lib/plan/assist/audit.ts, e2e/faces-audit.spec.ts]
attempts: 0
---
Do: `lib/plan/assist/audit.ts` computes wall fixes (`update {a,b,thickness}`) on the centre-line view (line ~39), but `plan_fix` and the connector check `audit` write them into the stored wall, which half a thickness off for a face-referenced wall. Keep the input plan. When `hasFaceWalls(input)` is true, leave `fix` off every `wall:` item and say in that item's text why (Swedish, e.g. "Väggen är kopplad till en rumsyta; ändra den för hand"). Door and opening fixes stay as they are. A plan with no face-referenced wall is unchanged.

Done when: `e2e/faces-audit.spec.ts` (new, pure, no browser, imports from `@/lib/...`) shows that no `wall:` item carries `fix` for the lgh154-face fixture (`e2e/fixtures/faces/lgh154-face.json`), and `npm run typecheck && npm run lint` pass. Run the spec with `CI=1 npx playwright test e2e/faces-audit.spec.ts --reporter=line`.
