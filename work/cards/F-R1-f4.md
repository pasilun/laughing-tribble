---
id: F-R1-f4
title: "Audit quotes the stored opening offset"
tier: H
status: ready
depends: []
spec: ["work/cards/F-R1.md (defect 4)"]
files: [lib/plan/assist/audit.ts, e2e/faces-audit.spec.ts]
attempts: 0
---
Do: `lib/plan/assist/audit.ts` line ~95, the opening message quotes the offset of the centre-line view. Take the offset from the input plan's opening instead (the stored one), so the message matches what the user will find in the file. Do not change anything else in that file.

Done when: in `e2e/faces-audit.spec.ts` (the file created by F-R1-f1; add one test, do not change the F-R1-f1 test), a pure spec on a face plan whose a-end moved in the view shows the stored offset in the opening message. Run `npm run typecheck && npm run lint` and `CI=1 npx playwright test e2e/faces-audit.spec.ts --reporter=line`; both must pass.
