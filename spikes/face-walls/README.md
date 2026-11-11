# Spike: walls stored on a face (2026-11-11)

Question: can v1 keep its code and still store a wall on one of its faces, so that a thickness change keeps that face where it is?

**What was tried.** A wall gets an optional `ref: 'left' | 'right'`: the stored line `a → b` is that face, and the body lies on the other side. No `ref` means the stored line is the centre line, as today. `centred.ts` turns a plan with such walls into the centre-line plan the rest of v1 reads:

- each wall is moved by half its thickness;
- where two walls' stored ends coincide (an L corner), both centre lines are run to their meeting point;
- where a wall's stored end lies on another wall's stored line (a T), the end is run to that wall's centre line;
- an opening's offset grows by the length its wall's a-end was moved, so the opening stays where it was drawn.

Nothing in `lib/` was changed. The view is given to v1's own `validatePlan`, `checkPlan`, `roomAreas` and `renderSheet`.

**Results** (`npx tsx spikes/face-walls/run.ts spikes/face-walls/lgh154-face.json OUT`, lgh 154 with every wall stored on a room face):

| Check | Result |
|---|---|
| `validatePlan` | no errors |
| `checkPlan` (apart from the empty title block) | no findings |
| Room areas | Garderob 4.390, Hall 1.224, Sovrum 3.887, Vardagsrum 12.389, WC 2.346 m²: the same as the centre-line plan |
| Sheet | drawn normally; outer corners close properly (the centre-line plan made from rectangles had seams) |
| South wall of Sovrum 300 → 200 mm, face-referenced | inner face stays at y 4540, outer face moves 4840 → 4740; Sovrum stays 3.887 m². One field changed |
| The same change on the centre-line plan | both faces move 50 mm (4590 and 4790); Sovrum becomes 3.980 m² |
| A face wall meeting a centre-line wall, and a wall at 45° (`mixed.ts`) | the ends meet at one point in both cases |

**Found on the way**
- A wall with an odd thickness (121 mm) has its centre line on a half millimetre; the view rounds it (1920.5 → 1921), so the drawn body sits 0.5 mm off. Either the view keeps half millimetres or the body is computed from the face directly.
- v1's editor already converts a traced face to a centre line when a wall is drawn (`faceToCenter` and `centerCorner` in `components/plan-editor/snap.ts`) and then forgets which face it was. The model change is to keep it.

**Not tested**
- The editor: drawing, hit-testing and dragging with face-referenced walls (2 of the 32 places that assume a centred body are in the editor).
- The scan readers working on the view and writing results back to stored walls.
- Walls that meet at a shallow angle, and three or more walls at one point.
