//! Cycle check on one axis (spec §6.2 step 4, pseudo-code §5.2).
//!
//! Every edge of the axis that is not in the spanning tree closes a cycle with
//! the tree path between its two faces. The residual is the stated value minus
//! the difference the coordinates give. A residual beyond the cycle tolerance
//! is a conflict (E003). A smaller non-zero residual is reported as W004. Only
//! the diagnostic data is made here; the E003 text comes in a later card, so
//! `message` is left empty.

use std::collections::BTreeMap;

use serde_json::{Value, json};

use super::graph::{Axis, Edge, FaceId};
use super::tree::{FaceKey, TreeEdge};
use crate::diagnostics::{Code, Diagnostic, Severity};
use crate::intent::{RoomName, Side};
use crate::units::Mm;

/// One edge of a cycle, walked in one direction.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Step {
    /// Index into the edge slice.
    edge: usize,
    /// True when walked from `edge.from` to `edge.to`.
    forward: bool,
}

/// Check every non-tree edge of `axis` against the tree path between its
/// faces (spec §6.2 step 4).
///
/// `edges` is the full edge list, `tree` and `coords` come from
/// [`assign_coords`](super::tree::assign_coords) for the same axis. Returns one
/// diagnostic per non-tree edge that is either a conflict or an adjustment:
///
/// - E003 (error) when `|residual| > cycle_tolerance`. `data` holds `axis`
///   (`"x"` or `"y"`), `residual`, `tolerance` (the cycle tolerance),
///   `chain_a` (the tree path from the edge's `from` face to its `to` face,
///   the implied side) and `chain_b` (the edge itself, the stated side).
/// - W004 (warning) when the residual is non-zero but within the tolerance.
///   `data` holds `axis`, `edges` (the path plus the edge itself) and
///   `residual`.
///
/// Each chain entry is an object with `edge` (index), `origin`, `from` and
/// `to` (face text such as `Garderob.north`, in walking order), `value` and
/// `tolerance`, where `value` is signed for the walking direction.
///
/// Edges whose faces have no coordinate or no tree path are skipped; a
/// well-formed tree never produces that.
pub fn check_cycles(
    edges: &[Edge],
    tree: &[TreeEdge],
    coords: &BTreeMap<FaceKey, Mm>,
    axis: Axis,
) -> Vec<Diagnostic> {
    let mut is_tree = vec![false; edges.len()];
    for t in tree {
        if let Some(slot) = is_tree.get_mut(t.edge) {
            *slot = true;
        }
    }
    let parent_of: BTreeMap<FaceKey, &TreeEdge> =
        tree.iter().map(|t| (t.child.clone(), t)).collect();

    let mut out = Vec::new();
    for (i, edge) in edges.iter().enumerate() {
        if edge.axis != axis || is_tree.get(i).copied().unwrap_or(false) {
            continue;
        }
        let a = face_key(&edge.from);
        let b = face_key(&edge.to);
        let (Some(&coord_a), Some(&coord_b)) = (coords.get(&a), coords.get(&b)) else {
            continue;
        };
        let Some(path) = tree_path(edges, &parent_of, &a, &b) else {
            continue;
        };

        let residual = edge.value.saturating_sub(coord_b.saturating_sub(coord_a));
        let cycle_tol = path.iter().fold(edge.tolerance, |sum, step| {
            sum.saturating_add(edges.get(step.edge).map_or(0, |e| e.tolerance))
        });
        let stated = Step {
            edge: i,
            forward: true,
        };

        let mut cycle = path.clone();
        cycle.push(stated);
        let refs = rooms_of(edges, &cycle);

        if residual.saturating_abs() > cycle_tol {
            out.push(Diagnostic {
                code: Code::E003,
                severity: Severity::Error,
                message: String::new(),
                span: None,
                refs,
                data: json!({
                    "axis": axis_name(axis),
                    "residual": residual,
                    "tolerance": cycle_tol,
                    "chain_a": steps_json(edges, &path),
                    "chain_b": steps_json(edges, &[stated]),
                }),
            });
        } else if residual != 0 {
            out.push(Diagnostic {
                code: Code::W004,
                severity: Severity::Warning,
                message: String::new(),
                span: None,
                refs,
                data: json!({
                    "axis": axis_name(axis),
                    "edges": steps_json(edges, &cycle),
                    "residual": residual,
                }),
            });
        }
    }
    out
}

/// The tree path from `a` to `b` as steps in walking order: up from `a` to
/// the lowest common ancestor, then down to `b`. `None` when the two faces are
/// not in the same tree.
fn tree_path(
    edges: &[Edge],
    parent_of: &BTreeMap<FaceKey, &TreeEdge>,
    a: &FaceKey,
    b: &FaceKey,
) -> Option<Vec<Step>> {
    let depth = |key: &FaceKey| parent_of.get(key).map_or(0, |t| t.depth);
    let mut up_a = Vec::new();
    let mut up_b = Vec::new();
    let mut x = a.clone();
    let mut y = b.clone();
    while x != y {
        match (parent_of.get(&x).copied(), parent_of.get(&y).copied()) {
            (Some(tx), Some(_)) if depth(&x) >= depth(&y) => {
                up_a.push(climb(edges, &x, tx)?);
                x = tx.parent.clone();
            }
            (_, Some(ty)) => {
                up_b.push(climb(edges, &y, ty)?);
                y = ty.parent.clone();
            }
            (Some(tx), None) => {
                up_a.push(climb(edges, &x, tx)?);
                x = tx.parent.clone();
            }
            (None, None) => return None,
        }
    }
    // The walk from b upward is reversed and each step runs the other way.
    let mut path = up_a;
    path.extend(up_b.into_iter().rev().map(|step| Step {
        forward: !step.forward,
        ..step
    }));
    Some(path)
}

/// The step that walks the tree edge `t` up from `child` to its parent.
fn climb(edges: &[Edge], child: &FaceKey, t: &TreeEdge) -> Option<Step> {
    let edge = edges.get(t.edge)?;
    Some(Step {
        edge: t.edge,
        forward: face_key(&edge.from) == *child,
    })
}

/// The rooms touched by `steps`, in first-seen order, without repeats.
fn rooms_of(edges: &[Edge], steps: &[Step]) -> Vec<String> {
    let mut rooms: Vec<RoomName> = Vec::new();
    for step in steps {
        let Some(edge) = edges.get(step.edge) else {
            continue;
        };
        for face in [&edge.from, &edge.to] {
            if !rooms.contains(&face.room) {
                rooms.push(face.room.clone());
            }
        }
    }
    rooms.iter().map(|r| r.as_str().to_string()).collect()
}

/// The JSON chain entries for `steps`, in order.
fn steps_json(edges: &[Edge], steps: &[Step]) -> Value {
    let entries: Vec<Value> = steps
        .iter()
        .filter_map(|step| {
            let edge = edges.get(step.edge)?;
            let (from, to, value) = if step.forward {
                (&edge.from, &edge.to, edge.value)
            } else {
                (&edge.to, &edge.from, edge.value.saturating_neg())
            };
            Some(json!({
                "edge": step.edge,
                "origin": edge.origin,
                "from": face_text(from),
                "to": face_text(to),
                "value": value,
                "tolerance": edge.tolerance,
            }))
        })
        .collect();
    Value::Array(entries)
}

/// The axis word used in the data: `"x"` or `"y"`.
fn axis_name(axis: Axis) -> &'static str {
    match axis {
        Axis::X => "x",
        Axis::Y => "y",
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
    format!("{}.{side}", face.room.as_str())
}

/// The map key of a face, the same as in the tree module.
fn face_key(face: &FaceId) -> FaceKey {
    let index = match face.side {
        Side::North => 0,
        Side::East => 1,
        Side::South => 2,
        Side::West => 3,
    };
    (face.room.clone(), index)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dsl::parse;
    use crate::solve::components::components;
    use crate::solve::graph::edges;
    use crate::solve::tree::assign_coords;

    const FIXTURE_A: &str = include_str!("../../../../fixtures/lgh154-a.plan");
    const FIXTURE_B: &str = include_str!("../../../../fixtures/lgh154-b.plan");
    const FIXTURE_C: &str = include_str!("../../../../fixtures/lgh154-c.plan");

    /// Run the whole pipeline up to the cycle check on one axis.
    fn check(text: &str, axis: Axis) -> Vec<Diagnostic> {
        let plan = parse(text).expect("plan parses");
        let (edge_list, _) = edges(&plan);
        let (comps, _) = components(&edge_list, &plan, axis);
        let (coord, tree) = assign_coords(&edge_list, &comps, axis);
        check_cycles(&edge_list, &tree, &coord, axis)
    }

    fn int(value: &Value, key: &str) -> i64 {
        value[key]
            .as_i64()
            .unwrap_or_else(|| panic!("integer field {key}"))
    }

    #[test]
    fn fixture_a_has_no_cycle_issues() {
        for axis in [Axis::X, Axis::Y] {
            let got = check(FIXTURE_A, axis);
            assert!(got.is_empty(), "{axis:?}: {got:?}");
        }
    }

    #[test]
    fn fixture_b_is_e003_with_tolerance_19_and_residual_50() {
        assert!(check(FIXTURE_B, Axis::X).is_empty());
        let got = check(FIXTURE_B, Axis::Y);
        assert_eq!(got.len(), 1, "{got:?}");
        let e003 = &got[0];
        assert_eq!(e003.code, Code::E003);
        assert_eq!(e003.severity, Severity::Error);
        assert_eq!(e003.span, None);
        assert_eq!(e003.message, "");
        assert_eq!(e003.refs, vec!["Garderob", "Sovrum"]);
        assert_eq!(e003.data["axis"], "y");
        assert_eq!(int(&e003.data, "tolerance"), 19);

        // The measure is a tree edge here (the BFS reaches Sovrum.south
        // straight from Garderob.north), so the non-tree edge is Sovrum's depth.
        // The sign follows `v − (coord[b] − coord[a])` on that edge: 2090 −
        // (4490 − 2450) = +50. The spec's −50 is measure-based; see the report.
        assert_eq!(int(&e003.data, "residual"), 50);

        let chain_b = e003.data["chain_b"].as_array().expect("chain_b");
        assert_eq!(chain_b.len(), 1);
        assert_eq!(chain_b[0]["origin"], "room Sovrum depth");
        assert_eq!(chain_b[0]["from"], "Sovrum.north");
        assert_eq!(chain_b[0]["to"], "Sovrum.south");
        assert_eq!(int(&chain_b[0], "value"), 2090);

        // The implied side walks Sovrum.north → Garderob.south → Garderob.north
        // → Sovrum.south: −90 − 2360 + 4490 = 2040.
        let chain_a = e003.data["chain_a"].as_array().expect("chain_a");
        assert_eq!(chain_a.len(), 3);
        assert_eq!(chain_a[0]["from"], "Sovrum.north");
        assert_eq!(chain_a[2]["to"], "Sovrum.south");
        let implied: i64 = chain_a.iter().map(|s| int(s, "value")).sum();
        assert_eq!(implied, 2040);
        assert_eq!(2090 - implied, int(&e003.data, "residual"));
    }

    #[test]
    fn fixture_c_is_e003_with_tolerance_52_and_residual_53() {
        let got = check(FIXTURE_C, Axis::Y);
        assert_eq!(got.len(), 1, "{got:?}");
        let e003 = &got[0];
        assert_eq!(e003.code, Code::E003);
        assert_eq!(e003.data["axis"], "y");
        assert_eq!(int(&e003.data, "tolerance"), 52);
        // Non-tree edge: Vardagsrum depth (V.north → V.south, 3480). Implied
        // 4540 − 1113 = 3427 along the tree, so 3480 − 3427 = +53 (the JSON
        // says −53; see the report).
        assert_eq!(int(&e003.data, "residual"), 53);
        let chain_b = e003.data["chain_b"].as_array().expect("chain_b");
        assert_eq!(chain_b.len(), 1);
        assert_eq!(chain_b[0]["origin"], "room Vardagsrum depth");
        let chain_a = e003.data["chain_a"].as_array().expect("chain_a");
        assert_eq!(chain_a.len(), 8);
        let implied: i64 = chain_a.iter().map(|s| int(s, "value")).sum();
        assert_eq!(implied, 3427);
    }

    /// Room A (2000 deep), room B 90 mm south of it (2000 deep), and a measure
    /// from A.north to B.south. The tree gives B.south = 4090 when the measure
    /// is 4090; `measured` replaces it. Cycle tolerance on the B depth edge:
    /// 3 (depth) + 3 + 3 + 3 (gap, A depth, measure) = 12.
    fn two_rooms_with_measure(measured: i64) -> String {
        format!(
            "room A 1000 x 2000 source laser\nroom B 1000 x 2000 source laser\n  south_of A gap 90 source laser\nmeasure A.north to B.south = {measured} source laser\n"
        )
    }

    #[test]
    fn small_residual_within_tolerance_is_w004() {
        // The measure is a tree edge (A.north → B.south), so the non-tree edge
        // is B's depth: 2000 − (4095 − 2090) = −5, within 12.
        let got = check(&two_rooms_with_measure(4095), Axis::Y);
        assert_eq!(got.len(), 1, "{got:?}");
        let w004 = &got[0];
        assert_eq!(w004.code, Code::W004);
        assert_eq!(w004.severity, Severity::Warning);
        assert_eq!(w004.message, "");
        assert_eq!(int(&w004.data, "residual"), -5);
        let cycle = w004.data["edges"].as_array().expect("edges");
        assert_eq!(cycle.len(), 4, "three path edges plus the non-tree edge");
        assert_eq!(cycle[3]["origin"], "room B depth");
    }

    #[test]
    fn residual_beyond_tolerance_is_e003_on_synthetic_plan() {
        // 2000 − (4110 − 2090) = −20 against a cycle tolerance of 12.
        let got = check(&two_rooms_with_measure(4110), Axis::Y);
        assert_eq!(got.len(), 1, "{got:?}");
        assert_eq!(got[0].code, Code::E003);
        assert_eq!(int(&got[0].data, "residual"), -20);
        assert_eq!(int(&got[0].data, "tolerance"), 12);
    }
}
