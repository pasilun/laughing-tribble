---
id: F-R1-f7
title: "Editor hit-testing and face snapping read the view"
tier: H
status: blocked
depends: []
spec: ["work/cards/F-R1.md (check 4, editor)"]
files: [components/plan-editor/Canvas.tsx, components/plan-editor/snap.ts]
attempts: 0
---
Reviewer found (F-R1 checkpoint): selection uses the stored line (`Canvas.tsx:258`), so a click hits only part of a face wall's true body; face snapping uses `snap.ts:36,87`; drawing a wall stores a centre line and drops the face it was traced from (`Canvas.tsx:178`, `snap.ts:197`). Blocked for the spec run: the design of how a drawn wall keeps its face is open and the card is written for the later batch.
