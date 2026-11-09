//! E003 for a conflicting cycle (spec §6.3, week-one §5.2).
//!
//! [`conflict_diagnostic`] turns one [`CycleCheck`] with `conflict == true` into
//! a [`Diagnostic`]. The sentence comes from [`message`]; the two chains are
//! read from the edge list the check was made on. Checks within tolerance are
//! W1-14's job and give `None` here.

use serde_json::json;

use super::cycles::{ChainEdge, CycleCheck};
use super::graph::{Axis, Edge, FaceId};
use crate::diagnostics::{Code, Diagnostic, Severity, message};
use crate::intent::Side;
use crate::units::{Mm, Source};

/// The smallest wall, in mm, that the suggestion may propose (week-one §5.2).
const MIN_WALL_AFTER_CHANGE: Mm = 40;

/// The E003 diagnostic for a conflicting cycle, or `None` when the check does
/// not conflict or one of its edge indices is missing from `edges`.
///
/// `edges` must be the list the check was made on. The stated edge is chain B;
/// chain A is the implied side, walked from the stated edge's `from` to its `to`.
pub fn conflict_diagnostic(check: &CycleCheck, edges: &[Edge]) -> Option<Diagnostic> {
    if !check.conflict {
        return None;
    }
    let stated = edges.get(check.stated)?;
    let chain_a = resolve(&check.chain_a, edges)?;
    let chain_b = resolve(&check.chain_b, edges)?;

    let implied: Mm = chain_a
        .iter()
        .map(|(c, e)| i64::from(c.sign) * e.value)
        .sum();

    let mut args: Vec<(&str, String)> = vec![
        ("axis", axis_text(check.axis).to_string()),
        ("residual", check.residual.abs().to_string()),
        ("chain_a", chain_text(&chain_a)),
        ("implied", implied.to_string()),
        ("from", face_text(&stated.from)),
        ("to", face_text(&stated.to)),
        ("measured", stated.value.to_string()),
        (
            "measured_source",
            stated.source.map_or("unknown", source_word).to_string(),
        ),
        ("tolerance", check.tolerance.to_string()),
    ];
    if let Some((from, to)) = wall_suggestion(&chain_a, check.residual) {
        args.push(("wall_from", from.to_string()));
        args.push(("wall_to", to.to_string()));
    }

    let mut refs: Vec<String> = Vec::new();
    for (_, edge) in chain_a.iter().chain(chain_b.iter()) {
        for room in [&edge.from.room, &edge.to.room] {
            let name = room.to_string();
            if !refs.contains(&name) {
                refs.push(name);
            }
        }
    }

    Some(Diagnostic {
        code: Code::E003,
        severity: Severity::Error,
        message: message(Code::E003, &args),
        span: None,
        refs,
        data: json!({
            "axis": check.axis,
            "residual": check.residual,
            "tolerance": check.tolerance,
            "chain_a": chain_data(&chain_a),
            "chain_b": chain_data(&chain_b),
        }),
    })
}

/// Pair each chain step with its edge. `None` if an index is out of range.
fn resolve<'a>(
    chain: &'a [ChainEdge],
    edges: &'a [Edge],
) -> Option<Vec<(&'a ChainEdge, &'a Edge)>> {
    chain
        .iter()
        .map(|c| Some((c, edges.get(c.edge)?)))
        .collect()
}

/// Chain A as `label value (source)` terms, joined by ` + ` or ` − `.
/// A step walked against its edge subtracts its value.
fn chain_text(chain: &[(&ChainEdge, &Edge)]) -> String {
    let mut text = String::new();
    for (i, (step, edge)) in chain.iter().enumerate() {
        let negative = step.sign < 0;
        if i == 0 {
            if negative {
                text.push('−');
            }
        } else {
            text.push_str(if negative { " − " } else { " + " });
        }
        text.push_str(&term(edge));
    }
    text
}

/// One term of a chain: the label, the value and the source in brackets.
fn term(edge: &Edge) -> String {
    let label = if is_wall(edge) {
        "wall".to_string()
    } else {
        edge.origin
            .strip_prefix("room ")
            .unwrap_or(&edge.origin)
            .to_string()
    };
    let source = edge
        .source
        .map_or_else(String::new, |s| format!(" ({})", source_word(s)));
    format!("{label} {}{source}", edge.value)
}

/// A wall gap: a relation whose value came from a stated gap (not `open`).
fn is_wall(edge: &Edge) -> bool {
    edge.origin.ends_with(" gap") && edge.source.is_some()
}

/// The wall to change, as `(from, to)`, when chain A holds exactly one wall and
/// the wall would still be at least [`MIN_WALL_AFTER_CHANGE`] after the change.
///
/// The change is the one that closes the residual: `residual` is stated minus
/// implied, and a wall walked +1 on chain A moves the implied side by its own
/// amount, so the new wall is `wall + sign · residual`. For the fixture B case
/// (residual −50, wall walked +1) this is 90 → 40.
fn wall_suggestion(chain: &[(&ChainEdge, &Edge)], residual: Mm) -> Option<(Mm, Mm)> {
    let mut walls = chain.iter().filter(|(_, edge)| is_wall(edge));
    let (step, wall) = walls.next()?;
    if walls.next().is_some() {
        return None;
    }
    let to = wall.value + i64::from(step.sign) * residual;
    (to >= MIN_WALL_AFTER_CHANGE).then_some((wall.value, to))
}

/// The structured form of a chain for `Diagnostic.data`.
fn chain_data(chain: &[(&ChainEdge, &Edge)]) -> serde_json::Value {
    chain
        .iter()
        .map(|(step, edge)| {
            json!({
                "edge": step.edge,
                "sign": step.sign,
                "origin": edge.origin,
                "value": edge.value,
                "source": edge.source.map(source_word),
            })
        })
        .collect::<Vec<_>>()
        .into()
}

/// The axis as the spec words it.
fn axis_text(axis: Axis) -> &'static str {
    match axis {
        Axis::X => "east–west",
        Axis::Y => "north–south",
    }
}

/// A source as written in the text, for example `laser`.
fn source_word(source: Source) -> &'static str {
    match source {
        Source::Laser => "laser",
        Source::Tape => "tape",
        Source::Printed => "printed",
        Source::Drawing => "drawing",
        Source::Estimated => "estimated",
        Source::Assumed => "assumed",
    }
}

/// A face as written in the DSL, for example `Garderob.north`.
fn face_text(face: &FaceId) -> String {
    let side = match face.side {
        Side::North => "north",
        Side::East => "east",
        Side::South => "south",
        Side::West => "west",
    };
    format!("{}.{side}", face.room)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dsl::parse;
    use crate::solve::components::components;
    use crate::solve::cycles::check_cycles;
    use crate::solve::graph::edges;
    use crate::solve::tree::assign_coords;

    const FIXTURE_B: &str = include_str!("../../../../fixtures/lgh154-b.plan");

    /// The cycle checks of fixture B on the north–south axis, with their edges.
    fn fixture_b_checks() -> (Vec<Edge>, Vec<CycleCheck>) {
        let plan = parse(FIXTURE_B).expect("fixture B parses");
        let (edge_list, _) = edges(&plan);
        let (comps, _) = components(&edge_list, &plan, Axis::Y);
        let (coords, tree) = assign_coords(&edge_list, &comps, Axis::Y);
        let found = check_cycles(&edge_list, &coords, &tree, Axis::Y);
        (edge_list, found)
    }

    #[test]
    fn fixture_b_e003_exact_text() {
        let (edge_list, found) = fixture_b_checks();
        let check = found
            .iter()
            .find(|c| c.conflict)
            .expect("fixture B conflicts");
        let diagnostic = conflict_diagnostic(check, &edge_list).expect("E003");
        assert_eq!(diagnostic.code, Code::E003);
        assert_eq!(diagnostic.severity, Severity::Error);
        assert_eq!(diagnostic.span, None);
        assert_eq!(
            diagnostic.message,
            "E003 Conflict on the north–south axis: 50 mm.\n  Garderob depth 2360 (laser) + wall 90 (assumed) + Sovrum depth 2090 (laser) = 4540\n  measure Garderob.north → Sovrum.south = 4490 (laser)\n  Allowed difference: 19 mm.\n  Fix one of: mark a measurement as reference, correct a value, or change the wall (90 → 40 would fit)."
        );
        assert_eq!(diagnostic.refs, vec!["Garderob", "Sovrum"]);
        assert_eq!(diagnostic.data["axis"], "y");
        assert_eq!(diagnostic.data["residual"], -50);
        assert_eq!(diagnostic.data["tolerance"], 19);
        assert_eq!(diagnostic.data["chain_a"].as_array().map(Vec::len), Some(3));
        assert_eq!(diagnostic.data["chain_b"].as_array().map(Vec::len), Some(1));
    }

    #[test]
    fn no_conflict_gives_no_e003() {
        let (edge_list, found) = fixture_b_checks();
        let mut check = found.into_iter().next().expect("fixture B has a cycle");
        check.conflict = false;
        assert_eq!(conflict_diagnostic(&check, &edge_list), None);
    }
}
