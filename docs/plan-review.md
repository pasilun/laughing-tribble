# Reviewing a plan like an architect

A traced or generated plan can match every line on a scan and still be
nonsense as a building: a flat with no front door, a WC that opens into the
kitchen, a gap in a load-bearing wall that is really a smudge. This is the
checklist for judging a plan before it is shown to anyone. Part of it is
computed (`plan_review`, codes in brackets); the rest is reasoning, done the
same way every time.

## How to review

1. Run `plan_review` (and `plan_check`). Read the per-flat summary first:
   rooms, and which opening is the entrance.
2. Walk each flat on the drawing: stair hall → front door → tambur → every
   room. Say out loud what each door is for. A door you can't explain is a
   finding even if no rule fired.
3. Look at the structure: which walls carry, whether they run through, what
   happens at every hole in them.
4. For every finding, decide which it is:
   - **modelling error**: the sources don't support it (scan gap read as a
     door, a wall stopping short, wrong flat number). Fix it, citing the
     source that shows the right answer.
   - **real oddity**: the sources show it (an owner's opening between flats,
     an old WC without a hall). Keep it and note the source.
   - **unknown**: the sources disagree or are silent. Don't guess; list it
     as a question.
5. Never fix a finding by making the rule go quiet (renaming a room, moving a
   label). Fix the building or keep the finding.

## The flat (automated)

- One entrance per flat from the stair hall or another common space
  [`no-entrance`, `entrances`], into a tambur/hall, not straight into a room
  [`entrance-room`], at least 800 mm [`entrance-width`].
- No door between two flats [`between-flats`] unless they are known to be
  joined (then it is a real oddity: say which document shows it).
- Every room reachable from the entrance [`unreachable`], not only through a
  bathroom [`through-wet`]; every room has a door [`no-door`].
- A door joins two different spaces [`same-space`], neither of them a wall
  [`leads-nowhere`], the outside [`leads-outside`] or an unnamed pocket
  [`unnamed-space`]. Under 500 mm (400 for a closet) it is no door: a scan
  gap or a niche [`too-narrow`]. Interior doors under 600 mm are noted
  [`door-width`].
- Sealed pockets without door or name are shafts, flues, or a room that lost
  its door [`sealed`].

## Rooms (automated)

- WC/bath: one door [`wet-doors`], never straight off a kitchen
  [`wc-to-kitchen`], preferably from the tambur/hall [`wc-from-room`], and the
  door opens outward so it can't be blocked by someone fallen inside and
  doesn't take floor space [`wc-door-inward`].
- A door doesn't swing into a closet or any space too small for its leaf;
  it swings into the larger room [`door-into-small`]. A closet (G, klk) has
  one door [`closet-doors`].
- Habitable rooms (Rum, Matvrå, Kök) have a window [`no-window`]; a kitchen
  nook (Kv, Kokvrå) has a window or a vent.

Room names are read by `roomKind`: Tamb/Tmb/Hall = entry, WC/Bad/Dusch =
wet, Kök/Kokvrå/Kv = kitchen, G/Garderob/Klk = closet, Rum/Matvrå/Sov… =
habitable, Trapphus/Trapphall = common. Rooms need `apartment` set for the
flat checks.

## Structure (reasoning; automation to come)

The buildings here are Stockholm blocks of flats from the 1930s
(lamellhus): brick or lightweight-concrete walls, concrete floor slabs.

- **What carries:** the outer walls; one or two long spine walls along the
  middle of the block (each side of the corridor of tamburer and closets);
  the stairwell walls; the party/fire walls between stair sections. Cross
  walls between rooms usually don't carry, but walls between flats are
  thick for sound and fire (≥ ~120 mm brick plus plaster, or a double
  wall), never a 70 mm partition.
- **Spine walls run through.** A spine wall stops at the stairwell or
  the gable, not in the middle of a flat. Its holes are door-sized (≤ ~1 m)
  with a lintel; a wider gap needs a beam drawn or documented, or it is a
  tracing error. A spine wall's thickness doesn't change randomly along its
  length.
- **Walls meet walls.** A wall ends at another wall, an opening jamb, or
  is deliberately free-standing (a pier, a short screen); a stub ending in
  mid-air is suspect. Joints are flush: no notches, no corners sticking out,
  no thickness steps at a joint unless the drawing shows one.
- **Floors stack.** Load-bearing walls, chimneys and vent flues, and
  bath/kitchen stacks sit in the same place on every floor; a bathroom away
  from its stack (typbadrum lists) is wrong or a documented relocation.
- **Masonry masses** (stairwell walls, chimney breasts) are solid, not
  rooms; doors don't open into them.

## Sources and their weight

- The newest official document for a part wins over older ones for that
  part (relationshandling 2000 over the 1999 survey over 1936), but an
  older drawing explains what a newer one only shows schematically.
- A clean redraw (e.g. the 2010 bygglov plan) is good for topology
  (which room is where, which walls are solid), poor for dimensions.
- A gap in a scanned line is evidence of an opening only when another
  source agrees, or the opening makes sense for the room (see above).
- Owner measurements and photos describe today; archive-only plans must not
  use them.

## Corrections that became rules

Each of these was caught by the user and is now a check or a test:

| caught | rule |
| --- | --- |
| doors opening into very small spaces | `door-into-small` |
| toilets must open out | `wc-door-inward` |
| a scan gap imported as a door, rooms joined across flats | `too-narrow`, `between-flats` |
| flats with no front door, two front doors | `no-entrance`, `entrances` |
| notch by the G, corner sticking out, wall-thickness step | structure: walls meet flush (to automate) |
| funnel-shaped stair wall overlapping the stair | structure: masses are solid, walls don't overlap them |
| a new opening from the owner's "after" drawing imported as existing | sources: phase from the document's date |
