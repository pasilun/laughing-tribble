//! Spanning tree and coordinates per axis (spec §6.2 step 3, pseudo-code §5.1).
//!
//! For each component from [`components`](super::components::components), a
//! breadth-first search starts at the component's first face (the anchor when
//! the component holds it, since the anchor is the first registered face) and
//! assigns `coord(b) = coord(a) + value` along each edge it first reaches.
//! Edges not in the tree are left for the cycle check (W1-12); nothing is
//! checked here.

use std::collections::{BTreeMap, VecDeque};

use super::components::Component;
use super::graph::{Axis, Edge, FaceId};
use crate::intent::{RoomName, Side};
use crate::units::Mm;

/// A map key for one face: its room, and the side index (north 0, east 1,
/// south 2, west 3). `Side` has no `Ord`, so the index stands in for it.
pub type FaceKey = (RoomName, u8);

/// An edge of the spanning tree. `child` was first reached from `parent`
/// through `edges[edge]`, and `depth` is the child's distance from its root.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TreeEdge {
    /// Index of the edge in the slice given to [`assign_coords`].
    pub edge: usize,
    /// The face the search came from.
    pub parent: FaceKey,
    /// The face reached through the edge.
    pub child: FaceKey,
    /// Distance of `child` from its component's root (root is 0).
    pub depth: usize,
}

/// Assign a coordinate to every face of `components` on `axis`.
///
/// `edges` is the full edge list from [`edges`](super::graph::edges); edges on
/// the other axis are skipped. Returns the coordinate of every face, each
/// component's root at 0, and the tree edges in the order they were found
/// (components in the given order, BFS order within each). An edge of `axis`
/// that is not in the returned tree is a non-tree edge for the cycle check.
pub fn assign_coords(
    edges: &[Edge],
    components: &[Component],
    axis: Axis,
) -> (BTreeMap<FaceKey, Mm>, Vec<TreeEdge>) {
    // Adjacency in declaration order: edge (a→b, v) gives adj[a] += (i, b, v)
    // and adj[b] += (i, a, −v).
    let mut adj: BTreeMap<FaceKey, Vec<(usize, FaceKey, Mm)>> = BTreeMap::new();
    for (i, edge) in edges.iter().enumerate() {
        if edge.axis != axis {
            continue;
        }
        let from = key(&edge.from);
        let to = key(&edge.to);
        adj.entry(from.clone())
            .or_default()
            .push((i, to.clone(), edge.value));
        adj.entry(to).or_default().push((i, from, -edge.value));
    }

    let mut state = Search {
        coord: BTreeMap::new(),
        depth: BTreeMap::new(),
        order: Vec::new(),
        tree: Vec::new(),
    };

    // Pass 1: each component's root, then BFS over the non-measure edges only,
    // so the room sizes and relations form the tree wherever they can.
    for component in components {
        // Components list their faces in declaration order, so the first face
        // is the anchor for the anchored component and the first face otherwise.
        let Some(first) = component.faces.first() else {
            continue;
        };
        let root = key(first);
        if state.coord.contains_key(&root) {
            continue;
        }
        state.visit(root.clone(), 0, 0);
        state.grow(&adj, edges, vec![root], false);
    }

    // Pass 2: a measure becomes a tree edge only when it is needed to reach a
    // face that pass 1 could not. Every face reached so far is a seed.
    let seeds = state.order.clone();
    state.grow(&adj, edges, seeds, true);

    (state.coord, state.tree)
}

/// The search state shared by both passes of [`assign_coords`].
struct Search {
    /// Coordinate of every face reached so far.
    coord: BTreeMap<FaceKey, Mm>,
    /// Tree depth of every face reached so far.
    depth: BTreeMap<FaceKey, usize>,
    /// Faces in the order they were reached.
    order: Vec<FaceKey>,
    /// Tree edges in the order they were found.
    tree: Vec<TreeEdge>,
}

impl Search {
    /// Record `face` at coordinate `coord` and tree depth `depth`.
    fn visit(&mut self, face: FaceKey, coord: Mm, depth: usize) {
        self.coord.insert(face.clone(), coord);
        self.depth.insert(face.clone(), depth);
        self.order.push(face);
    }

    /// Breadth-first search from `seeds`, which already have coordinates.
    /// Measure edges are followed only when `measures` is true.
    fn grow(
        &mut self,
        adj: &BTreeMap<FaceKey, Vec<(usize, FaceKey, Mm)>>,
        edges: &[Edge],
        seeds: Vec<FaceKey>,
        measures: bool,
    ) {
        let mut queue: VecDeque<FaceKey> = seeds.into();
        while let Some(a) = queue.pop_front() {
            let (Some(&base), Some(&depth_a)) = (self.coord.get(&a), self.depth.get(&a)) else {
                continue;
            };
            let Some(neighbours) = adj.get(&a) else {
                continue;
            };
            for (i, b, v) in neighbours {
                if !measures && is_measure(edges, *i) {
                    continue;
                }
                if self.coord.contains_key(b) {
                    continue;
                }
                self.visit(b.clone(), base + v, depth_a + 1);
                self.tree.push(TreeEdge {
                    edge: *i,
                    parent: a.clone(),
                    child: b.clone(),
                    depth: depth_a + 1,
                });
                queue.push_back(b.clone());
            }
        }
    }
}

/// True for the edge of a `measure` statement, which has origin
/// `measure A.side to B.side`. Room sizes and relations never have
/// " to " in their origin.
fn is_measure(edges: &[Edge], i: usize) -> bool {
    edges
        .get(i)
        .is_some_and(|e| e.origin.starts_with("measure ") && e.origin.contains(" to "))
}

/// The map key of a face.
fn key(face: &FaceId) -> FaceKey {
    (face.room.clone(), side_index(face.side))
}

/// North 0, east 1, south 2, west 3.
fn side_index(side: Side) -> u8 {
    match side {
        Side::North => 0,
        Side::East => 1,
        Side::South => 2,
        Side::West => 3,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dsl::parse;
    use crate::intent::Plan;
    use crate::solve::components::components;
    use crate::solve::graph::edges;
    use serde_json::Value;

    const FIXTURE_A: &str = include_str!("../../../../fixtures/lgh154-a.plan");
    const EXPECTED_A: &str = include_str!("../../../../fixtures/lgh154-a.expected.json");

    fn name(text: &str) -> RoomName {
        RoomName::new(text).expect("valid room name")
    }

    fn fk(room: &str, side: Side) -> FaceKey {
        (name(room), side_index(side))
    }

    /// Run the whole pipeline up to the tree on one axis.
    fn solve(plan: &Plan, axis: Axis) -> (BTreeMap<FaceKey, Mm>, Vec<TreeEdge>, Vec<Edge>) {
        let (edge_list, _) = edges(plan);
        let (comps, _) = components(&edge_list, plan, axis);
        let (coord, tree) = assign_coords(&edge_list, &comps, axis);
        (coord, tree, edge_list)
    }

    fn coord_of(coord: &BTreeMap<FaceKey, Mm>, room: &str, side: Side) -> Mm {
        *coord
            .get(&fk(room, side))
            .unwrap_or_else(|| panic!("no coordinate for {room} {side:?}"))
    }

    #[test]
    fn fixture_a_faces_match_expected_table_on_both_axes() {
        let expected: Value = serde_json::from_str(EXPECTED_A).expect("expected JSON parses");
        let plan = parse(FIXTURE_A).expect("fixture A parses");
        let checks = [
            (Axis::X, [Side::West, Side::East]),
            (Axis::Y, [Side::North, Side::South]),
        ];
        for (axis, sides) in checks {
            let (coord, tree, edge_list) = solve(&plan, axis);
            for room in ["Garderob", "Sovrum", "Hall", "WC", "Vardagsrum"] {
                for side in sides {
                    let word = match side {
                        Side::North => "north",
                        Side::East => "east",
                        Side::South => "south",
                        Side::West => "west",
                    };
                    let want = expected["faces"][room][word]
                        .as_i64()
                        .expect("face in expected JSON");
                    assert_eq!(
                        coord_of(&coord, room, side),
                        want,
                        "{axis:?}: {room}.{word}"
                    );
                }
            }
            // Ten faces on each axis, connected: nine tree edges, and every
            // edge of this axis is a tree edge (fixture A has no measures).
            assert_eq!(coord.len(), 10, "{axis:?}");
            let on_axis = edge_list.iter().filter(|e| e.axis == axis).count();
            assert_eq!(tree.len(), 9, "{axis:?}");
            assert_eq!(on_axis, 9, "{axis:?}");
        }
    }

    #[test]
    fn chain_of_east_of_gaps_has_known_coordinates() {
        // B is 100 mm east of A, C is 50 mm east of B.
        let plan = parse(
            "room A 1000 x 2000\nroom B 1000 x 2000\n  east_of A gap 100\nroom C 1000 x 2000\n  east_of B gap 50\n",
        )
        .expect("parse");
        let (coord, tree, edge_list) = solve(&plan, Axis::X);
        assert_eq!(coord_of(&coord, "A", Side::West), 0);
        assert_eq!(coord_of(&coord, "A", Side::East), 1000);
        assert_eq!(coord_of(&coord, "B", Side::West), 1100);
        assert_eq!(coord_of(&coord, "B", Side::East), 2100);
        assert_eq!(coord_of(&coord, "C", Side::West), 2150);
        assert_eq!(coord_of(&coord, "C", Side::East), 3150);

        // The chain is a path: all five X edges are tree edges, and C.east is
        // five steps from the root.
        assert_eq!(tree.len(), 5);
        assert_eq!(edge_list.iter().filter(|e| e.axis == Axis::X).count(), 5);
        let last = tree
            .iter()
            .find(|t| t.child == fk("C", Side::East))
            .expect("C.east in tree");
        assert_eq!(last.depth, 5);
        assert_eq!(last.parent, fk("C", Side::West));
    }

    #[test]
    fn unanchored_component_starts_at_its_first_face_zero() {
        // A and B form the anchored component. C and D are tied to each other
        // only, so their component is loose on x and starts at C.west = 0.
        let plan = parse(
            "room A 1000 x 2000\nroom B 1000 x 2000\n  east_of A gap 100\nroom C 800 x 2000\nroom D 500 x 2000\n  east_of C gap 40\n",
        )
        .expect("parse");
        let (edge_list, _) = edges(&plan);
        let (comps, _) = components(&edge_list, &plan, Axis::X);
        assert_eq!(comps.len(), 2);
        assert!(comps[0].anchored);
        assert!(!comps[1].anchored);

        let (coord, tree) = assign_coords(&edge_list, &comps, Axis::X);
        assert_eq!(coord_of(&coord, "A", Side::West), 0);
        assert_eq!(coord_of(&coord, "B", Side::East), 2100);
        assert_eq!(coord_of(&coord, "C", Side::West), 0);
        assert_eq!(coord_of(&coord, "C", Side::East), 800);
        assert_eq!(coord_of(&coord, "D", Side::West), 840);
        assert_eq!(coord_of(&coord, "D", Side::East), 1340);
        // Four faces per component, three tree edges each (two widths and a gap).
        assert_eq!(tree.len(), 6);
    }
}
