//! Areas and spaces (spec §9.5).
//!
//! A room's area is its solved width times depth: east − west on x and
//! south − north on y. It is stored as exact mm² ([`Mm2`]). [`format_m2`]
//! gives the m² text with 2 decimals for display. A space is a connected
//! component of rooms joined by an `open` relation ([`Gap::Open`]), and its
//! area is the sum of its rooms' areas.

use std::collections::{BTreeMap, BTreeSet, VecDeque};

use super::faces::Coords;
use crate::intent::{Gap, Plan, Relation, RoomName};
use crate::solve::FaceKey;

/// An area in mm² (`i64`). Stored data is exact; never a float.
pub type Mm2 = i64;

/// Side indices used by the solver's map keys: north 0, east 1, south 2, west 3.
const NORTH: u8 = 0;
const EAST: u8 = 1;
const SOUTH: u8 = 2;
const WEST: u8 = 3;

/// A space: rooms joined by `open`, with the sum of their areas.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Space {
    /// The rooms of the space, sorted by name.
    pub rooms: Vec<RoomName>,
    /// Sum of the rooms' areas in mm².
    pub area: Mm2,
}

/// The exact area in mm² of every room whose four faces have solved
/// coordinates, in name order. Rooms without a solved face are left out.
pub fn room_areas(plan: &Plan, coords: &Coords) -> BTreeMap<RoomName, Mm2> {
    plan.rooms
        .keys()
        .filter_map(|room| room_area(room, coords).map(|area| (room.clone(), area)))
        .collect()
}

/// One room's area, or `None` when a face it needs has no coordinate or the
/// product overflows.
fn room_area(room: &RoomName, coords: &Coords) -> Option<Mm2> {
    let west = *coords.x.get(&key(room, WEST))?;
    let east = *coords.x.get(&key(room, EAST))?;
    let north = *coords.y.get(&key(room, NORTH))?;
    let south = *coords.y.get(&key(room, SOUTH))?;
    (east - west).checked_mul(south - north)
}

/// The spaces of `plan`: each connected component of two or more rooms joined
/// by an `open` relation, in name order (a space is named by its first room).
///
/// Rooms that are not joined by `open` are not listed. A room of a space with
/// no entry in `areas` (no solved coordinates) adds nothing to the sum.
pub fn spaces(plan: &Plan, areas: &BTreeMap<RoomName, Mm2>) -> Vec<Space> {
    let mut adj: BTreeMap<&RoomName, Vec<&RoomName>> = BTreeMap::new();
    for relation in &plan.relations {
        let Some((a, b)) = open_pair(relation) else {
            continue;
        };
        if !plan.rooms.contains_key(a) || !plan.rooms.contains_key(b) {
            continue;
        }
        adj.entry(a).or_default().push(b);
        adj.entry(b).or_default().push(a);
    }

    let mut seen: BTreeSet<&RoomName> = BTreeSet::new();
    let mut out = Vec::new();
    for start in plan.rooms.keys() {
        if seen.contains(start) {
            continue;
        }
        seen.insert(start);
        let mut queue = VecDeque::from([start]);
        let mut rooms = Vec::new();
        while let Some(room) = queue.pop_front() {
            rooms.push(room.clone());
            for next in adj.get(room).into_iter().flatten().copied() {
                if seen.insert(next) {
                    queue.push_back(next);
                }
            }
        }
        if rooms.len() < 2 {
            continue;
        }
        rooms.sort();
        let area = rooms
            .iter()
            .filter_map(|room| areas.get(room))
            .fold(0, |acc: Mm2, area| acc.saturating_add(*area));
        out.push(Space { rooms, area });
    }
    out
}

/// The two rooms of a placement relation whose gap is `open`.
fn open_pair(relation: &Relation) -> Option<(&RoomName, &RoomName)> {
    match relation {
        Relation::EastOf {
            subject,
            of,
            gap: Gap::Open,
        }
        | Relation::WestOf {
            subject,
            of,
            gap: Gap::Open,
        }
        | Relation::SouthOf {
            subject,
            of,
            gap: Gap::Open,
        }
        | Relation::NorthOf {
            subject,
            of,
            gap: Gap::Open,
        } => Some((subject, of)),
        _ => None,
    }
}

/// The map key of one face of `room`.
fn key(room: &RoomName, side: u8) -> FaceKey {
    (room.clone(), side)
}

/// An area in hundredths of m² (centi-m²), rounded to 2 decimals.
///
/// Rounds half to even on the centi-m² value: 1 m² is 10⁶ mm², so one
/// centi-m² is 10⁴ mm². A remainder of exactly half a centi-m² rounds to the
/// even neighbour.
pub fn centi_m2(area: Mm2) -> i64 {
    let magnitude = area.unsigned_abs();
    let whole = magnitude / 10_000;
    let rest = magnitude % 10_000;
    let up = rest * 2 > 10_000 || (rest * 2 == 10_000 && whole % 2 == 1);
    let rounded = (whole + u64::from(up)) as i64;
    if area < 0 { -rounded } else { rounded }
}

/// The area in m² with 2 decimals, for display, e.g. `4.39`.
pub fn format_m2(area: Mm2) -> String {
    let centi = centi_m2(area);
    let sign = if centi < 0 { "-" } else { "" };
    let abs = centi.unsigned_abs();
    format!("{sign}{}.{:02}", abs / 100, abs % 100)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dsl::parse;
    use crate::intent::Plan;
    use crate::solve::{Axis, assign_coords, components, edges};

    const FIXTURE_A: &str = include_str!("../../../../fixtures/lgh154-a.plan");

    fn name(text: &str) -> RoomName {
        RoomName::new(text).expect("valid room name")
    }

    /// Solve both axes the way the solver does and gather the coordinates.
    fn solved(plan: &Plan) -> Coords {
        let (edge_list, _) = edges(plan);
        let mut out = Coords::default();
        for (axis, target) in [(Axis::X, &mut out.x), (Axis::Y, &mut out.y)] {
            let (comps, _) = components(&edge_list, plan, axis);
            let (coord, _) = assign_coords(&edge_list, &comps, axis);
            *target = coord;
        }
        out
    }

    #[test]
    fn fixture_a_room_areas_match_spec() {
        let plan = parse(FIXTURE_A).expect("fixture A parses");
        let areas = room_areas(&plan, &solved(&plan));
        let want = [
            ("Garderob", 4_389_600, "4.39"),
            ("Sovrum", 3_887_400, "3.89"),
            ("Hall", 1_224_300, "1.22"),
            ("WC", 2_346_300, "2.35"),
            ("Vardagsrum", 12_388_800, "12.39"),
        ];
        assert_eq!(areas.len(), want.len());
        for (room, mm2, text) in want {
            let got = areas.get(&name(room)).copied();
            assert_eq!(got, Some(mm2), "{room} mm2");
            assert_eq!(format_m2(mm2), text, "{room} m2");
        }
    }

    #[test]
    fn fixture_a_space_hall_and_vardagsrum() {
        let plan = parse(FIXTURE_A).expect("fixture A parses");
        let areas = room_areas(&plan, &solved(&plan));
        let found = spaces(&plan, &areas);
        assert_eq!(
            found,
            vec![Space {
                rooms: vec![name("Hall"), name("Vardagsrum")],
                area: 13_613_100,
            }]
        );
        assert_eq!(format_m2(found[0].area), "13.61");
    }

    #[test]
    fn open_joined_rooms_form_one_space() {
        // A and B are joined by open; C is joined to B by a wall and is not in the space.
        let plan = parse(
            "room A 1000 x 2000\nroom B 1000 x 2000\n  east_of A open\nroom C 1000 x 2000\n  east_of B gap 90\n",
        )
        .expect("parse");
        let areas = room_areas(&plan, &solved(&plan));
        assert_eq!(areas.get(&name("C")).copied(), Some(2_000_000));
        let found = spaces(&plan, &areas);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].rooms, vec![name("A"), name("B")]);
        assert_eq!(found[0].area, 4_000_000);
    }

    #[test]
    fn centi_m2_rounds_half_to_even() {
        assert_eq!(centi_m2(4_389_600), 439);
        assert_eq!(centi_m2(14_999), 1);
        assert_eq!(centi_m2(5_000), 0);
        assert_eq!(centi_m2(15_000), 2);
        assert_eq!(centi_m2(25_000), 2);
        assert_eq!(centi_m2(25_001), 3);
        assert_eq!(format_m2(0), "0.00");
    }
}
