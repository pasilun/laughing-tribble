// How to make a plan that can be trusted. Sent to every Claude that connects
// (MCP initialize instructions) and returned in full by plan_guide.

export const INSTRUCTIONS = `Planstudio draws floor plans (planritningar) for building permit applications. A plan is only as good as the drawing it was traced from.
Never draw from sight alone. Call plan_guide first: it gives the working order (get the drawing into the plan with plan_upload_link, calibrate it against stated dimensions, trace walls, openings, fixtures and rooms with the scan tools, compare the render with the source, run plan_review and plan_check and fix every finding, fill in the title block, pick a scale that fills the sheet).
You cannot pass a chat attachment to a tool: ask the user to open the link from plan_upload_link and drop the file there. Report what is measured and what is estimated.`

export const GUIDE = `WORKING ORDER FOR A PLAN TRACED FROM A DRAWING

1. Get the drawing into the plan
   - plan_create (or plan_list to continue one), then plan_upload_link. Give the link to the user: they open it and drop the file (PNG, JPG, TIF or PDF; at most about 4 MB) – you cannot pass a chat attachment to a tool. Ask for the drawing's scale (e.g. 1:100) and year.
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

7. Sheet
   - Fill in the title block (fastighetsbeteckning, adress, lägenhet, ritad av, ritningsnummer, datum). Choose the largest scale that fits the paper (setSheet; the fit check names it). Overall dimensions and dimensions for new or removed openings are drawn.

8. Say what you did
   - List what is measured from the drawing, what is estimated, what you could not read, and what the user should check on site. Do not give legal or structural assessments: that is for the municipality and the structural engineer.
`
