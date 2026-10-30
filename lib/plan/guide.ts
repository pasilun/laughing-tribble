// How to make a plan that can be trusted. Sent to every Claude that connects
// (MCP initialize instructions) and returned in full by plan_guide.

export const INSTRUCTIONS = `Planstudio draws floor plans (planritningar) for building permit applications. A plan is only as good as the drawing it was traced from.
1. Draw what the drawing shows (the existing state). Do not suggest or make changes, demolition or a new layout unless the user asks for one.
2. If the user mentions or has attached a drawing or photo, the first step is plan_create and then plan_upload_link: you cannot pass a chat attachment to a tool, so the user opens the link and picks the file. Draw nothing until the source exists.
3. Call plan_guide for the working order (calibrate against the dimensions printed on the drawing, trace walls, openings, fixtures and rooms with the scan tools, compare the render with the source, run plan_review and plan_check and fix every finding, fill in the title block, pick a scale that fills the sheet).
4. If another connector also offers plan tools (an older copy of this one), draw with this connector's plan tools only; other tools such as email or documents are fine to use. Report what is measured and what is estimated.`

export const GUIDE = `WORKING ORDER FOR A PLAN TRACED FROM A DRAWING

0. What was asked
   - "Make a plan of this drawing" means: draw what the drawing shows, as it is today (före, phase "existing"). Do not suggest, plan or draw changes, demolition or a new layout unless the user asks. A change is a later, separate step (walls with phase "demolish" or "new" in the same plan) and only on request.
   - Draw with this connector's plan tools. If another plan connector with the same kind of tools is also available (an older copy), do not use it for the plan; other tools (email, documents, calendar…) are fine whenever they help.

1. Get the drawing into the plan
   - plan_create (or plan_list to continue one), then plan_upload_link straight away, before drawing anything. Give the link to the user: they open it and pick the file (PNG, JPG, TIF or PDF; at most about 4 MB) – you cannot pass a chat attachment to a tool. Wait for them to say it is uploaded. Do not draw walls from the picture in the chat first: that gives positions that have to be redone.
   - Read the plan again (plan_get) and look at the source with plan_scan_view before measuring anything.
   - If there is no drawing, say so and mark every dimension as estimated. Do not present an estimate as a measurement.

2. Calibrate
   - Find dimensions printed on the drawing (overall lengths, a scale bar, a door width) and call plan_scan_calibrate with at least two, one in each direction. Check the residual: more than ~30 mm means a misread number or a skewed scan.

3. Trace the walls
   - plan_scan_detect_walls, then plan_scan_snap_walls; correct by hand with plan_edit. Walls are centre lines with a thickness per wall (measure it; do not give every wall the same one). Mark exterior and loadBearing walls. Keep joints exact: a wall that ends in another wall stops at its centre line.
   - A sloping or kinked wall is several walls or a mass, not one straight line.

4. Openings, fixtures, rooms
   - plan_scan_openings and plan_scan_doors for doors and hinge/swing; windows from facade drawings (plan_scan_elevation) or the plan symbol. Read hinge and swing from the drawing, do not guess.
   - Fixtures from the symbols on the drawing (stairs, WC, sink, stove, shower, balcony, shaft…) with real sizes. Stairs are drawn, not only named.
   - Rooms with the names the drawing uses and the flat each belongs to.

5. Compare
   - plan_get with with_underlay shows the plan over the source. Fix every difference larger than about 50 mm. Look at the sheet as a person would: labels clear of walls and each other, nothing cut off.

6. Review and check
   - plan_review (access, doors, rooms, joints, structure) and plan_check (what the permit sheet needs). Resolve every error; for each remaining warning say why it stays.

7. Finish
   - Call plan_finish: it sets the largest scale where the plan fills the sheet, adds the overall dimension lines, runs plan_review and plan_check and lists what is left. Fix what it lists (or say why it stays). Ask the user for the title block fields it names (fastighetsbeteckning, adress, lägenhet, ritad av) in ONE question, then set them with setTitleBlock. Never fill them with guesses.
   - A plan with nothing marked as demolished or new is a record of what exists: one sheet, titled "befintlig".

8. Say what you did
   - List what is measured from the drawing, what is estimated, what you could not read, and what the user should check on site. Do not give legal or structural assessments: that is for the municipality and the structural engineer.
`
