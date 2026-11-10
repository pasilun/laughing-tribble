//! Fixtures in the resolved model (spec §9.3, §5.3, §15 D44).
//!
//! A fixture is a rectangle standing against a room face. It is addressed like
//! an opening: `at` runs along the face from its west end (north and south
//! faces) or north end (east and west faces), `offset` is the distance out from
//! the face into the room and `depth` is the size out from the face. A balcony
//! is the one kind that lies outside the room: it starts at the outer side of
//! the wall on its face. Ids are `F:<Room>.<side>:<n>`, numbered per face by
//! `at`, then by kind word.
//!
//! A fixture other than a balcony must lie inside its room (touching the faces
//! is inside). A balcony is only checked along its face. Otherwise the fixture
//! is E019 and is left out. A fixture whose room has no rectangle is skipped
//! without a diagnostic.

use std::collections::BTreeMap;

use serde_json::json;

use crate::diagnostics::{Code, Diagnostic, Severity, message};
use crate::intent::{FaceRef, Fixture, FixtureKind, Plan, RoomName, Side};
use crate::resolved::{ResolvedFixture, RoomRect};
use crate::units::Mm;

use super::merge::BuiltWall;

/// Place every fixture of `plan` (§9.3, D44).
///
/// `rooms` are the solved rectangles in mm (x east, y south) and `walls` are the
/// walls from [`built_walls`](super::merge::built_walls) for the same plan. A
/// balcony's offset from the room is the thickness of the wall on its face at
/// its start. Returns the placed fixtures by id, and one E019 diagnostic per
/// fixture that runs outside its room (those fixtures are left out).
pub fn place_fixtures(
    plan: &Plan,
    rooms: &BTreeMap<RoomName, RoomRect>,
    walls: &[BuiltWall],
) -> (BTreeMap<String, ResolvedFixture>, Vec<Diagnostic>) {
    let mut placed = BTreeMap::new();
    let mut diagnostics = Vec::new();
    for (index, id) in number_fixtures(plan) {
        let fixture = &plan.fixtures[index];
        let Some(room) = rooms.get(&fixture.face.room) else {
            continue;
        };
        let balcony = fixture.kind == FixtureKind::Balcony;
        let (lo, hi) = face_span(fixture.face.side, room);
        let a0 = lo + fixture.at;
        let a1 = a0 + fixture.width;
        let (x, y) = rectangle(fixture, room, walls, (a0, a1));
        let inside = if balcony {
            a0 >= lo && a1 <= hi
        } else {
            x.0 >= room.west && x.1 <= room.east && y.0 >= room.north && y.1 <= room.south
        };
        if !inside {
            diagnostics.push(outside_error(fixture, &id, &fixture.face.room, x, y));
            continue;
        }
        placed.insert(
            id.clone(),
            ResolvedFixture {
                id,
                kind: fixture.kind,
                face: fixture.face.clone(),
                x,
                y,
                label: fixture.label.clone(),
                phase: fixture.phase,
            },
        );
    }
    (placed, diagnostics)
}

/// The rectangle `(x, y)` of `fixture` in mm, each as `(min, max)` (§9.3, D44).
/// `span` is the fixture's start and end along its face, already in mm.
fn rectangle(
    fixture: &Fixture,
    room: &RoomRect,
    walls: &[BuiltWall],
    span: (Mm, Mm),
) -> ((Mm, Mm), (Mm, Mm)) {
    let (a0, a1) = span;
    let b0 = fixture.offset;
    let b1 = fixture.offset + fixture.depth;
    let (west, east, north, south) = (room.west, room.east, room.north, room.south);
    if fixture.kind != FixtureKind::Balcony {
        return match fixture.face.side {
            Side::North => ((a0, a1), (north + b0, north + b1)),
            Side::South => ((a0, a1), (south - b1, south - b0)),
            Side::West => ((west + b0, west + b1), (a0, a1)),
            Side::East => ((east - b1, east - b0), (a0, a1)),
        };
    }
    let t = wall_thickness_at(walls, &fixture.face, a0);
    match fixture.face.side {
        Side::South => ((a0, a1), (south + t + b0, south + t + b1)),
        Side::North => ((a0, a1), (north - t - b1, north - t - b0)),
        Side::East => ((east + t + b0, east + t + b1), (a0, a1)),
        Side::West => ((west - t - b1, west - t - b0), (a0, a1)),
    }
}

/// The thickness of the first wall on `face` whose extent along the face holds
/// `at`, where a wall counts for `face` when it is the face's own wall or the
/// facing wall of an interior wall. 0 when there is none.
fn wall_thickness_at(walls: &[BuiltWall], face: &FaceRef, at: Mm) -> Mm {
    walls
        .iter()
        .find(|wall| {
            let on_face = wall.face == *face || wall.other.as_ref() == Some(face);
            let (lo, hi) = along(wall, face.side);
            on_face && lo <= at && at <= hi
        })
        .map_or(0, |wall| wall.thickness)
}

/// The extent of `wall` along a face on `side`: its x for north and south
/// faces, its y for east and west faces.
fn along(wall: &BuiltWall, side: Side) -> (Mm, Mm) {
    match side {
        Side::North | Side::South => wall.x,
        Side::East | Side::West => wall.y,
    }
}

/// The solved span of a room face along its own axis, `(lo, hi)`: west and east
/// for north and south faces, north and south for east and west faces.
fn face_span(side: Side, room: &RoomRect) -> (Mm, Mm) {
    match side {
        Side::North | Side::South => (room.west, room.east),
        Side::East | Side::West => (room.north, room.south),
    }
}

/// E019 for a fixture that runs outside its room.
fn outside_error(
    fixture: &Fixture,
    id: &str,
    room: &RoomName,
    x: (Mm, Mm),
    y: (Mm, Mm),
) -> Diagnostic {
    let code = Code::E019;
    let label = face_label(&fixture.face);
    let args = [
        ("what", format!("Fixture {}", fixture.kind.word())),
        ("face", label.clone()),
        ("at", fixture.at.to_string()),
        ("room", room.to_string()),
    ];
    Diagnostic {
        code,
        severity: Severity::Error,
        message: message(code, &args),
        span: None,
        refs: vec![label],
        data: json!({ "id": id, "x": [x.0, x.1], "y": [y.0, y.1] }),
    }
}

/// `(index into plan.fixtures, id)` for every fixture. Ids are numbered per
/// face in order of `at`, then kind word, then declaration order. Sorted by
/// index.
fn number_fixtures(plan: &Plan) -> Vec<(usize, String)> {
    let mut order: Vec<usize> = (0..plan.fixtures.len()).collect();
    order.sort_by_key(|&i| {
        let fixture = &plan.fixtures[i];
        (
            face_label(&fixture.face),
            fixture.at,
            fixture.kind.word(),
            i,
        )
    });
    let mut count_on_face: BTreeMap<String, usize> = BTreeMap::new();
    let mut out = Vec::with_capacity(order.len());
    for i in order {
        let label = face_label(&plan.fixtures[i].face);
        let n = count_on_face.entry(label.clone()).or_insert(0);
        *n += 1;
        out.push((i, format!("F:{label}:{n}")));
    }
    out.sort_by_key(|(i, _)| *i);
    out
}

/// `Room.side` with the side in lower case, as used in ids and messages.
fn face_label(face: &FaceRef) -> String {
    let side = match face.side {
        Side::North => "north",
        Side::East => "east",
        Side::South => "south",
        Side::West => "west",
    };
    format!("{}.{}", face.room, side)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::diagnostics::Code;
    use crate::dsl::parse;
    use crate::intent::Phase;
    use crate::resolved::{Resolved, has_error, resolve, resolve_draft};

    const FIXTURE_A: &str = include_str!("../../../../fixtures/lgh154-a.plan");

    /// The test room: `Kok` 2400 × 4000 mm, interior walls 100 mm, outer 400 mm.
    const KOK: &str = "plan \"p\"\n\
         default_wall 100 source assumed\n\
         default_outer_wall 400 source assumed\n\
         room Kok 2400 x 4000 source laser\n";

    /// Resolve `KOK` with the given fixture lines appended.
    fn kok(lines: &str) -> (Option<Resolved>, Vec<Diagnostic>) {
        let plan = parse(&format!("{KOK}{lines}")).expect("plan parses");
        resolve(&plan)
    }

    /// The rectangle of fixture `id` in the resolved model.
    fn fixture_xy(resolved: &Resolved, id: &str) -> ((Mm, Mm), (Mm, Mm)) {
        let fixture = resolved
            .fixtures
            .get(id)
            .unwrap_or_else(|| panic!("no fixture {id}"));
        (fixture.x, fixture.y)
    }

    #[test]
    fn stove_on_north_face_gets_the_first_id() {
        let (resolved, diagnostics) = kok("fixture stove Kok.north at 200\n");
        assert!(!has_error(&diagnostics), "{diagnostics:?}");
        let resolved = resolved.expect("the plan resolves");
        assert_eq!(
            fixture_xy(&resolved, "F:Kok.north:1"),
            ((200, 800), (0, 600))
        );
        let fixture = &resolved.fixtures["F:Kok.north:1"];
        assert_eq!(fixture.kind, FixtureKind::Stove);
        assert_eq!(fixture.phase, Phase::Existing);
        assert_eq!(fixture.label, None);
    }

    #[test]
    fn sink_on_east_face_is_against_the_east_wall() {
        let (resolved, diagnostics) = kok("fixture sink Kok.east at 500\n");
        assert!(!has_error(&diagnostics), "{diagnostics:?}");
        let resolved = resolved.expect("the plan resolves");
        assert_eq!(
            fixture_xy(&resolved, "F:Kok.east:1"),
            ((1800, 2400), (500, 1100))
        );
    }

    #[test]
    fn balcony_lies_outside_the_outer_wall() {
        let (resolved, diagnostics) =
            kok("fixture balcony Kok.south at 300 width 1500 depth 1300\n");
        assert!(!has_error(&diagnostics), "{diagnostics:?}");
        let resolved = resolved.expect("the plan resolves");
        assert_eq!(
            fixture_xy(&resolved, "F:Kok.south:1"),
            ((300, 1800), (4400, 5700))
        );
    }

    #[test]
    fn fixture_running_past_its_room_is_e019_and_no_model() {
        let (resolved, diagnostics) = kok("fixture stove Kok.north at 2000\n");
        assert!(resolved.is_none());
        let e019: Vec<&Diagnostic> = diagnostics
            .iter()
            .filter(|d| d.code == Code::E019)
            .collect();
        assert_eq!(e019.len(), 1, "{diagnostics:?}");
        assert_eq!(e019[0].severity, Severity::Error);
        assert_eq!(
            e019[0].message,
            "Fixture stove on Kok.north at 2000 runs outside Kok."
        );
        assert_eq!(e019[0].refs, ["Kok.north"]);
    }

    #[test]
    fn fixture_running_past_its_room_is_left_out_of_a_draft() {
        let plan = parse(&format!("{KOK}fixture stove Kok.north at 2000\n")).expect("parses");
        let (resolved, diagnostics) = resolve_draft(&plan);
        assert!(diagnostics.iter().any(|d| d.code == Code::E019));
        let resolved = resolved.expect("the draft resolves");
        assert!(resolved.fixtures.is_empty());
    }

    #[test]
    fn offset_moves_a_fixture_into_the_room() {
        let (resolved, diagnostics) =
            kok("fixture box Kok.west at 1000 width 500 depth 500 offset 900\n");
        assert!(!has_error(&diagnostics), "{diagnostics:?}");
        let resolved = resolved.expect("the plan resolves");
        assert_eq!(
            fixture_xy(&resolved, "F:Kok.west:1"),
            ((900, 1400), (1000, 1500))
        );
    }

    #[test]
    fn fixture_a_has_no_fixtures_and_the_same_element_ids() {
        let plan = parse(FIXTURE_A).expect("fixture A parses");
        let (resolved, diagnostics) = resolve(&plan);
        assert!(!has_error(&diagnostics), "{diagnostics:?}");
        let resolved = resolved.expect("fixture A resolves");
        assert!(resolved.fixtures.is_empty());
        let ids = crate::api::element_ids(&resolved);
        assert_eq!(
            ids.len(),
            resolved.rooms.len() + resolved.walls.len() + resolved.openings.len()
        );
        assert!(!ids.iter().any(|id| id.starts_with("F:")), "{ids:?}");
    }
}
