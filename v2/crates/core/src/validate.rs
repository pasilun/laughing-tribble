//! Validation of the intent before solving (spec §8, §15 D26).
//!
//! [`validate`] checks the sizes and the placement relations of a plan. It runs
//! first in [`resolve`](crate::resolved::resolve): a plan with a size below
//! 1 mm (E014) or a room placed relative to itself (E015) is rejected before
//! the solver sees it, so no confusing E003 or I010 follows.

use serde_json::json;

use crate::diagnostics::{Code, Diagnostic, Severity, message};
use crate::intent::{OpeningKind, Plan, Relation, Side};
use crate::units::Mm;

/// Smallest size accepted for a room, a wall, an opening or a wall override, in mm.
const MIN_SIZE: Mm = 1;

/// Check `plan` before solving and return every finding.
///
/// All diagnostics are Errors with no span. The checks run in this order: the
/// default walls, the room sizes in declaration order, the placement relations
/// in order, the part relations in declaration order (E015, §15 D46), the
/// openings in order, then the wall overrides in order.
pub fn validate(plan: &Plan) -> Vec<Diagnostic> {
    let mut out = Vec::new();

    for (what, wall) in [
        ("default_wall", &plan.default_wall),
        ("default_outer_wall", &plan.default_outer_wall),
    ] {
        if wall.value < MIN_SIZE {
            out.push(e014(what, wall.value, Vec::new()));
        }
    }

    for name in &plan.order {
        let Some(room) = plan.rooms.get(name) else {
            continue;
        };
        let refs = vec![name.to_string()];
        for (dimension, size) in [("width", &room.width), ("depth", &room.depth)] {
            if let Some(q) = size.as_ref().filter(|q| q.value < MIN_SIZE) {
                let what = format!("Room {name} {dimension}");
                out.push(e014(&what, q.value, refs.clone()));
            }
        }
    }

    for relation in &plan.relations {
        let (subject, relation_name, of) = match relation {
            Relation::EastOf { subject, of, .. } => (subject, "east_of", of),
            Relation::WestOf { subject, of, .. } => (subject, "west_of", of),
            Relation::SouthOf { subject, of, .. } => (subject, "south_of", of),
            Relation::NorthOf { subject, of, .. } => (subject, "north_of", of),
            Relation::Align { .. } => continue,
        };
        if subject == of {
            let args = [
                ("subject", subject.to_string()),
                ("relation", relation_name.to_string()),
                ("of", of.to_string()),
            ];
            out.push(Diagnostic {
                code: Code::E015,
                severity: Severity::Error,
                message: message(Code::E015, &args),
                span: None,
                refs: vec![subject.to_string()],
                data: json!({}),
            });
        }
    }

    for name in &plan.order {
        let Some(parent) = plan.rooms.get(name).and_then(|room| room.part_of.as_ref()) else {
            continue;
        };
        // A part relates to its parent as `part`. A room may not be its own
        // part, and only one level is allowed: the parent may not be a part.
        let parent_is_part = plan
            .rooms
            .get(parent)
            .is_some_and(|room| room.part_of.is_some());
        if parent == name || parent_is_part {
            let args = [
                ("subject", name.to_string()),
                ("relation", "part".to_string()),
                ("of", parent.to_string()),
            ];
            out.push(Diagnostic {
                code: Code::E015,
                severity: Severity::Error,
                message: message(Code::E015, &args),
                span: None,
                refs: vec![name.to_string()],
                data: json!({}),
            });
        }
    }

    for opening in &plan.openings {
        if opening.width.value < MIN_SIZE {
            let face = format!("{}.{}", opening.face.room, side_name(opening.face.side));
            let what = format!("{} on {face} width", kind_name(opening.kind));
            out.push(e014(&what, opening.width.value, vec![face]));
        }
    }

    for override_ in &plan.wall_overrides {
        if let Some(thickness) = &override_.thickness
            && thickness.value < MIN_SIZE
        {
            let face = format!("{}.{}", override_.face.room, side_name(override_.face.side));
            let what = format!("Wall {face} thickness");
            out.push(e014(&what, thickness.value, vec![face]));
        }
    }

    out
}

/// An E014 diagnostic for a size `value` (mm) named `what`.
fn e014(what: &str, value: Mm, refs: Vec<String>) -> Diagnostic {
    let args = [("what", what.to_string()), ("value", value.to_string())];
    Diagnostic {
        code: Code::E014,
        severity: Severity::Error,
        message: message(Code::E014, &args),
        span: None,
        refs,
        data: json!({}),
    }
}

/// The lower case compass name of a side, as written in the DSL.
fn side_name(side: Side) -> &'static str {
    match side {
        Side::North => "north",
        Side::East => "east",
        Side::South => "south",
        Side::West => "west",
    }
}

/// The name of an opening kind as it reads in a message.
fn kind_name(kind: OpeningKind) -> &'static str {
    match kind {
        OpeningKind::Door => "Door",
        OpeningKind::Window => "Window",
        OpeningKind::Passage => "Passage",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dsl::parse;
    use crate::resolved::resolve;

    const FIXTURE_A: &str = include_str!("../../../fixtures/lgh154-a.plan");

    fn plan(src: &str) -> Plan {
        parse(src).expect("test plan parses")
    }

    #[test]
    fn zero_width_room_is_e014() {
        let diagnostics = validate(&plan("room A 0 x 2000 source laser\n"));
        assert_eq!(diagnostics.len(), 1, "{diagnostics:?}");
        let d = &diagnostics[0];
        assert_eq!(d.code, Code::E014);
        assert_eq!(d.severity, Severity::Error);
        assert_eq!(d.message, "Room A width is 0 mm; it must be at least 1 mm.");
        assert_eq!(d.refs, vec!["A".to_string()]);
        assert_eq!(d.span, None);
    }

    #[test]
    fn self_relation_is_e015() {
        let diagnostics = validate(&plan("room A 3000 x 2000 source laser\n  east_of A gap\n"));
        assert_eq!(diagnostics.len(), 1, "{diagnostics:?}");
        let d = &diagnostics[0];
        assert_eq!(d.code, Code::E015);
        assert_eq!(d.severity, Severity::Error);
        assert_eq!(d.message, "\"A east_of A\" relates a room to itself.");
        assert_eq!(d.refs, vec!["A".to_string()]);
    }

    #[test]
    fn fixture_a_is_valid() {
        assert!(validate(&plan(FIXTURE_A)).is_empty());
    }

    #[test]
    fn resolve_stops_at_e014_for_zero_width_room() {
        let (resolved, diagnostics) = resolve(&plan("room A 0 x 2000 source laser\n"));
        assert!(resolved.is_none());
        let codes: Vec<Code> = diagnostics.iter().map(|d| d.code).collect();
        assert_eq!(codes, vec![Code::E014], "{diagnostics:?}");
    }

    #[test]
    fn part_of_itself_is_e015() {
        let diagnostics = validate(&plan("room A 1000 x 1000 source laser part A\n"));
        assert_eq!(diagnostics.len(), 1, "{diagnostics:?}");
        let d = &diagnostics[0];
        assert_eq!(d.code, Code::E015);
        assert_eq!(d.message, "\"A part A\" relates a room to itself.");
        assert_eq!(d.refs, vec!["A".to_string()]);
    }

    #[test]
    fn part_of_a_part_is_e015() {
        let src = "room A 1000 x 1000 source laser\nroom B 1000 x 1000 part A\nroom C 1000 x 1000 part B\n";
        let diagnostics = validate(&plan(src));
        assert_eq!(diagnostics.len(), 1, "{diagnostics:?}");
        let d = &diagnostics[0];
        assert_eq!(d.code, Code::E015);
        assert_eq!(d.message, "\"C part B\" relates a room to itself.");
        assert_eq!(d.refs, vec!["C".to_string()]);
    }

    #[test]
    fn one_level_of_parts_is_valid() {
        let src = "room A 1000 x 1000 source laser\nroom B 1000 x 1000 part A\nroom C 1000 x 1000 part A\n";
        assert!(validate(&plan(src)).is_empty());
    }
}
