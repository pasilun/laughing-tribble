---
id: F-R1
title: "Checkpoint: walls on faces, step 1 (F-01…F-03)"
tier: R
status: done
depends: [F-01, F-02, F-03]
spec: ["docs/v2-engine-plan.md §3", "spikes/face-walls/README.md", "work/CLAUDE.md"]
attempts: 0
---
Review the commits of F-01…F-03 against `docs/v2-engine-plan.md` §3 and `work/CLAUDE.md`. Report each failure as one line with file:line.

Check:
1. **Existing plans unchanged.** `centreLines` returns the same object for a plan without `ref`. Every existing test passes, and no existing test or fixture was edited.
2. **Every reader goes through the view.** List every exported function in `lib/` that reads `wall.a`, `wall.b` or `wall.thickness` and is reached from a route, the connector or the old MCP tools, and say for each whether it reads the view (directly or through a caller that already applied it) or the stored line. Name every one that reads the stored line and draws, measures or checks a wall's body: each is a defect or belongs in the list of the 32 places for step 2.
3. **Writers refuse.** Every path that writes wall geometry or openings computed from the drawing refuses a plan with face-referenced walls (the scan tools, `trace`, `candidates`, and anything else found in 2). Try each on a running app with a plan holding one face-referenced wall.
4. **The editor.** Open a plan with a face-referenced wall in the editor (`components/plan-editor/`): is it drawn where the sheet draws it? Can it be selected, moved and deleted? Report what goes wrong; the editor is not in this batch, so each problem becomes a card for a later batch, not a fix here.
5. **The list of the 32 places.** Write it into the checkpoint's report as file:line with one line each on what the place assumes (a body centred on the stored line), sorted into: sheet and export, rooms and checks, scan readers, editor. This list is the input for the next batch (step 2 of the move).

Each defect becomes a card `F-R1-fN` (tier H, status ready, empty depends), written with the exact file and line and an authorisation for every existing test it must edit, quoted from the file as it is now.
