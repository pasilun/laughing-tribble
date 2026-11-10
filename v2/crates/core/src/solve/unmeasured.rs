//! Measurements worth taking next (spec §8 I020, §15 D8).
//!
//! [`unmeasured`] lists the sizes and explicit gaps whose source is printed,
//! drawn, estimated or assumed, and suggests a laser reading across their far
//! faces. It is not part of `resolve` or `plan check`; only `plan suggest` and
//! the MCP `check` next steps use it.

use serde_json::json;

use crate::diagnostics::{Code, Diagnostic, Severity, message};
use crate::intent::{FaceRef, Gap, Plan, Relation, RoomName, Side};
use crate::units::{Mm, Quantity, Source};

/// One suggested reading, before it becomes a diagnostic.
struct Item {
    what: String,
    quantity: Quantity,
    from: FaceRef,
    to: FaceRef,
    refs: Vec<String>,
}

/// The I020 diagnostics for `plan`, worst tolerance first.
///
/// Sizes come first in declaration order, then explicit wall gaps in relation
/// order. A suggestion is dropped when the plan already has a non-reference
/// measure between the same two faces, in either order. Assumed gaps are
/// default walls and are not suggested.
pub fn unmeasured(plan: &Plan) -> Vec<Diagnostic> {
    let mut items = Vec::new();
    push_sizes(plan, &mut items);
    push_gaps(plan, &mut items);

    items.retain(|item| !is_measured(plan, &item.from, &item.to));
    // `sort_by_key` is stable, so equal tolerances keep the order above.
    items.sort_by_key(|item| std::cmp::Reverse(item.quantity.tolerance));

    items.into_iter().map(diagnostic).collect()
}

/// Room width and depth with a printed, drawn, estimated or assumed size.
fn push_sizes(plan: &Plan, items: &mut Vec<Item>) {
    for name in &plan.order {
        let Some(room) = plan.rooms.get(name) else {
            continue;
        };
        let sizes = [
            ("width", room.width, Side::West, Side::East),
            ("depth", room.depth, Side::North, Side::South),
        ];
        for (dim, quantity, from_side, to_side) in sizes {
            let Some(quantity) = quantity.filter(|q| is_size_source(q.source)) else {
                continue;
            };
            items.push(Item {
                what: format!("{name} {dim}"),
                quantity,
                from: FaceRef {
                    room: name.clone(),
                    side: from_side,
                },
                to: FaceRef {
                    room: name.clone(),
                    side: to_side,
                },
                refs: vec![name.to_string()],
            });
        }
    }
}

/// Explicit wall gaps between rooms with a printed, drawn or estimated value.
fn push_gaps(plan: &Plan, items: &mut Vec<Item>) {
    for relation in &plan.relations {
        let (keyword, subject, of, gap, from, to) = match relation {
            Relation::EastOf { subject, of, gap } => (
                "east_of",
                subject,
                of,
                gap,
                face(of, Side::West),
                face(subject, Side::East),
            ),
            Relation::WestOf { subject, of, gap } => (
                "west_of",
                subject,
                of,
                gap,
                face(subject, Side::West),
                face(of, Side::East),
            ),
            Relation::SouthOf { subject, of, gap } => (
                "south_of",
                subject,
                of,
                gap,
                face(of, Side::North),
                face(subject, Side::South),
            ),
            Relation::NorthOf { subject, of, gap } => (
                "north_of",
                subject,
                of,
                gap,
                face(subject, Side::North),
                face(of, Side::South),
            ),
            Relation::Align { .. } => continue,
        };
        let Gap::Wall(quantity) = gap else {
            continue;
        };
        if !is_gap_source(quantity.source) {
            continue;
        }
        let mut refs = vec![subject.to_string(), of.to_string()];
        refs.sort();
        items.push(Item {
            what: format!("Gap {subject} {keyword} {of}"),
            quantity: *quantity,
            from,
            to,
            refs,
        });
    }
}

/// True when a non-reference measure joins the two faces, in either order.
fn is_measured(plan: &Plan, a: &FaceRef, b: &FaceRef) -> bool {
    plan.measures
        .iter()
        .any(|m| !m.reference && ((m.from == *a && m.to == *b) || (m.from == *b && m.to == *a)))
}

fn is_size_source(source: Source) -> bool {
    matches!(
        source,
        Source::Printed | Source::Drawing | Source::Estimated | Source::Assumed
    )
}

fn is_gap_source(source: Source) -> bool {
    matches!(
        source,
        Source::Printed | Source::Drawing | Source::Estimated
    )
}

fn face(room: &RoomName, side: Side) -> FaceRef {
    FaceRef {
        room: room.clone(),
        side,
    }
}

fn face_text(face: &FaceRef) -> String {
    format!("{}.{}", face.room, side_text(face.side))
}

fn side_text(side: Side) -> &'static str {
    match side {
        Side::North => "north",
        Side::East => "east",
        Side::South => "south",
        Side::West => "west",
    }
}

fn source_text(source: Source) -> &'static str {
    match source {
        Source::Laser => "laser",
        Source::Tape => "tape",
        Source::Printed => "printed",
        Source::Drawing => "drawing",
        Source::Estimated => "estimated",
        Source::Assumed => "assumed",
    }
}

fn diagnostic(item: Item) -> Diagnostic {
    let Item {
        what,
        quantity,
        from,
        to,
        refs,
    } = item;
    let source = source_text(quantity.source);
    let from = face_text(&from);
    let to = face_text(&to);
    let tolerance: Mm = quantity.tolerance;
    let text = message(
        Code::I020,
        &[
            ("what", what.clone()),
            ("value", quantity.value.to_string()),
            ("source", source.to_string()),
            ("tol", tolerance.to_string()),
            ("from", from.clone()),
            ("to", to.clone()),
        ],
    );
    Diagnostic {
        code: Code::I020,
        severity: Severity::Info,
        message: text,
        span: None,
        refs,
        data: json!({
            "what": what,
            "value": quantity.value,
            "source": source,
            "tolerance": tolerance,
            "from": from,
            "to": to,
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dsl::parse;

    const FIXTURE_A: &str = include_str!("../../../../fixtures/lgh154-a.plan");

    fn messages(plan: &Plan) -> Vec<String> {
        unmeasured(plan).into_iter().map(|d| d.message).collect()
    }

    #[test]
    fn fixture_a_unmeasured() {
        let plan = parse(FIXTURE_A).expect("fixture A parses");
        assert_eq!(
            messages(&plan),
            vec![
                "Gap Hall east_of Garderob 121 mm has source drawing (±30 mm); measure Garderob.west to Hall.east with the laser.",
                "Gap Vardagsrum south_of WC 123 mm has source drawing (±30 mm); measure WC.north to Vardagsrum.south with the laser.",
                "Hall width 1100 mm has source assumed (±10 mm); measure Hall.west to Hall.east with the laser.",
            ]
        );
    }

    #[test]
    fn measured_gap_is_dropped() {
        let src = format!("{FIXTURE_A}\nmeasure Garderob.west to Hall.east = 3081 source laser\n");
        let plan = parse(&src).expect("fixture A plus a measure parses");
        assert_eq!(
            messages(&plan),
            vec![
                "Gap Vardagsrum south_of WC 123 mm has source drawing (±30 mm); measure WC.north to Vardagsrum.south with the laser.",
                "Hall width 1100 mm has source assumed (±10 mm); measure Hall.west to Hall.east with the laser.",
            ]
        );
    }
}
