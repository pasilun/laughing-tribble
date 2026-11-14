---
id: F-R1-f5
title: "Refusal names the connector action"
tier: H
status: done
depends: []
spec: ["work/cards/F-R1.md (defect 5)"]
files: [lib/plan/scan/tools.ts, lib/plan/connector/handlers/scan.ts, lib/plan/connector/handlers/source.ts]
attempts: 0
---
Do: through the connector, the face-wall refusal in `lib/plan/scan/tools.ts` (line ~29) has its tool name rewritten by `lib/plan/connector/wording.ts` (line ~17), so `missing_walls` says "ett av verktygen hanterar…" and others say "scan hanterar…". Make the connector handlers (`handlers/scan.ts`, `handlers/source.ts`) produce the refusal with the action name in it, the way `handlers/candidates.ts` (line ~151) does: `action "<name>"`. The refusal text must contain the action name (e.g. `missing_walls`). Do not change `wording.ts`.

Done when: `e2e/connector-faces-scan.spec.ts` still passes unchanged, and it also passes a new assertion (add one test to a new file `e2e/connector-faces-refusal.spec.ts`) that the refusal for `missing_walls` on a face plan contains the text `missing_walls`. Run `npm run typecheck && npm run lint && CI=1 npx playwright test e2e/connector-faces-scan.spec.ts e2e/connector-faces-refusal.spec.ts --reporter=line`; all must pass.
