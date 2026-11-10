//! Wall stubs in the resolved model (spec §15 D45).
//!
//! A stub is a piece of wall that starts on a room face, `offset` mm away from
//! it, and runs `length` mm straight into the room. Its rectangle is the
//! fixture rule of §15 D44 with the width set to the thickness and the depth
//! set to the length. `at` runs along the face from its west end (north and
//! south faces) or north end (east and west faces). Ids are `S:<Room>.<side>:<n>`,
//! numbered per face by `at`, then by declaration order.
//!
//! A stub that does not lie inside its room is E019 and is left out. A stub
//! whose room has no rectangle is skipped without a diagnostic. Stubs are kept
//! apart from the generated walls, so they do not change wall ids (D45).

use std::collections::BTreeMap;

use serde_json::json;

use crate::diagnostics::{Code, Diagnostic, Severity, message};
use crate::intent::{Plan, RoomName, Side, Stub};
use crate::resolved::{ResolvedStub, RoomRect};
use crate::units::Mm;

use super::fixtures::{face_label, face_span};

/// Place every stub of `plan` (§15 D45).
///
/// `rooms` are the solved rectangles in mm (x east, y south). A stub without a
/// thickness takes `default_wall`. Returns the placed stubs by id, and one E019
/// diagnostic per stub that runs outside its room (those stubs are left out).
pub fn place_stubs(
    plan: &Plan,
    rooms: &BTreeMap<RoomName, RoomRect>,
) -> (BTreeMap<String, ResolvedStub>, Vec<Diagnostic>) {
    let mut placed = BTreeMap::new();
    let mut diagnostics = Vec::new();
    for (index, id) in number_stubs(plan) {
        let stub = &plan.stubs[index];
        let Some(room) = rooms.get(&stub.face.room) else {
            continue;
        };
        let thickness = stub.thickness.unwrap_or(plan.default_wall.value);
        let (lo, _) = face_span(stub.face.side, room);
        let a0 = lo + stub.at;
        let (x, y) = rectangle(stub, room, (a0, a0 + thickness));
        let inside = x.0 >= room.west && x.1 <= room.east && y.0 >= room.north && y.1 <= room.south;
        if !inside {
            diagnostics.push(outside_error(stub, &id, &stub.face.room, x, y));
            continue;
        }
        placed.insert(
            id.clone(),
            ResolvedStub {
                id,
                face: stub.face.clone(),
                x,
                y,
                thickness,
                bearing: stub.bearing,
                phase: stub.phase,
            },
        );
    }
    (placed, diagnostics)
}

/// The rectangle `(x, y)` of `stub` in mm, each as `(min, max)` (§15 D45).
/// `span` is the stub's start and end along its face, already in mm.
fn rectangle(stub: &Stub, room: &RoomRect, span: (Mm, Mm)) -> ((Mm, Mm), (Mm, Mm)) {
    let (a0, a1) = span;
    let b0 = stub.offset;
    let b1 = stub.offset + stub.length;
    let (west, east, north, south) = (room.west, room.east, room.north, room.south);
    match stub.face.side {
        Side::North => ((a0, a1), (north + b0, north + b1)),
        Side::South => ((a0, a1), (south - b1, south - b0)),
        Side::West => ((west + b0, west + b1), (a0, a1)),
        Side::East => ((east - b1, east - b0), (a0, a1)),
    }
}

/// E019 for a stub that runs outside its room.
fn outside_error(stub: &Stub, id: &str, room: &RoomName, x: (Mm, Mm), y: (Mm, Mm)) -> Diagnostic {
    let code = Code::E019;
    let label = face_label(&stub.face);
    let args = [
        ("what", "Stub".to_string()),
        ("face", label.clone()),
        ("at", stub.at.to_string()),
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

/// `(index into plan.stubs, id)` for every stub. Ids are numbered per face in
/// order of `at`, then declaration order. Sorted by index.
fn number_stubs(plan: &Plan) -> Vec<(usize, String)> {
    let mut order: Vec<usize> = (0..plan.stubs.len()).collect();
    order.sort_by_key(|&i| (face_label(&plan.stubs[i].face), plan.stubs[i].at, i));
    let mut count_on_face: BTreeMap<String, usize> = BTreeMap::new();
    let mut out = Vec::with_capacity(order.len());
    for i in order {
        let label = face_label(&plan.stubs[i].face);
        let n = count_on_face.entry(label.clone()).or_insert(0);
        *n += 1;
        out.push((i, format!("S:{label}:{n}")));
    }
    out.sort_by_key(|(i, _)| *i);
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dsl::parse;
    use crate::resolved::{has_error, resolve, resolve_draft};

    /// `Kok` 2400 × 4000 mm with interior walls of 100 mm.
    const KOK: &str = "plan \"p\"\n\
         default_wall 100 source assumed\n\
         default_outer_wall 400 source assumed\n\
         room Kok 2400 x 4000 source laser\n";

    fn kok(lines: &str) -> (Option<crate::resolved::Resolved>, Vec<Diagnostic>) {
        let plan = parse(&format!("{KOK}{lines}")).expect("plan parses");
        resolve(&plan)
    }

    #[test]
    fn stub_on_west_face_runs_into_the_room() {
        let (resolved, diagnostics) = kok("stub Kok.west at 2000 length 600\n");
        assert!(!has_error(&diagnostics), "{diagnostics:?}");
        let resolved = resolved.expect("the plan resolves");
        let stub = &resolved.stubs["S:Kok.west:1"];
        assert_eq!(stub.x, (0, 600));
        assert_eq!(stub.y, (2000, 2100));
        assert_eq!(stub.thickness, 100);
        assert!(!stub.bearing);
    }

    #[test]
    fn stub_past_its_room_is_e019_and_no_model() {
        let (resolved, diagnostics) = kok("stub Kok.north at 2350 length 600\n");
        assert!(resolved.is_none());
        let e019: Vec<&Diagnostic> = diagnostics
            .iter()
            .filter(|d| d.code == Code::E019)
            .collect();
        assert_eq!(e019.len(), 1, "{diagnostics:?}");
        assert_eq!(e019[0].severity, Severity::Error);
        assert_eq!(
            e019[0].message,
            "Stub on Kok.north at 2350 runs outside Kok."
        );
        assert_eq!(e019[0].refs, ["Kok.north"]);
    }

    #[test]
    fn stub_past_its_room_is_left_out_of_a_draft() {
        let plan = parse(&format!("{KOK}stub Kok.north at 2350 length 600\n")).expect("parses");
        let (resolved, diagnostics) = resolve_draft(&plan);
        assert!(diagnostics.iter().any(|d| d.code == Code::E019));
        let resolved = resolved.expect("the draft resolves");
        assert!(resolved.stubs.is_empty());
    }

    #[test]
    fn explicit_thickness_and_offset_make_a_free_standing_wall() {
        let (resolved, diagnostics) =
            kok("stub Kok.west at 1000 length 800 thickness 150 offset 500 bearing\n");
        assert!(!has_error(&diagnostics), "{diagnostics:?}");
        let resolved = resolved.expect("the plan resolves");
        let stub = &resolved.stubs["S:Kok.west:1"];
        assert_eq!(stub.x, (500, 1300));
        assert_eq!(stub.y, (1000, 1150));
        assert_eq!(stub.thickness, 150);
        assert!(stub.bearing);
    }

    #[test]
    fn stubs_are_numbered_per_face_by_at() {
        let (resolved, diagnostics) = kok("stub Kok.west at 2000 length 300\n\
             stub Kok.west at 100 length 300\n\
             stub Kok.north at 10 length 300\n");
        assert!(!has_error(&diagnostics), "{diagnostics:?}");
        let resolved = resolved.expect("the plan resolves");
        let ids: Vec<&str> = resolved.stubs.keys().map(String::as_str).collect();
        assert_eq!(ids, ["S:Kok.north:1", "S:Kok.west:1", "S:Kok.west:2"]);
        assert_eq!(resolved.stubs["S:Kok.west:1"].y, (100, 200));
    }

    #[test]
    fn stub_in_a_room_without_a_rectangle_is_skipped() {
        let plan = parse(
            "room A 2000 x ? source laser\nroom B 1500 x 1000 source laser\n  east_of A gap\n  align north A\nstub A.west at 0 length 300\n",
        )
        .expect("parses");
        let (_, diagnostics) = resolve_draft(&plan);
        assert!(!diagnostics.iter().any(|d| d.code == Code::E019));
    }
}
