//! Cycle check (spec §6.2 step 4, decision D1 in §15).
//!
//! Every edge of an axis that is not in the spanning tree closes a loop with
//! the tree. The loop's signed sum `L` gives the residual: the stated value
//! minus the value implied by the rest of the loop. The stated edge is the one
//! with the highest index in the edge list, the latest-declared statement.
//! Nothing is reported here as a diagnostic; W1-13 and W1-14 do that.

use std::collections::{BTreeMap, BTreeSet};

use super::graph::{Axis, Edge, FaceId};
use super::tree::{FaceKey, TreeEdge};
use crate::intent::Side;
use crate::units::Mm;

/// One edge of a chain: the edge index and the direction it is walked
/// (+1 from `from` to `to`, −1 against it).
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
pub struct ChainEdge {
    /// Index of the edge in the edge list.
    pub edge: usize,
    /// +1 when walked from `from` to `to`, −1 when walked against it.
    pub sign: i8,
}

/// One cycle closed by a non-tree edge.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
pub struct CycleCheck {
    /// The axis of the cycle.
    pub axis: Axis,
    /// Index of the stated edge (highest index in the cycle).
    pub stated: usize,
    /// Stated value minus implied value, in mm.
    pub residual: Mm,
    /// Sum of the tolerances of every edge in the cycle, in mm.
    pub tolerance: Mm,
    /// The implied side, walked from `stated.from` to `stated.to`.
    pub chain_a: Vec<ChainEdge>,
    /// The stated edge itself: `[ChainEdge { edge: stated, sign: 1 }]`.
    pub chain_b: Vec<ChainEdge>,
    /// True when `|residual|` is more than `tolerance`.
    pub conflict: bool,
}

/// Check every non-tree edge of `axis`, in edge-index order.
///
/// `coords` and `tree` are the output of [`assign_coords`](super::tree::assign_coords)
/// for the same `edges` and `axis`.
pub fn check_cycles(
    edges: &[Edge],
    coords: &BTreeMap<FaceKey, Mm>,
    tree: &[TreeEdge],
    axis: Axis,
) -> Vec<CycleCheck> {
    let tree_set: BTreeSet<usize> = tree.iter().map(|t| t.edge).collect();
    let walker = TreeWalker::new(edges, tree);
    let mut out = Vec::new();

    for (i, edge) in edges.iter().enumerate() {
        if edge.axis != axis || tree_set.contains(&i) {
            continue;
        }
        let a = key(&edge.from);
        let b = key(&edge.to);
        let (Some(&coord_a), Some(&coord_b)) = (coords.get(&a), coords.get(&b)) else {
            continue;
        };
        // Both faces are reached by the same spanning tree, so the path exists.
        // If it somehow does not, this edge is left out rather than panicking.
        let Some(mut loop_edges) = walker.tree_path(&a, &b) else {
            continue;
        };
        // Walk edge i backwards: it runs from b to a.
        loop_edges.push(ChainEdge { edge: i, sign: -1 });

        // Signed sum around the loop: coord(b) − coord(a) − value.
        let l = (coord_b - coord_a) - edge.value;

        let Some((k, stated)) = loop_edges.iter().enumerate().max_by_key(|(_, c)| c.edge) else {
            continue;
        };
        let residual = i64::from(stated.sign) * l;
        let tolerance: Mm = loop_edges
            .iter()
            .filter_map(|c| edges.get(c.edge))
            .map(|e| e.tolerance)
            .sum();
        let chain_a = build_chain_a(&loop_edges, k, stated);
        let stated_edge = stated.edge;
        let chain_b = vec![ChainEdge {
            edge: stated_edge,
            sign: 1,
        }];
        out.push(CycleCheck {
            axis,
            stated: stated_edge,
            residual,
            tolerance,
            chain_a,
            chain_b,
            conflict: residual.abs() > tolerance,
        });
    }

    out
}

/// The implied side of a loop, walked from the stated edge's `from` to its `to`.
///
/// `loop_edges` holds the stated edge at position `k`. Rotating it to the front
/// gives `[s, c1, …, ck]`. If `s` is walked +1, the rest runs from `s.to` back to
/// `s.from`, so it is reversed and each sign negated. If `s` is walked −1, the
/// rest already runs from `s.from` to `s.to`, so it is kept as it is.
fn build_chain_a(loop_edges: &[ChainEdge], k: usize, stated: &ChainEdge) -> Vec<ChainEdge> {
    let rest: Vec<ChainEdge> = loop_edges
        .iter()
        .cycle()
        .skip(k + 1)
        .take(loop_edges.len().saturating_sub(1))
        .cloned()
        .collect();
    if stated.sign == 1 {
        rest.into_iter()
            .rev()
            .map(|c| ChainEdge {
                edge: c.edge,
                sign: -c.sign,
            })
            .collect()
    } else {
        rest
    }
}

/// The spanning tree as lookups: each face's parent and the tree edge to it,
/// and each face's depth (roots are 0).
struct TreeWalker<'a> {
    edges: &'a [Edge],
    parent: BTreeMap<FaceKey, (FaceKey, usize)>,
    depth: BTreeMap<FaceKey, usize>,
}

impl<'a> TreeWalker<'a> {
    fn new(edges: &'a [Edge], tree: &[TreeEdge]) -> Self {
        let mut parent = BTreeMap::new();
        let mut depth = BTreeMap::new();
        for t in tree {
            parent.insert(t.child.clone(), (t.parent.clone(), t.edge));
            depth.insert(t.child.clone(), t.depth);
        }
        Self {
            edges,
            parent,
            depth,
        }
    }

    fn depth_of(&self, face: &FaceKey) -> usize {
        self.depth.get(face).copied().unwrap_or(0)
    }

    /// The step through tree edge `edge`, walked from the face `walk_from`.
    fn step(&self, edge: usize, walk_from: &FaceKey) -> Option<ChainEdge> {
        let e = self.edges.get(edge)?;
        let sign = if key(&e.from) == *walk_from { 1 } else { -1 };
        Some(ChainEdge { edge, sign })
    }

    /// The tree path from `a` to `b`: up from `a` to the lowest common
    /// ancestor, then down to `b`. Each step carries the direction it is walked.
    fn tree_path(&self, a: &FaceKey, b: &FaceKey) -> Option<Vec<ChainEdge>> {
        let mut up = Vec::new();
        let mut down = Vec::new();
        let mut x = a.clone();
        let mut y = b.clone();

        while self.depth_of(&x) > self.depth_of(&y) {
            let (p, e) = self.parent.get(&x)?.clone();
            up.push(self.step(e, &x)?);
            x = p;
        }
        while self.depth_of(&y) > self.depth_of(&x) {
            let (p, e) = self.parent.get(&y)?.clone();
            down.push(self.step(e, &p)?);
            y = p;
        }
        while x != y {
            let (px, ex) = self.parent.get(&x)?.clone();
            up.push(self.step(ex, &x)?);
            x = px;
            let (py, ey) = self.parent.get(&y)?.clone();
            down.push(self.step(ey, &py)?);
            y = py;
        }

        down.reverse();
        up.extend(down);
        Some(up)
    }
}

/// The map key of a face: its room and side index (north 0, east 1, south 2, west 3).
fn key(face: &FaceId) -> FaceKey {
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

    /// Run the pipeline up to the cycle check on one axis.
    fn run(text: &str, axis: Axis) -> (Vec<Edge>, Vec<CycleCheck>) {
        let plan = parse(text).expect("fixture parses");
        let (edge_list, _) = edges(&plan);
        let (comps, _) = components(&edge_list, &plan, axis);
        let (coords, tree) = assign_coords(&edge_list, &comps, axis);
        let found = check_cycles(&edge_list, &coords, &tree, axis);
        (edge_list, found)
    }

    /// The index of the edge with exactly this origin.
    fn index_of(edge_list: &[Edge], origin: &str) -> usize {
        edge_list
            .iter()
            .position(|e| e.origin == origin)
            .unwrap_or_else(|| panic!("no edge with origin {origin}"))
    }

    /// The origin and sign of each step in a chain.
    fn chain_text(edge_list: &[Edge], chain: &[ChainEdge]) -> Vec<(String, i8)> {
        chain
            .iter()
            .map(|c| {
                let origin = edge_list
                    .get(c.edge)
                    .unwrap_or_else(|| panic!("no edge {}", c.edge))
                    .origin
                    .clone();
                (origin, c.sign)
            })
            .collect()
    }

    fn text(items: &[(&str, i8)]) -> Vec<(String, i8)> {
        items.iter().map(|(s, n)| ((*s).to_string(), *n)).collect()
    }

    #[test]
    fn fixture_b_cycle() {
        let (edge_list, found) = run(FIXTURE_B, Axis::Y);
        assert_eq!(found.len(), 1, "{found:?}");
        let check = &found[0];
        let stated = index_of(&edge_list, "measure Garderob.north to Sovrum.south");
        assert_eq!(check.axis, Axis::Y);
        assert_eq!(check.stated, stated);
        assert_eq!(check.residual, -50);
        assert_eq!(check.tolerance, 19);
        assert!(check.conflict);
        assert_eq!(
            check.chain_b,
            vec![ChainEdge {
                edge: stated,
                sign: 1
            }]
        );
        assert_eq!(
            chain_text(&edge_list, &check.chain_a),
            text(&[
                ("room Garderob depth", 1),
                ("Sovrum south_of Garderob gap", 1),
                ("room Sovrum depth", 1),
            ])
        );
    }

    #[test]
    fn fixture_c_cycle() {
        let (edge_list, found) = run(FIXTURE_C, Axis::Y);
        let conflicts: Vec<&CycleCheck> = found.iter().filter(|c| c.conflict).collect();
        assert_eq!(conflicts.len(), 1, "{found:?}");
        assert_eq!(found.len(), 1, "{found:?}");
        let check = conflicts[0];
        let stated = index_of(&edge_list, "align south Sovrum Vardagsrum");
        assert_eq!(check.axis, Axis::Y);
        assert_eq!(check.stated, stated);
        assert_eq!(check.residual, -53);
        assert_eq!(check.tolerance, 52);
        assert!(check.conflict);
        assert_eq!(
            check.chain_b,
            vec![ChainEdge {
                edge: stated,
                sign: 1
            }]
        );
    }

    #[test]
    fn fixture_a_no_cycles() {
        let (_, on_y) = run(FIXTURE_A, Axis::Y);
        let (_, on_x) = run(FIXTURE_A, Axis::X);
        assert!(on_y.is_empty(), "{on_y:?}");
        assert!(on_x.is_empty(), "{on_x:?}");
    }
}
