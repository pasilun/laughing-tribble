//! Openings: placement on their face, E004 and E007 (spec §9.3, §5.3).
//!
//! `at` is measured along the inner face from its west end on north and south
//! faces, and from its north end on east and west faces. The opening occupies
//! `[at, at + width]` along that face, in absolute mm. Ids are
//! `O:<Room>.<side>:<n>`, numbered per face by `at`.
//!
//! An opening must lie inside one wall segment of its face. An opening on a
//! face with no wall overlapping it is E007 (open side). An opening that runs
//! past the face, or that no single wall covers, is E004.
//!
//! A door hinge must lie along its face (west or east on a north or south
//! face, north or south on an east or west face). Otherwise the door is E013
//! (spec §9.3, D19). A door with no hinge is not an error.

use serde_json::json;

use crate::diagnostics::{Code, Diagnostic, Severity, message};
use crate::intent::{FaceRef, OpeningKind, Plan, Side};
use crate::units::Mm;

use super::faces::Coords;
use super::merge::BuiltWall;
use super::walls::face_key;

/// An opening placed on its face: the resolved form of §5.3 `ResolvedOpening`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PlacedOpening {
    /// The semantic id, `O:<Room>.<side>:<n>`, numbered per face by `at`.
    pub id: String,
    /// Door, window or passage.
    pub kind: OpeningKind,
    /// The room face it sits in.
    pub face: FaceRef,
    /// Absolute start along the face in mm: x for north and south faces, y for
    /// east and west faces.
    pub start: Mm,
    /// Absolute end along the face in mm (`start + width`).
    pub end: Mm,
    /// The id of the wall segment the opening sits in (a [`BuiltWall`] id).
    pub wall: String,
    /// Doors: the compass side of the jamb with the hinge, as written.
    pub hinge: Option<Side>,
}

/// Place every opening of `plan` on its face (§9.3).
///
/// `coords` are the solved room faces in mm (x east, y south); `walls` are the
/// walls from [`built_walls`](super::merge::built_walls) for the same plan.
/// Returns the placed openings sorted by id, and one E004 or E007 diagnostic
/// per opening that cannot be placed (those openings are left out). An opening
/// whose room has no solved face is also left out, without a diagnostic.
pub fn place_openings(
    plan: &Plan,
    coords: &Coords,
    walls: &[BuiltWall],
) -> (Vec<PlacedOpening>, Vec<Diagnostic>) {
    let mut placed = Vec::new();
    let mut diagnostics = Vec::new();
    for (index, id) in number_openings(plan) {
        let opening = &plan.openings[index];
        let face = &opening.face;
        let Some((lo, hi)) = face_span(face, coords) else {
            continue;
        };
        let at = opening.at.value;
        let width = opening.width.value;
        let start = lo + at;
        let end = start + width;
        let label = face_label(face);

        if start < lo || end > hi {
            diagnostics.push(error(
                Code::E004,
                &id,
                &[
                    ("kind", capitalised(kind_word(opening.kind))),
                    ("face", label.clone()),
                    ("at", at.to_string()),
                    ("width", width.to_string()),
                    ("length", (hi - lo).to_string()),
                ],
                json!({ "start": start, "end": end, "face_start": lo, "face_end": hi }),
            ));
            continue;
        }

        let on_face: Vec<(&BuiltWall, (Mm, Mm))> = walls
            .iter()
            .filter(|w| w.face == *face || w.other.as_ref() == Some(face))
            .map(|w| (w, along(w, face.side)))
            .collect();
        if !on_face.iter().any(|(_, (a, b))| *a < end && start < *b) {
            diagnostics.push(error(
                Code::E007,
                &id,
                &[
                    ("face", label.clone()),
                    ("kind", kind_word(opening.kind).to_string()),
                ],
                json!({ "start": start, "end": end }),
            ));
            continue;
        }

        match on_face.iter().find(|(_, (a, b))| *a <= start && end <= *b) {
            Some((wall, _)) => match opening.hinge {
                Some(hinge) if !hinge_along_face(face.side, hinge) => {
                    let (a, b) = hinge_choices(face.side);
                    diagnostics.push(error(
                        Code::E013,
                        &id,
                        &[
                            ("found", side_word(hinge).to_string()),
                            ("face", label.clone()),
                            ("a", a.to_string()),
                            ("b", b.to_string()),
                        ],
                        json!({ "hinge": side_word(hinge) }),
                    ));
                }
                _ => placed.push(PlacedOpening {
                    id: id.clone(),
                    kind: opening.kind,
                    face: face.clone(),
                    start,
                    end,
                    wall: wall.id.clone(),
                    hinge: opening.hinge,
                }),
            },
            None => diagnostics.push(error(
                Code::E004,
                &id,
                &[
                    ("kind", capitalised(kind_word(opening.kind))),
                    ("face", label.clone()),
                    ("at", at.to_string()),
                    ("width", width.to_string()),
                    ("length", (hi - lo).to_string()),
                ],
                json!({ "start": start, "end": end, "face_start": lo, "face_end": hi }),
            )),
        }
    }
    placed.sort_by(|a, b| a.id.cmp(&b.id));
    (placed, diagnostics)
}

/// `(index into plan.openings, id)` for every opening. Ids are numbered per
/// face in order of `at`, ties by declaration order. Sorted by index.
fn number_openings(plan: &Plan) -> Vec<(usize, String)> {
    let mut order: Vec<usize> = (0..plan.openings.len()).collect();
    order.sort_by_key(|&i| {
        let opening = &plan.openings[i];
        (face_label(&opening.face), opening.at.value, i)
    });
    let mut count_on_face: std::collections::BTreeMap<String, usize> =
        std::collections::BTreeMap::new();
    let mut out = Vec::with_capacity(order.len());
    for i in order {
        let label = face_label(&plan.openings[i].face);
        let n = count_on_face.entry(label.clone()).or_insert(0);
        *n += 1;
        out.push((i, format!("O:{label}:{n}")));
    }
    out.sort_by_key(|(i, _)| *i);
    out
}

/// The solved span of `face` along its own axis, as `(lo, hi)` in mm: west and
/// east for north and south faces, north and south for east and west faces.
/// `None` when the room has no solved face.
fn face_span(face: &FaceRef, coords: &Coords) -> Option<(Mm, Mm)> {
    let room = &face.room;
    match face.side {
        Side::North | Side::South => {
            let lo = coords.x.get(&face_key(room, Side::West)).copied()?;
            let hi = coords.x.get(&face_key(room, Side::East)).copied()?;
            Some((lo, hi))
        }
        Side::East | Side::West => {
            let lo = coords.y.get(&face_key(room, Side::North)).copied()?;
            let hi = coords.y.get(&face_key(room, Side::South)).copied()?;
            Some((lo, hi))
        }
    }
}

/// The extent of `wall` along a face on `side`: its x for north and south
/// faces, its y for east and west faces.
fn along(wall: &BuiltWall, side: Side) -> (Mm, Mm) {
    match side {
        Side::North | Side::South => wall.x,
        Side::East | Side::West => wall.y,
    }
}

/// Build an error diagnostic whose message comes from the template.
fn error(code: Code, id: &str, args: &[(&str, String)], data: serde_json::Value) -> Diagnostic {
    Diagnostic {
        code,
        severity: Severity::Error,
        message: message(code, args),
        span: None,
        refs: vec![id.to_string()],
        data,
    }
}

/// Whether `hinge` lies along a face on `face_side`: west or east on a north or
/// south face, north or south on an east or west face (§9.3).
fn hinge_along_face(face_side: Side, hinge: Side) -> bool {
    match face_side {
        Side::North | Side::South => matches!(hinge, Side::West | Side::East),
        Side::East | Side::West => matches!(hinge, Side::North | Side::South),
    }
}

/// The two lower-case compass words a hinge may use on a face on `face_side`.
fn hinge_choices(face_side: Side) -> (&'static str, &'static str) {
    match face_side {
        Side::North | Side::South => ("west", "east"),
        Side::East | Side::West => ("north", "south"),
    }
}

/// `Room.side`, as used in wall and opening ids.
fn face_label(face: &FaceRef) -> String {
    format!("{}.{}", face.room.as_str(), side_word(face.side))
}

/// The compass word of a side, lower case.
fn side_word(side: Side) -> &'static str {
    match side {
        Side::North => "north",
        Side::East => "east",
        Side::South => "south",
        Side::West => "west",
    }
}

/// The lower-case word of an opening kind.
fn kind_word(kind: OpeningKind) -> &'static str {
    match kind {
        OpeningKind::Door => "door",
        OpeningKind::Window => "window",
        OpeningKind::Passage => "passage",
    }
}

/// Upper-case the first letter of `word`.
fn capitalised(word: &str) -> String {
    let mut chars = word.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().chain(chars).collect(),
        None => String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dsl::parse;
    use crate::intent::RoomName;
    use crate::solve::{Axis, Edge, FaceKey, assign_coords, components, edges};
    use std::collections::BTreeMap;

    const FIXTURE_A: &str = include_str!("../../../../fixtures/lgh154-a.plan");

    /// Solve one axis the way `merge.rs` tests do.
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

    /// Place the openings of `src`, returning the placed list and diagnostics.
    fn place(src: &str) -> (Vec<PlacedOpening>, Vec<Diagnostic>) {
        let plan = parse(src).expect("plan parses");
        let coords = solved(&plan);
        let walls = super::super::merge::built_walls(&plan, &coords);
        place_openings(&plan, &coords, &walls)
    }

    #[test]
    fn fixture_a_openings_are_in_the_right_walls() {
        let plan = parse(FIXTURE_A).expect("fixture A parses");
        let coords = solved(&plan);
        let walls = super::super::merge::built_walls(&plan, &coords);
        let (placed, diagnostics) = place_openings(&plan, &coords, &walls);
        assert!(diagnostics.is_empty(), "no errors: {diagnostics:?}");
        let got: Vec<(&str, &str, Mm, Mm, &str)> = placed
            .iter()
            .map(|o| {
                (
                    o.id.as_str(),
                    o.face.room.as_str(),
                    o.start,
                    o.end,
                    o.wall.as_str(),
                )
            })
            .collect();
        assert_eq!(
            got,
            [
                (
                    "O:Garderob.east:1",
                    "Garderob",
                    0,
                    680,
                    "W:Garderob.east|Hall.west"
                ),
                (
                    "O:Sovrum.south:1",
                    "Sovrum",
                    380,
                    1730,
                    "W:Sovrum.south:outer"
                ),
                (
                    "O:Vardagsrum.south:1",
                    "Vardagsrum",
                    3591,
                    4871,
                    "W:Vardagsrum.south:outer"
                ),
                ("O:WC.west:1", "WC", 240, 690, "W:Hall.east|WC.west"),
            ]
        );
        assert_eq!(placed[3].hinge, Some(Side::South));
        assert_eq!(placed[3].kind, OpeningKind::Door);
    }

    #[test]
    fn ids_are_numbered_per_face_by_at() {
        let (placed, diagnostics) = place(
            "room A 3000 x 2000\n\
             window A.north at 1500 width 300\n\
             window A.north at 200 width 300\n",
        );
        assert!(diagnostics.is_empty(), "{diagnostics:?}");
        let ids: Vec<(&str, Mm, Mm)> = placed
            .iter()
            .map(|o| (o.id.as_str(), o.start, o.end))
            .collect();
        assert_eq!(
            ids,
            [("O:A.north:1", 200, 500), ("O:A.north:2", 1500, 1800)]
        );
    }

    #[test]
    fn opening_running_past_its_face_is_e004() {
        let (placed, diagnostics) = place("room A 2000 x 3000\nwindow A.south at 1900 width 300\n");
        assert!(placed.is_empty());
        assert_eq!(diagnostics.len(), 1);
        let d = &diagnostics[0];
        assert_eq!(d.code, Code::E004);
        assert_eq!(d.severity, Severity::Error);
        assert_eq!(
            d.message,
            "Window on A.south at 1900 width 300 runs past the face (2000 mm long)."
        );
        assert_eq!(d.refs, ["O:A.south:1"]);
    }

    #[test]
    fn opening_crossing_two_wall_segments_is_e004() {
        // A.east: interior wall to B for y 0..1000, outer wall for y 1000..3000.
        // The window 900..1200 lies inside the face but in no single segment.
        let (placed, diagnostics) = place(
            "room A 2000 x 3000\n\
             room B 1000 x 1000\n  east_of A gap 90\n  align north A\n\
             window A.east at 900 width 300\n",
        );
        assert!(placed.is_empty());
        assert_eq!(diagnostics.len(), 1);
        assert_eq!(diagnostics[0].code, Code::E004);
    }

    #[test]
    fn opening_on_open_side_is_e007() {
        let (placed, diagnostics) = place(
            "room A 1000 x 1000\n\
             room B 1000 x 1000\n  east_of A open\n  align north A\n\
             window A.east at 100 width 300\n",
        );
        assert!(placed.is_empty());
        assert_eq!(diagnostics.len(), 1);
        let d = &diagnostics[0];
        assert_eq!(d.code, Code::E007);
        assert_eq!(
            d.message,
            r#"A.east has no wall ("open"); a window needs a wall."#
        );
        assert_eq!(d.refs, ["O:A.east:1"]);
    }

    #[test]
    fn door_hinge_on_wrong_axis_is_e013() {
        let (placed, diagnostics) = place(
            "room A 3000 x 2000\n\
             door A.north at 200 width 800 hinge north\n",
        );
        assert!(placed.is_empty());
        assert_eq!(diagnostics.len(), 1);
        let d = &diagnostics[0];
        assert_eq!(d.code, Code::E013);
        assert_eq!(d.severity, Severity::Error);
        assert_eq!(
            d.message,
            r#"Hinge "north" on A.north must be west or east."#
        );
        assert_eq!(d.refs, ["O:A.north:1"]);
    }

    #[test]
    fn face_of_unknown_room_is_skipped() {
        // Built directly: the face's room is not in the solved coordinates.
        let mut plan =
            parse("room A 1000 x 1000\nwindow A.north at 100 width 300\n").expect("plan parses");
        plan.openings[0].face.room = RoomName::new("Nowhere").expect("name");
        let coords = solved(&plan);
        let walls = super::super::merge::built_walls(&plan, &coords);
        let (placed, diagnostics) = place_openings(&plan, &coords, &walls);
        assert!(placed.is_empty());
        assert!(diagnostics.is_empty());
    }
}
