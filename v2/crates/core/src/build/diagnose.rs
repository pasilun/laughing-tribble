//! Diagnostics from the built walls: the facade step check (W003, spec §9.2)
//! and the derived wall thickness (I010, spec §8 and §9.2 step 2).
//!
//! Runs on the list returned by [`built_walls`](super::merge::built_walls).
//! The inner face of an outer wall is the room face it grows from, so it can be
//! read from the wall body: the near edge on a south or east wall, the far edge
//! on a north or west wall.

use serde_json::json;

use crate::diagnostics::{Code, Diagnostic, Severity, message};
use crate::intent::Side;
use crate::units::Mm;

use super::merge::BuiltWall;
use super::walls::SegmentKind;

/// Largest facade step that W003 reports, in mm (§9.2).
pub const STEP_MAX: Mm = 100;

/// Sides in the order used for every listing: north, east, south, west.
const SIDES: [Side; 4] = [Side::North, Side::East, Side::South, Side::West];

/// The W003, I010 and W005 diagnostics for `walls`: first the facade steps,
/// then the derived walls, then the thickness warnings, each in the order of
/// `walls` (sorted by id).
pub fn diagnose(walls: &[BuiltWall]) -> Vec<Diagnostic> {
    let mut out = facade_steps(walls);
    out.extend(derived_walls(walls));
    out.extend(thickness_warnings(walls));
    out
}

/// W005 for every interior or outer wall thinner than 70 mm or thicker than
/// 600 mm (§8).
fn thickness_warnings(walls: &[BuiltWall]) -> Vec<Diagnostic> {
    walls
        .iter()
        .filter(|w| {
            matches!(w.kind, SegmentKind::Interior | SegmentKind::Outer)
                && (w.thickness < 70 || w.thickness > 600)
        })
        .map(|w| {
            let refs = vec![w.id.clone()];
            Diagnostic {
                code: Code::W005,
                severity: Severity::Warning,
                message: message(
                    Code::W005,
                    &[("id", w.id.clone()), ("t", w.thickness.to_string())],
                ),
                span: None,
                refs,
                data: json!({ "wall": w.id, "thickness": w.thickness }),
            }
        })
        .collect()
}

/// W003 for every pair of outer walls on one compass side whose inner faces are
/// 1 to [`STEP_MAX`] mm apart and whose spans are joined by one interior wall.
fn facade_steps(walls: &[BuiltWall]) -> Vec<Diagnostic> {
    let mut out = Vec::new();
    for side in SIDES {
        let mut outer: Vec<&BuiltWall> = walls
            .iter()
            .filter(|w| w.kind == SegmentKind::Outer && w.face.side == side)
            .collect();
        outer.sort_by_key(|w| along(w).0);
        for pair in outer.windows(2) {
            if let Some(diag) = step(walls, pair[0], pair[1]) {
                out.push(diag);
            }
        }
    }
    out
}

/// The W003 for the outer walls `a` (earlier along the side) and `b`, or `None`
/// when they are not a 1–100 mm step joined by one interior wall.
fn step(walls: &[BuiltWall], a: &BuiltWall, b: &BuiltWall) -> Option<Diagnostic> {
    let side = a.face.side;
    let (la, lb) = (inner_line(a), inner_line(b));
    let d = (lb - la).abs();
    if !(1..=STEP_MAX).contains(&d) {
        return None;
    }
    let (gap_from, gap_to) = (along(a).1, along(b).0);
    if gap_from > gap_to {
        return None;
    }
    let (lo, hi) = (la.min(lb), la.max(lb));
    let joined = walls.iter().any(|w| {
        // Along the side, the wall must reach across the gap; across the side,
        // it must cover both inner faces.
        let (along_span, across_span) = if horizontal(side) {
            (w.x, w.y)
        } else {
            (w.y, w.x)
        };
        w.kind == SegmentKind::Interior
            && along_span.0 <= gap_from
            && gap_to <= along_span.1
            && across_span.0 <= lo
            && hi <= across_span.1
    });
    if !joined {
        return None;
    }
    let a_label = face_label(a);
    let b_label = face_label(b);
    let side_name = side_name(side);
    let ra = a.face.room.as_str().to_string();
    let rb = b.face.room.as_str().to_string();
    Some(Diagnostic {
        code: Code::W003,
        severity: Severity::Warning,
        message: message(
            Code::W003,
            &[
                ("a", a_label.clone()),
                ("ya", la.to_string()),
                ("b", b_label.clone()),
                ("yb", lb.to_string()),
                ("d", d.to_string()),
                ("side", side_name.to_string()),
                ("ra", ra.clone()),
                ("rb", rb.clone()),
            ],
        ),
        span: None,
        refs: vec![a_label.clone(), b_label.clone()],
        data: json!({
            "side": side_name,
            "a": a_label,
            "ya": la,
            "b": b_label,
            "yb": lb,
            "d": d,
        }),
    })
}

/// I010 for every interior wall whose thickness is derived, not stated.
fn derived_walls(walls: &[BuiltWall]) -> Vec<Diagnostic> {
    walls
        .iter()
        .filter(|w| w.kind == SegmentKind::Interior && w.derived)
        .map(|w| {
            let refs = vec![w.id.clone()];
            Diagnostic {
                code: Code::I010,
                severity: Severity::Info,
                message: message(
                    Code::I010,
                    &[("id", w.id.clone()), ("t", w.thickness.to_string())],
                ),
                span: None,
                refs,
                data: json!({ "id": w.id, "thickness": w.thickness }),
            }
        })
        .collect()
}

/// `true` for a north or south side, whose span runs along x.
fn horizontal(side: Side) -> bool {
    matches!(side, Side::North | Side::South)
}

/// The extent of an outer wall along its side, as `(min, max)`.
fn along(wall: &BuiltWall) -> (Mm, Mm) {
    if horizontal(wall.face.side) {
        wall.x
    } else {
        wall.y
    }
}

/// The inner face of an outer wall: the room face line, in mm.
fn inner_line(wall: &BuiltWall) -> Mm {
    match wall.face.side {
        Side::South => wall.y.0,
        Side::North => wall.y.1,
        Side::East => wall.x.0,
        Side::West => wall.x.1,
    }
}

/// `Room.side`, as used in W003 text.
fn face_label(wall: &BuiltWall) -> String {
    format!("{}.{}", wall.face.room.as_str(), side_name(wall.face.side))
}

/// The compass word for a side.
fn side_name(side: Side) -> &'static str {
    match side {
        Side::North => "north",
        Side::East => "east",
        Side::South => "south",
        Side::West => "west",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::build::{Coords, built_walls};
    use crate::dsl::parse;
    use crate::intent::Plan;
    use crate::solve::{Axis, Edge, FaceKey, assign_coords, components, edges};

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

    /// The diagnostics of the plan written in `src`.
    fn diagnostics_of(src: &str) -> Vec<Diagnostic> {
        let plan = parse(src).expect("plan parses");
        diagnose(&built_walls(&plan, &solved(&plan)))
    }

    #[test]
    fn fixture_a_has_one_facade_step_and_two_derived_walls() {
        let plan = parse(FIXTURE_A).expect("fixture A parses");
        let diags = diagnose(&built_walls(&plan, &solved(&plan)));
        let got: Vec<(Code, Severity, &str)> = diags
            .iter()
            .map(|d| (d.code, d.severity, d.message.as_str()))
            .collect();
        assert_eq!(
            got,
            vec![
                (
                    Code::W003,
                    Severity::Warning,
                    r#"Facade not straight: Sovrum.south 4540 vs Vardagsrum.south 4593 (53 mm). Add "align south Sovrum Vardagsrum" if it is straight."#,
                ),
                (
                    Code::I010,
                    Severity::Info,
                    "Wall W:Garderob.east|Vardagsrum.west is 121 mm, derived from the room positions.",
                ),
                (
                    Code::I010,
                    Severity::Info,
                    "Wall W:Sovrum.east|Vardagsrum.west is 121 mm, derived from the room positions.",
                ),
            ]
        );
        assert!(diags.iter().all(|d| d.span.is_none()));
        assert_eq!(diags[0].refs, ["Sovrum.south", "Vardagsrum.south"]);
        assert_eq!(diags[0].data["d"], 53);
    }

    /// Room A (2000 x 3000) with B east of it, 90 mm off, B's north aligned to
    /// A's. B is `depth` deep, so its south face steps `depth - 3000` from A's.
    fn step_plan(depth: i64) -> String {
        format!("room A 2000 x 3000\nroom B 1000 x {depth}\n  east_of A gap 90\n  align north A\n")
    }

    #[test]
    fn step_of_150_mm_gives_no_w003() {
        let diags = diagnostics_of(&step_plan(3150));
        assert!(diags.iter().all(|d| d.code != Code::W003), "{diags:?}");
    }

    fn w005s(diags: &[Diagnostic]) -> Vec<&Diagnostic> {
        diags.iter().filter(|d| d.code == Code::W005).collect()
    }

    #[test]
    fn interior_wall_of_20_mm_gives_w005() {
        let diags = diagnostics_of(
            "room A 2000 x 1000\nroom B 1500 x 1000\n  east_of A gap 20 source laser\n  align north A\n",
        );
        let w = w005s(&diags);
        assert_eq!(w.len(), 1, "{diags:?}");
        assert_eq!(w[0].severity, Severity::Warning);
        assert_eq!(
            w[0].message,
            "Wall W:A.east|B.west is 20 mm thick; check the measurements around it."
        );
        assert_eq!(w[0].refs, ["W:A.east|B.west"]);
        assert_eq!(w[0].data["thickness"], 20);
        assert!(w[0].span.is_none());
    }

    #[test]
    fn outer_wall_of_650_mm_gives_w005() {
        let diags = diagnostics_of("room A 2000 x 1000\nwall A.north thickness 650 source laser\n");
        let w = w005s(&diags);
        assert_eq!(w.len(), 1, "{diags:?}");
        assert_eq!(
            w[0].message,
            "Wall W:A.north:outer is 650 mm thick; check the measurements around it."
        );
        assert_eq!(w[0].refs, ["W:A.north:outer"]);
    }

    #[test]
    fn fixture_a_has_no_w005() {
        let plan = parse(FIXTURE_A).expect("fixture A parses");
        let diags = diagnose(&built_walls(&plan, &solved(&plan)));
        assert!(w005s(&diags).is_empty(), "{diags:?}");
    }

    #[test]
    fn step_of_53_mm_gives_w003() {
        let diags = diagnostics_of(&step_plan(3053));
        let steps: Vec<&Diagnostic> = diags.iter().filter(|d| d.code == Code::W003).collect();
        assert_eq!(steps.len(), 1, "{diags:?}");
        assert_eq!(
            steps[0].message,
            r#"Facade not straight: A.south 3000 vs B.south 3053 (53 mm). Add "align south A B" if it is straight."#
        );
    }
}
