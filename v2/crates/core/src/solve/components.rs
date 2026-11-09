//! Components of the face variables on one axis (spec §6.2 steps 1–2).
//!
//! Every declared room has both of its faces on the axis as variables, even
//! when no edge reaches them. Edges join faces, and union-find groups them.
//! The component holding the anchor (the first declared room's west face on
//! x, its north face on y) is fixed at 0. Every other component is
//! under-constrained and gets a W001 (§6.4). Only the text is made here; the
//! suggestion comes in a later card.

use std::collections::HashMap;

use serde_json::json;

use super::graph::{Axis, Edge, FaceId};
use crate::diagnostics::{Code, Diagnostic, Severity, message};
use crate::intent::{Plan, RoomName, Side};

/// A set of faces joined by edges on one axis.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Component {
    /// The faces, in declaration order.
    pub faces: Vec<FaceId>,
    /// The rooms owning those faces, in declaration order, without repeats.
    pub rooms: Vec<RoomName>,
    /// True when the component holds the anchor face and is fixed at 0.
    pub anchored: bool,
}

/// The connected components of `axis` for `plan`, and the W001 diagnostics
/// for the loose ones.
///
/// Components come out sorted by their first face in declaration order. Each
/// loose component gets one W001 that names its first room not yet reported;
/// a component whose rooms were all reported already (for example the second
/// face of a room with an unknown depth) gets none. Edges on the other axis
/// are ignored.
pub fn components(edges: &[Edge], plan: &Plan, axis: Axis) -> (Vec<Component>, Vec<Diagnostic>) {
    let mut nodes = Nodes::default();
    for name in &plan.order {
        if plan.rooms.contains_key(name) {
            for side in axis_sides(axis) {
                nodes.id(&FaceId {
                    room: name.clone(),
                    side,
                });
            }
        }
    }
    // The first registered face is the first declared room's first face on
    // this axis: west on x, north on y.
    let anchor = if nodes.faces.is_empty() {
        None
    } else {
        Some(0)
    };

    let pairs: Vec<(usize, usize)> = edges
        .iter()
        .filter(|edge| edge.axis == axis)
        .map(|edge| (nodes.id(&edge.from), nodes.id(&edge.to)))
        .collect();

    let mut parent: Vec<usize> = (0..nodes.faces.len()).collect();
    for (a, b) in pairs {
        union(&mut parent, a, b);
    }

    // Group the faces by root. Faces are visited in declaration order, so the
    // groups come out sorted by their first face.
    let mut groups: Vec<Vec<usize>> = Vec::new();
    let mut group_of_root: HashMap<usize, usize> = HashMap::new();
    for i in 0..nodes.faces.len() {
        let root = find(&mut parent, i);
        let group = *group_of_root.entry(root).or_insert_with(|| {
            groups.push(Vec::new());
            groups.len() - 1
        });
        if let Some(members) = groups.get_mut(group) {
            members.push(i);
        }
    }

    let mut out = Vec::with_capacity(groups.len());
    for members in groups {
        let faces: Vec<FaceId> = members
            .iter()
            .filter_map(|&i| nodes.faces.get(i).cloned())
            .collect();
        let mut rooms: Vec<RoomName> = Vec::new();
        for face in &faces {
            if !rooms.contains(&face.room) {
                rooms.push(face.room.clone());
            }
        }
        let anchored = anchor.is_some_and(|a| members.contains(&a));
        out.push(Component {
            faces,
            rooms,
            anchored,
        });
    }

    let mut diagnostics = Vec::new();
    let mut reported: Vec<RoomName> = Vec::new();
    for component in &out {
        if component.anchored {
            continue;
        }
        let fresh = component
            .rooms
            .iter()
            .find(|room| !reported.contains(room))
            .cloned();
        let Some(room) = fresh else {
            continue;
        };
        diagnostics.push(not_tied(axis, plan, &room, &component.rooms));
        reported.extend(component.rooms.iter().cloned());
    }

    (out, diagnostics)
}

/// The faces of one room on an axis, in declaration order: west then east on
/// x, north then south on y.
fn axis_sides(axis: Axis) -> [Side; 2] {
    match axis {
        Axis::X => [Side::West, Side::East],
        Axis::Y => [Side::North, Side::South],
    }
}

/// Node ids for face variables. Each distinct face gets one id, in the order
/// it is first seen.
#[derive(Default)]
struct Nodes {
    faces: Vec<FaceId>,
    index: HashMap<(RoomName, u8), usize>,
}

impl Nodes {
    /// The id of `face`, adding it if it is new.
    fn id(&mut self, face: &FaceId) -> usize {
        let key = (face.room.clone(), side_key(face.side));
        if let Some(&id) = self.index.get(&key) {
            return id;
        }
        let id = self.faces.len();
        self.faces.push(face.clone());
        self.index.insert(key, id);
        id
    }
}

/// A small number for each side, used as a hash key.
fn side_key(side: Side) -> u8 {
    match side {
        Side::North => 0,
        Side::East => 1,
        Side::South => 2,
        Side::West => 3,
    }
}

/// The root of `i`'s set, halving the path as it goes.
fn find(parent: &mut [usize], mut i: usize) -> usize {
    loop {
        let up = parent.get(i).copied().unwrap_or(i);
        if up == i {
            return i;
        }
        let grand = parent.get(up).copied().unwrap_or(up);
        if let Some(slot) = parent.get_mut(i) {
            *slot = grand;
        }
        i = grand;
    }
}

/// Join the sets of `a` and `b`. The smaller root wins, so the result does
/// not depend on anything but the input order.
fn union(parent: &mut [usize], a: usize, b: usize) {
    let ra = find(parent, a);
    let rb = find(parent, b);
    if ra == rb {
        return;
    }
    let (low, high) = if ra < rb { (ra, rb) } else { (rb, ra) };
    if let Some(slot) = parent.get_mut(high) {
        *slot = low;
    }
}

/// The W001 for a loose component, named after `room`. `rooms` lists every
/// room of the component for the refs.
///
/// A room with an unknown depth on y gets the depth-unknown wording (§6.4).
/// Any other loose component gets the "not tied" wording with only the room
/// and the axis word filled in; the measurement and relation arguments are
/// not known yet, so their placeholders stay visible.
fn not_tied(axis: Axis, plan: &Plan, room: &RoomName, rooms: &[RoomName]) -> Diagnostic {
    let axis_word = match axis {
        Axis::X => "east–west",
        Axis::Y => "north–south",
    };
    let depth_unknown = axis == Axis::Y
        && plan
            .rooms
            .get(room)
            .is_some_and(|declared| declared.depth.is_none());
    let text = if depth_unknown {
        message(
            Code::W001,
            &[
                ("room", room.as_str().to_string()),
                ("unknown_depth", "true".to_string()),
            ],
        )
    } else {
        message(
            Code::W001,
            &[
                ("axis", axis_word.to_string()),
                ("room", room.as_str().to_string()),
            ],
        )
    };
    let refs: Vec<String> = rooms.iter().map(|r| r.as_str().to_string()).collect();
    Diagnostic {
        code: Code::W001,
        severity: Severity::Warning,
        message: text,
        span: None,
        data: json!({
            "axis": axis_word,
            "room": room.as_str(),
            "rooms": refs,
        }),
        refs,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dsl::parse;
    use crate::solve::graph::edges;

    const FIXTURE_A: &str = include_str!("../../../../fixtures/lgh154-a.plan");

    fn names(components: &[Component]) -> Vec<Vec<String>> {
        components
            .iter()
            .map(|c| c.rooms.iter().map(|r| r.as_str().to_string()).collect())
            .collect()
    }

    #[test]
    fn loose_room_gets_one_w001_and_anchored_rooms_none() {
        let plan =
            parse("room A 1000 x 2000\nroom B 1000 x 2000\n  east_of A gap\nroom C 1000 x 2000\n")
                .expect("parse");
        let (edge_list, diagnostics) = edges(&plan);
        assert!(diagnostics.is_empty(), "{diagnostics:?}");

        let (got, diagnostics) = components(&edge_list, &plan, Axis::X);
        assert_eq!(names(&got), vec![vec!["A", "B"], vec!["C"]]);
        assert!(got[0].anchored);
        assert!(!got[1].anchored);
        assert_eq!(got[0].faces.len(), 4);

        assert_eq!(diagnostics.len(), 1, "{diagnostics:?}");
        let w001 = &diagnostics[0];
        assert_eq!(w001.code, Code::W001);
        assert_eq!(w001.severity, Severity::Warning);
        assert_eq!(w001.refs, vec!["C".to_string()]);
        assert_eq!(
            w001.message,
            r#"Not tied east–west: C. Measure from {from} to {to}, or add "C {relation} {of} gap {gap}"."#
        );
    }

    #[test]
    fn fixture_a_is_fully_anchored_on_both_axes() {
        let plan = parse(FIXTURE_A).expect("fixture A parses");
        let (edge_list, _) = edges(&plan);
        for axis in [Axis::X, Axis::Y] {
            let (got, diagnostics) = components(&edge_list, &plan, axis);
            assert!(diagnostics.is_empty(), "{axis:?}: {diagnostics:?}");
            assert_eq!(got.len(), 1, "{axis:?}: one component");
            assert!(got[0].anchored, "{axis:?}");
            assert_eq!(got[0].faces.len(), 10, "{axis:?}: five rooms, two faces");
        }
    }

    #[test]
    fn unknown_depth_room_is_loose_on_y_with_one_w001() {
        let plan = parse("room A 1000 x 2000\nroom B 1000 x ?\n  east_of A gap\n").expect("parse");
        let (edge_list, _) = edges(&plan);

        // On x, B is tied to A, so nothing is loose.
        let (_, diagnostics) = components(&edge_list, &plan, Axis::X);
        assert!(diagnostics.is_empty(), "{diagnostics:?}");

        // On y, B has no depth edge: its north and south faces are two loose
        // components, but the room gets one W001.
        let (got, diagnostics) = components(&edge_list, &plan, Axis::Y);
        assert_eq!(names(&got), vec![vec!["A"], vec!["B"], vec!["B"]]);
        assert!(got[0].anchored);
        assert!(!got[1].anchored && !got[2].anchored);

        assert_eq!(diagnostics.len(), 1, "{diagnostics:?}");
        assert_eq!(diagnostics[0].code, Code::W001);
        assert_eq!(diagnostics[0].refs, vec!["B".to_string()]);
        assert_eq!(
            diagnostics[0].message,
            "B depth unknown; measure B.north to B.south"
        );
    }
}
