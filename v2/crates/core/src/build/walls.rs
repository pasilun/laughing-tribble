//! Wall segments per room face (spec §9.2 steps 1–2, pseudo-code §5.3).
//!
//! For every room face, in room order then north, east, south, west, the span
//! is split at the span ends of the faces that face it (§9.1), and each piece is
//! classified as an interior wall, an open stretch (no wall) or an outer wall.
//! Steps 3–7 of §9.2 (bridge, extend, corner continuation, merge, deduplicate)
//! run later on this list and are not done here.

use crate::intent::{FaceRef, Gap, Plan, Relation, RoomName, Side};
use crate::solve::FaceKey;
use crate::units::{Mm, Source};

use super::faces::{Coords, FacingPair, facing_faces};

/// Sides in the order used for every listing: north, east, south, west.
const SIDES: [Side; 4] = [Side::North, Side::East, Side::South, Side::West];

/// The kind of a wall segment (§9.2 step 2).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SegmentKind {
    /// A wall between this room and the facing room across the gap.
    Interior,
    /// Not covered by a facing face: an outer wall whose inner face is the room
    /// face, growing outward.
    Outer,
    /// Covered by a facing face through `Gap::Open`: no wall is drawn.
    Open,
}

/// One piece of a room face's span, classified (§9.2 steps 1–2).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WallSegment {
    /// The room face the segment was generated from.
    pub face: FaceRef,
    /// Start along the span in mm: the west end on a north or south face, the
    /// north end on an east or west face.
    pub start: Mm,
    /// End along the span in mm, always above `start`.
    pub end: Mm,
    /// Interior, outer or open.
    pub kind: SegmentKind,
    /// Wall thickness in mm; `None` for `Open`.
    pub thickness: Option<Mm>,
    /// Where the thickness comes from; `None` for `Open`.
    pub source: Option<Source>,
    /// The facing face that covers the segment, if any. When several cover it,
    /// the first in `facing_faces` order is taken.
    pub covered_by: Option<FaceRef>,
    /// `true` when the interior thickness is derived from the distance between
    /// the faces because no explicit relation gives one (the I010 marker).
    pub derived: bool,
}

/// Wall segments for every room face of `plan`, using the solved `coords`.
///
/// Order: room order (`plan.order`), then north, east, south, west, then `start`.
/// Rooms or faces without a solved coordinate are skipped. Pure: no I/O.
pub fn wall_segments(plan: &Plan, coords: &Coords) -> Vec<WallSegment> {
    let pairs = facing_faces(plan, coords);
    let mut out = Vec::new();
    for room in &plan.order {
        if !plan.rooms.contains_key(room) {
            continue;
        }
        for side in SIDES {
            let Some((start, end)) = span(room, side, coords) else {
                continue;
            };
            let face = FaceRef {
                room: room.clone(),
                side,
            };
            let facing = facing_of(&pairs, &face, coords);
            let mut cuts = vec![start, end];
            for neighbour in &facing {
                for cut in [neighbour.span.0, neighbour.span.1] {
                    if start < cut && cut < end {
                        cuts.push(cut);
                    }
                }
            }
            cuts.sort_unstable();
            cuts.dedup();
            for window in cuts.windows(2) {
                if let &[from, to] = window {
                    out.push(classify(plan, &face, (from, to), &facing));
                }
            }
        }
    }
    out
}

/// A facing face of a room face, with its span along the room face's axis.
struct Neighbour {
    face: FaceRef,
    distance: Mm,
    span: (Mm, Mm),
}

/// The faces that face `face` (the pairs whose `first` is `face`), in the
/// order `facing_faces` returns them.
fn facing_of(pairs: &[FacingPair], face: &FaceRef, coords: &Coords) -> Vec<Neighbour> {
    pairs
        .iter()
        .filter(|pair| pair.first == *face)
        .filter_map(|pair| {
            let span = span(&pair.second.room, pair.second.side, coords)?;
            Some(Neighbour {
                face: pair.second.clone(),
                distance: pair.distance,
                span,
            })
        })
        .collect()
}

/// Classify the piece `[from, to]` of `face` (§9.2 step 2).
fn classify(
    plan: &Plan,
    face: &FaceRef,
    (from, to): (Mm, Mm),
    facing: &[Neighbour],
) -> WallSegment {
    let segment = |kind, thickness, source, covered_by, derived| WallSegment {
        face: face.clone(),
        start: from,
        end: to,
        kind,
        thickness,
        source,
        covered_by,
        derived,
    };
    let Some(cover) = facing
        .iter()
        .find(|neighbour| neighbour.span.0 <= from && to <= neighbour.span.1)
    else {
        let (thickness, source) = outer_thickness(plan, face);
        return segment(
            SegmentKind::Outer,
            Some(thickness),
            Some(source),
            None,
            false,
        );
    };
    let covered = Some(cover.face.clone());
    match relation_gap(plan, face, &cover.face) {
        Some(Gap::Open) => segment(SegmentKind::Open, None, None, covered, false),
        Some(Gap::Wall(q)) => segment(
            SegmentKind::Interior,
            Some(q.value),
            Some(q.source),
            covered,
            false,
        ),
        None => segment(
            SegmentKind::Interior,
            Some(cover.distance),
            Some(Source::Assumed),
            covered,
            true,
        ),
    }
}

/// Thickness and source of the outer wall on `face`: a `WallOverride` on that
/// face if there is one, else `default_outer_wall`.
fn outer_thickness(plan: &Plan, face: &FaceRef) -> (Mm, Source) {
    match plan.wall_overrides.iter().find(|o| o.face == *face) {
        Some(o) => (o.thickness.value, o.thickness.source),
        None => (
            plan.default_outer_wall.value,
            plan.default_outer_wall.source,
        ),
    }
}

/// The gap of the placement relation that joins faces `a` and `b`, if any.
/// The relation is looked up in either order. `Align` relations give no gap.
fn relation_gap<'a>(plan: &'a Plan, a: &FaceRef, b: &FaceRef) -> Option<&'a Gap> {
    plan.relations.iter().find_map(|relation| {
        let (x, y, gap) = match relation {
            Relation::EastOf { subject, of, gap } => {
                (face_of(subject, Side::West), face_of(of, Side::East), gap)
            }
            Relation::WestOf { subject, of, gap } => {
                (face_of(subject, Side::East), face_of(of, Side::West), gap)
            }
            Relation::SouthOf { subject, of, gap } => {
                (face_of(subject, Side::North), face_of(of, Side::South), gap)
            }
            Relation::NorthOf { subject, of, gap } => {
                (face_of(subject, Side::South), face_of(of, Side::North), gap)
            }
            Relation::Align { .. } => return None,
        };
        ((x == *a && y == *b) || (x == *b && y == *a)).then_some(gap)
    })
}

/// The face of `room` on `side`.
fn face_of(room: &RoomName, side: Side) -> FaceRef {
    FaceRef {
        room: room.clone(),
        side,
    }
}

/// The span of a room face along its axis, as `(min, max)`, or `None` when a
/// coordinate it needs is missing. Mirrors the span rule in `faces.rs`: an east
/// or west face spans the room's north to south edge on y, a north or south
/// face spans its west to east edge on x.
fn span(room: &RoomName, side: Side, coords: &Coords) -> Option<(Mm, Mm)> {
    let (own, other, ends) = match side {
        Side::East | Side::West => (&coords.x, &coords.y, [Side::North, Side::South]),
        Side::North | Side::South => (&coords.y, &coords.x, [Side::West, Side::East]),
    };
    own.get(&face_key(room, side))?;
    let a = *other.get(&face_key(room, ends[0]))?;
    let b = *other.get(&face_key(room, ends[1]))?;
    Some((a.min(b), a.max(b)))
}

/// The map key of a room face, using the same side index as the solver.
pub(super) fn face_key(room: &RoomName, side: Side) -> FaceKey {
    let index: u8 = match side {
        Side::North => 0,
        Side::East => 1,
        Side::South => 2,
        Side::West => 3,
    };
    (room.clone(), index)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dsl::parse;
    use crate::solve::{Axis, Edge, assign_coords, components, edges};

    const FIXTURE_A: &str = include_str!("../../../../fixtures/lgh154-a.plan");

    /// Solve one axis the way `tree.rs` does: edges, components, coordinates.
    fn solve_axis(
        plan: &Plan,
        edge_list: &[Edge],
        axis: Axis,
    ) -> std::collections::BTreeMap<FaceKey, Mm> {
        let (comps, _) = components(edge_list, plan, axis);
        let (coord, _) = assign_coords(edge_list, &comps, axis);
        coord
    }

    /// Solved coordinates of both axes for `plan`.
    fn solved(plan: &Plan) -> Coords {
        let (edge_list, _) = edges(plan);
        Coords {
            x: solve_axis(plan, &edge_list, Axis::X),
            y: solve_axis(plan, &edge_list, Axis::Y),
        }
    }

    fn at(room: &str, side: Side) -> FaceRef {
        FaceRef {
            room: RoomName::new(room).expect("valid room name"),
            side,
        }
    }

    /// An interior segment; `thickness` is (mm, source).
    fn interior(
        room: (&str, Side),
        span: (Mm, Mm),
        cover: (&str, Side),
        thickness: (Mm, Source),
        derived: bool,
    ) -> WallSegment {
        WallSegment {
            face: at(room.0, room.1),
            start: span.0,
            end: span.1,
            kind: SegmentKind::Interior,
            thickness: Some(thickness.0),
            source: Some(thickness.1),
            covered_by: Some(at(cover.0, cover.1)),
            derived,
        }
    }

    /// A segment with no wall, covered through `Gap::Open`.
    fn open(room: (&str, Side), span: (Mm, Mm), cover: (&str, Side)) -> WallSegment {
        WallSegment {
            face: at(room.0, room.1),
            start: span.0,
            end: span.1,
            kind: SegmentKind::Open,
            thickness: None,
            source: None,
            covered_by: Some(at(cover.0, cover.1)),
            derived: false,
        }
    }

    /// An outer wall; `thickness` is (mm, source).
    fn outer(room: (&str, Side), span: (Mm, Mm), thickness: (Mm, Source)) -> WallSegment {
        WallSegment {
            face: at(room.0, room.1),
            start: span.0,
            end: span.1,
            kind: SegmentKind::Outer,
            thickness: Some(thickness.0),
            source: Some(thickness.1),
            covered_by: None,
            derived: false,
        }
    }

    /// The thickness and source of the explicit `Gap::Wall` between two faces.
    fn explicit(plan: &Plan, a: (&str, Side), b: (&str, Side)) -> Option<(Mm, Source)> {
        match relation_gap(plan, &at(a.0, a.1), &at(b.0, b.1))? {
            Gap::Wall(q) => Some((q.value, q.source)),
            Gap::Open => None,
        }
    }

    #[test]
    fn fixture_a_segments_match_hand_list() {
        let plan = parse(FIXTURE_A).expect("fixture A parses");
        let coords = solved(&plan);
        // Outer walls: no WallOverride is given for fixture A, so the default applies.
        let d = (
            plan.default_outer_wall.value,
            plan.default_outer_wall.source,
        );
        let rel = |a, b| explicit(&plan, a, b).expect("explicit wall relation");
        let g_hall = rel(("Garderob", Side::East), ("Hall", Side::West));
        let g_sov = rel(("Garderob", Side::South), ("Sovrum", Side::North));
        let hall_wc = rel(("Hall", Side::East), ("WC", Side::West));
        let wc_vard = rel(("WC", Side::South), ("Vardagsrum", Side::North));
        let derived = (121, Source::Assumed);
        let want = vec![
            // Garderob: north outer; east split at Hall (explicit) and Vardagsrum
            // (derived); south explicit to Sovrum; west outer.
            outer(("Garderob", Side::North), (0, 1860), d),
            interior(
                ("Garderob", Side::East),
                (0, 1113),
                ("Hall", Side::West),
                g_hall,
                false,
            ),
            interior(
                ("Garderob", Side::East),
                (1113, 2360),
                ("Vardagsrum", Side::West),
                derived,
                true,
            ),
            interior(
                ("Garderob", Side::South),
                (0, 1860),
                ("Sovrum", Side::North),
                g_sov,
                false,
            ),
            outer(("Garderob", Side::West), (0, 2360), d),
            // Sovrum.
            interior(
                ("Sovrum", Side::North),
                (0, 1860),
                ("Garderob", Side::South),
                g_sov,
                false,
            ),
            interior(
                ("Sovrum", Side::East),
                (2450, 4540),
                ("Vardagsrum", Side::West),
                derived,
                true,
            ),
            outer(("Sovrum", Side::South), (0, 1860), d),
            outer(("Sovrum", Side::West), (2450, 4540), d),
            // Hall: north outer; east explicit to WC then a 123 mm outer stub;
            // south open to Vardagsrum; west explicit to Garderob.
            outer(("Hall", Side::North), (1981, 3081), d),
            interior(
                ("Hall", Side::East),
                (0, 990),
                ("WC", Side::West),
                hall_wc,
                false,
            ),
            outer(("Hall", Side::East), (990, 1113), d),
            open(
                ("Hall", Side::South),
                (1981, 3081),
                ("Vardagsrum", Side::North),
            ),
            interior(
                ("Hall", Side::West),
                (0, 1113),
                ("Garderob", Side::East),
                g_hall,
                false,
            ),
            // WC: north and east outer; south explicit to Vardagsrum; west to Hall.
            outer(("WC", Side::North), (3171, 5541), d),
            outer(("WC", Side::East), (0, 990), d),
            interior(
                ("WC", Side::South),
                (3171, 5541),
                ("Vardagsrum", Side::North),
                wc_vard,
                false,
            ),
            interior(
                ("WC", Side::West),
                (0, 990),
                ("Hall", Side::East),
                hall_wc,
                false,
            ),
            // Vardagsrum: north open to Hall, a 90 mm outer piece, then explicit
            // to WC; east, south outer; west derived to Garderob and Sovrum with
            // outer pieces between and below.
            open(
                ("Vardagsrum", Side::North),
                (1981, 3081),
                ("Hall", Side::South),
            ),
            outer(("Vardagsrum", Side::North), (3081, 3171), d),
            interior(
                ("Vardagsrum", Side::North),
                (3171, 5541),
                ("WC", Side::South),
                wc_vard,
                false,
            ),
            outer(("Vardagsrum", Side::East), (1113, 4593), d),
            outer(("Vardagsrum", Side::South), (1981, 5541), d),
            interior(
                ("Vardagsrum", Side::West),
                (1113, 2360),
                ("Garderob", Side::East),
                derived,
                true,
            ),
            outer(("Vardagsrum", Side::West), (2360, 2450), d),
            interior(
                ("Vardagsrum", Side::West),
                (2450, 4540),
                ("Sovrum", Side::East),
                derived,
                true,
            ),
            outer(("Vardagsrum", Side::West), (4540, 4593), d),
        ];
        assert_eq!(wall_segments(&plan, &coords), want);
    }

    #[test]
    fn face_with_no_facing_neighbour_is_all_outer() {
        let plan = parse("room A 1000 x 2000\n").expect("parse");
        let coords = solved(&plan);
        let d = (
            plan.default_outer_wall.value,
            plan.default_outer_wall.source,
        );
        let want = vec![
            outer(("A", Side::North), (0, 1000), d),
            outer(("A", Side::East), (0, 2000), d),
            outer(("A", Side::South), (0, 1000), d),
            outer(("A", Side::West), (0, 2000), d),
        ];
        assert_eq!(wall_segments(&plan, &coords), want);
    }

    #[test]
    fn open_gap_gives_no_wall() {
        let plan =
            parse("room A 1000 x 2000\nroom B 1000 x 2000\n  east_of A open\n").expect("parse");
        let coords = solved(&plan);
        let d = (
            plan.default_outer_wall.value,
            plan.default_outer_wall.source,
        );
        let want = vec![
            outer(("A", Side::North), (0, 1000), d),
            open(("A", Side::East), (0, 2000), ("B", Side::West)),
            outer(("A", Side::South), (0, 1000), d),
            outer(("A", Side::West), (0, 2000), d),
            outer(("B", Side::North), (1000, 2000), d),
            outer(("B", Side::East), (0, 2000), d),
            outer(("B", Side::South), (1000, 2000), d),
            open(("B", Side::West), (0, 2000), ("A", Side::East)),
        ];
        assert_eq!(wall_segments(&plan, &coords), want);
    }
}
