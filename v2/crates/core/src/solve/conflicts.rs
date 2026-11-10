//! E003 for a conflicting cycle (spec §6.3, week-one §5.2).
//!
//! [`conflict_diagnostic`] turns one [`CycleCheck`] with `conflict == true` into
//! a [`Diagnostic`]. The sentence comes from [`message`]; the two chains are
//! read from the edge list the check was made on. Checks within tolerance give
//! `None` here; their W004 comes from [`adjusted_diagnostic`] once the residual
//! is distributed.

use serde_json::json;

use super::cycles::{ChainEdge, CycleCheck};
use super::distribute::AdjustedEdge;
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

    let (chain_b_label, measured) = stated_terms(stated);
    let mut args: Vec<(&str, String)> = vec![
        ("axis", axis_text(check.axis).to_string()),
        ("residual", check.residual.abs().to_string()),
        ("chain_a", chain_text(&chain_a)),
        ("implied", implied.to_string()),
        ("chain_b", chain_b_label),
        ("measured", measured),
        ("tolerance", check.tolerance.to_string()),
    ];
    let wall = wall_suggestion(&chain_a, check.residual);
    if let Some((from, to)) = wall {
        args.push(("wall_from", from.to_string()));
        args.push(("wall_to", to.to_string()));
    }

    let mut suggestions = vec![
        json!("mark a measurement as reference"),
        json!("correct a value"),
    ];
    if let Some((from, to)) = wall {
        suggestions.push(json!({"change_wall": {"from": from, "to": to}}));
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
            "suggestions": suggestions,
        }),
    })
}

/// The W004 diagnostic for one axis that distributed its within-tolerance
/// cycles (§6.2 step 6, §15 D6, D23), or `None` when every edge is drawn at its
/// stated value.
///
/// `adjusted` holds the edges that moved, in edge-index order. The list
/// argument gives each as `origin value→adjusted`, joined by `, `; `refs` are
/// the origins, and `data` has the axis and the same edges as `adjusted`.
pub fn adjusted_diagnostic(axis: Axis, adjusted: &[AdjustedEdge]) -> Option<Diagnostic> {
    if adjusted.is_empty() {
        return None;
    }
    let list: Vec<String> = adjusted
        .iter()
        .map(|a| format!("{} {}→{}", a.origin, a.value, a.adjusted))
        .collect();
    let args: Vec<(&str, String)> = vec![("list", list.join(", "))];
    let refs: Vec<String> = adjusted.iter().map(|a| a.origin.clone()).collect();
    let items: Vec<serde_json::Value> = adjusted
        .iter()
        .map(|a| json!({"origin": a.origin, "value": a.value, "adjusted": a.adjusted}))
        .collect();
    Some(Diagnostic {
        code: Code::W004,
        severity: Severity::Warning,
        message: message(Code::W004, &args),
        span: None,
        refs,
        data: json!({
            "axis": axis,
            "adjusted": items,
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

/// The stated edge for the third line of E003, as `(label, measured)`.
///
/// A `measure` edge reads `measure {from} → {to}` and `{value} ({source})`, with
/// `unknown` when the source is missing, so the line is §6.3's measure line.
/// Any other edge reads as its label without the value, and `measured` is its
/// value with its source in brackets when it has one.
fn stated_terms(edge: &Edge) -> (String, String) {
    if edge.origin.starts_with("measure ") {
        let label = format!(
            "measure {} → {}",
            face_text(&edge.from),
            face_text(&edge.to)
        );
        let source = edge.source.map_or("unknown", source_word);
        return (label, format!("{} ({source})", edge.value));
    }
    let label = edge
        .origin
        .strip_prefix("room ")
        .unwrap_or(&edge.origin)
        .to_string();
    let measured = edge.source.map_or_else(
        || edge.value.to_string(),
        |s| format!("{} ({})", edge.value, source_word(s)),
    );
    (label, measured)
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
    const FIXTURE_C: &str = include_str!("../../../../fixtures/lgh154-c.plan");

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
            "Conflict on the north–south axis: 50 mm.\n  Garderob depth 2360 (laser) + wall 90 (assumed) + Sovrum depth 2090 (laser) = 4540\n  measure Garderob.north → Sovrum.south = 4490 (laser)\n  Allowed difference: 19 mm.\n  Fix one of: mark a measurement as reference, correct a value, or change the wall (90 → 40 would fit)."
        );
        assert_eq!(diagnostic.refs, vec!["Garderob", "Sovrum"]);
        assert_eq!(diagnostic.data["axis"], "y");
        assert_eq!(diagnostic.data["residual"], -50);
        assert_eq!(diagnostic.data["tolerance"], 19);
        assert_eq!(diagnostic.data["chain_a"].as_array().map(Vec::len), Some(3));
        assert_eq!(diagnostic.data["chain_b"].as_array().map(Vec::len), Some(1));
    }

    #[test]
    fn fixture_b_e003_suggestions_array() {
        let (edge_list, found) = fixture_b_checks();
        let check = found
            .iter()
            .find(|c| c.conflict)
            .expect("fixture B conflicts");
        let diagnostic = conflict_diagnostic(check, &edge_list).expect("E003");
        assert_eq!(
            diagnostic.data["suggestions"],
            serde_json::json!([
                "mark a measurement as reference",
                "correct a value",
                {"change_wall": {"from": 90, "to": 40}}
            ])
        );
    }

    #[test]
    fn fixture_c_e003_third_line_names_the_align_edge() {
        let plan = parse(FIXTURE_C).expect("fixture C parses");
        let (edge_list, _) = edges(&plan);
        let (comps, _) = components(&edge_list, &plan, Axis::Y);
        let (coords, tree) = assign_coords(&edge_list, &comps, Axis::Y);
        let found = check_cycles(&edge_list, &coords, &tree, Axis::Y);
        let check = found
            .iter()
            .find(|c| c.conflict)
            .expect("fixture C conflicts");
        let diagnostic = conflict_diagnostic(check, &edge_list).expect("E003");
        assert_eq!(
            diagnostic.message.lines().nth(2),
            Some("  align south Sovrum Vardagsrum = 0")
        );
    }

    #[test]
    fn no_conflict_gives_no_e003() {
        let (edge_list, found) = fixture_b_checks();
        let mut check = found.into_iter().next().expect("fixture B has a cycle");
        check.conflict = false;
        assert_eq!(conflict_diagnostic(&check, &edge_list), None);
    }

    /// Resolves a synthetic plan: the fixture B cycle (Garderob depth, a 90 mm
    /// wall, Sovrum depth) closed by one measure of `measured` mm, on the
    /// north–south axis. Returns every diagnostic `resolve` gives.
    fn synthetic_diagnostics(measured: i64) -> Vec<Diagnostic> {
        let text = format!(
            r#"plan "W1-14 synthetic"
default_wall 90 source assumed
default_outer_wall 300 source assumed

room Garderob 1860 x 2360 source laser
room Sovrum 1860 x 2090 source laser
  south_of Garderob gap

measure Garderob.north to Sovrum.south = {measured} source laser
"#
        );
        let plan = parse(&text).expect("synthetic plan parses");
        let (_, diagnostics) = crate::resolved::resolve(&plan);
        diagnostics
    }

    #[test]
    fn within_tolerance_gives_w004_and_no_e003() {
        // The implied side is 4540 mm; 4530 leaves a residual of −10 mm.
        let diagnostics = synthetic_diagnostics(4530);
        assert_eq!(
            diagnostics.iter().filter(|d| d.code == Code::E003).count(),
            0,
            "{diagnostics:?}"
        );
        let w004: Vec<&Diagnostic> = diagnostics
            .iter()
            .filter(|d| d.code == Code::W004)
            .collect();
        assert_eq!(w004.len(), 1, "{diagnostics:?}");
        assert_eq!(w004[0].severity, Severity::Warning);
        assert_eq!(
            w004[0].message,
            "Adjusted to fit within tolerance: room Garderob depth 2360→2359, Sovrum south_of Garderob gap 90→82, measure Garderob.north to Sovrum.south 4530→4531."
        );
    }

    #[test]
    fn zero_residual_gives_no_w004() {
        // 4540 mm closes the cycle exactly.
        let diagnostics = synthetic_diagnostics(4540);
        assert!(
            diagnostics.iter().all(|d| d.code != Code::W004),
            "{diagnostics:?}"
        );
    }
}
