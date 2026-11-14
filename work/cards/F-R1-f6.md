---
id: F-R1-f6
title: "Editor canvas draws face walls on the view"
tier: H
status: blocked
depends: []
spec: ["work/cards/F-R1.md (check 4, editor)"]
files: [components/plan-editor/Canvas.tsx]
attempts: 0
---
Reviewer found (F-R1 checkpoint): `Canvas.tsx:463` takes `wallPieces(plan, view)` from the stored plan, so face walls are drawn half a thickness away from the sheet; lines 532 and 541-547 do the same for selection and openings. Fix: draw `centreLines(plan)`. Blocked for the spec run: it needs a browser check against the sheet, and the card is written for the later batch the reviewer asked for.
