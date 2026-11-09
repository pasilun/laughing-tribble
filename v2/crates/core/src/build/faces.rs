//! Facing faces (spec §9.1, pseudo-code §5.3).
//!
//! Two room faces face each other when they are on opposite sides, the second
//! lies on the outward side of the first, the distance between them is 0–600
//! mm, and their spans overlap by more than 0 mm. The finder is pure: it reads
//! the solved coordinates and the room list, and returns the pairs.

use std::collections::BTreeMap;

use crate::intent::{FaceRef, Plan, RoomName, Side};
use crate::solve::FaceKey;
use crate::units::Mm;

/// The largest distance in mm between two faces that still face each other.
pub const MAX_FACING_DISTANCE: Mm = 600;

/// Sides in the order used for every listing: north, east, south, west.
const SIDES: [Side; 4] = [Side::North, Side::East, Side::South, Side::West];

/// The solved coordinates of room faces, as produced by `assign_coords` on
/// each axis. `x` holds the east and west faces, `y` the north and south faces.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Coords {
    /// Coordinate on x of each east and west face.
    pub x: BTreeMap<FaceKey, Mm>,
    /// Coordinate on y of each north and south face.
    pub y: BTreeMap<FaceKey, Mm>,
}

/// Two room faces that face each other (§9.1).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FacingPair {
    /// The face the search started from.
    pub first: FaceRef,
    /// The face on the outward side of `first`, on the opposite side.
    pub second: FaceRef,
    /// Distance between the two faces in mm, from 0 to 600.
    pub distance: Mm,
    /// Length in mm of the overlap of the two spans, always above 0.
    pub overlap: Mm,
}

/// Every pair of facing faces in `plan`, using the solved `coords`.
///
/// Each face is tried as `first` against every other face, so a pair appears
/// once for each direction (the outward rule is directional). Order: `first` by
/// room order (`plan.order`) then side north, east, south, west; then `second`
/// by the same order. Rooms or faces without a solved coordinate, or whose
/// span end is missing, are skipped. Pure: no I/O.
pub fn facing_faces(plan: &Plan, coords: &Coords) -> Vec<FacingPair> {
    let faces = faces(plan, coords);
    let mut out = Vec::new();
    for first in &faces {
        for second in &faces {
            if let Some(pair) = facing(first, second) {
                out.push(pair);
            }
        }
    }
    out
}

/// A face with its coordinate and the span of the room along the other axis.
struct Face {
    room: RoomName,
    side: Side,
    coord: Mm,
    span: (Mm, Mm),
}

/// Every face with a solved coordinate and span, in room then side order.
fn faces(plan: &Plan, coords: &Coords) -> Vec<Face> {
    let mut out = Vec::new();
    for room in &plan.order {
        if !plan.rooms.contains_key(room) {
            continue;
        }
        for side in SIDES {
            if let Some(face) = face(room, side, coords) {
                out.push(face);
            }
        }
    }
    out
}

/// One face of `room`, or `None` when a coordinate it needs is missing.
///
/// An east or west face spans from the room's north edge to its south edge on
/// y; a north or south face spans from its west edge to its east edge on x.
fn face(room: &RoomName, side: Side, coords: &Coords) -> Option<Face> {
    let (own, other, ends) = match side {
        Side::East | Side::West => (&coords.x, &coords.y, [Side::North, Side::South]),
        Side::North | Side::South => (&coords.y, &coords.x, [Side::West, Side::East]),
    };
    let coord = *own.get(&face_key(room, side))?;
    let a = *other.get(&face_key(room, ends[0]))?;
    let b = *other.get(&face_key(room, ends[1]))?;
    Some(Face {
        room: room.clone(),
        side,
        coord,
        span: (a.min(b), a.max(b)),
    })
}

/// The pair `(first, second)` if the four conditions of §9.1 hold.
fn facing(first: &Face, second: &Face) -> Option<FacingPair> {
    if second.side != opposite(first.side) {
        return None;
    }
    // Distance measured from `first` toward its outward side. A negative value
    // means `second` lies inward of `first`, which fails the range check.
    let distance = match first.side {
        Side::East | Side::South => second.coord - first.coord,
        Side::West | Side::North => first.coord - second.coord,
    };
    if !(0..=MAX_FACING_DISTANCE).contains(&distance) {
        return None;
    }
    let overlap = first.span.1.min(second.span.1) - first.span.0.max(second.span.0);
    if overlap <= 0 {
        return None;
    }
    Some(FacingPair {
        first: FaceRef {
            room: first.room.clone(),
            side: first.side,
        },
        second: FaceRef {
            room: second.room.clone(),
            side: second.side,
        },
        distance,
        overlap,
    })
}

/// The side facing `side` across the gap.
fn opposite(side: Side) -> Side {
    match side {
        Side::North => Side::South,
        Side::East => Side::West,
        Side::South => Side::North,
        Side::West => Side::East,
    }
}

/// The map key of a room face, using the same side index as the solver.
fn face_key(room: &RoomName, side: Side) -> FaceKey {
    let index = match side {
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
    fn solve_axis(plan: &Plan, edge_list: &[Edge], axis: Axis) -> BTreeMap<FaceKey, Mm> {
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

    fn face_ref(room: &str, side: Side) -> FaceRef {
        FaceRef {
            room: RoomName::new(room).expect("valid room name"),
            side,
        }
    }

    fn pair(first: (&str, Side), second: (&str, Side), distance: Mm, overlap: Mm) -> FacingPair {
        FacingPair {
            first: face_ref(first.0, first.1),
            second: face_ref(second.0, second.1),
            distance,
            overlap,
        }
    }

    #[test]
    fn fixture_a_facing_pairs_match_expected_list() {
        let plan = parse(FIXTURE_A).expect("fixture A parses");
        let coords = solved(&plan);
        let want = vec![
            // Garderob (east, south) with its neighbours, in both directions.
            pair(("Garderob", Side::East), ("Hall", Side::West), 121, 1113),
            pair(
                ("Garderob", Side::East),
                ("Vardagsrum", Side::West),
                121,
                1247,
            ),
            pair(("Garderob", Side::South), ("Sovrum", Side::North), 90, 1860),
            // Sovrum.
            pair(("Sovrum", Side::North), ("Garderob", Side::South), 90, 1860),
            pair(
                ("Sovrum", Side::East),
                ("Vardagsrum", Side::West),
                121,
                2090,
            ),
            // Hall: east to WC, south to Vardagsrum (open, distance 0), west to Garderob.
            pair(("Hall", Side::East), ("WC", Side::West), 90, 990),
            pair(("Hall", Side::South), ("Vardagsrum", Side::North), 0, 1100),
            pair(("Hall", Side::West), ("Garderob", Side::East), 121, 1113),
            // WC.
            pair(("WC", Side::South), ("Vardagsrum", Side::North), 123, 2370),
            pair(("WC", Side::West), ("Hall", Side::East), 90, 990),
            // Vardagsrum.
            pair(("Vardagsrum", Side::North), ("Hall", Side::South), 0, 1100),
            pair(("Vardagsrum", Side::North), ("WC", Side::South), 123, 2370),
            pair(
                ("Vardagsrum", Side::West),
                ("Garderob", Side::East),
                121,
                1247,
            ),
            pair(
                ("Vardagsrum", Side::West),
                ("Sovrum", Side::East),
                121,
                2090,
            ),
        ];
        assert_eq!(facing_faces(&plan, &coords), want);
    }

    #[test]
    fn faces_700_mm_apart_do_not_face() {
        // A.east is at 1000, B.west at 1700: 700 mm apart, beyond the 600 mm limit.
        let plan =
            parse("room A 1000 x 2000\nroom B 1000 x 2000\n  east_of A gap 700\n").expect("parse");
        let coords = solved(&plan);
        assert_eq!(
            coords
                .x
                .get(&face_key(&RoomName::new("B").expect("name"), Side::West)),
            Some(&1700)
        );
        assert!(facing_faces(&plan, &coords).is_empty());
    }

    #[test]
    fn faces_600_mm_apart_face_both_ways() {
        // The limit is inclusive: 600 mm faces, and the pair is listed from both faces.
        let plan =
            parse("room A 1000 x 2000\nroom B 1000 x 2000\n  east_of A gap 600\n").expect("parse");
        let coords = solved(&plan);
        let want = vec![
            pair(("A", Side::East), ("B", Side::West), 600, 2000),
            pair(("B", Side::West), ("A", Side::East), 600, 2000),
        ];
        assert_eq!(facing_faces(&plan, &coords), want);
    }

    #[test]
    fn faces_with_no_span_overlap_do_not_face() {
        // B sits 100 mm east of A and 100 mm south of it, so both gaps are
        // within 600 mm, but A.east and B.west span different y ranges, and
        // A.south and B.north span different x ranges.
        let plan = parse(
            "room A 1000 x 2000\nroom B 1000 x 2000\n  east_of A gap 100\n  south_of A gap 100\n",
        )
        .expect("parse");
        let coords = solved(&plan);
        assert!(facing_faces(&plan, &coords).is_empty());
    }
}
