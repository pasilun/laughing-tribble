//! Components of the face variables on one axis (spec §6.2 steps 1–2).
//!
//! Every declared room has both of its faces on the axis as variables, even
//! when no edge reaches them. Edges join faces, and union-find groups them.
//! The component holding the anchor (the first declared room's west face on
//! x, its north face on y) is fixed at 0. Every other component is
//! under-constrained and gets a W001 (§6.4). [`components`] makes the W001
//! text with its measurement arguments left as placeholders, so the solver's
//! own output does not change. [`suggested_w001`] fills those arguments with
//! the best candidate measurement (decision D5).

use std::collections::HashMap;

use serde_json::json;

use super::graph::{Axis, Edge, FaceId};
use super::tree::assign_coords;
use crate::diagnostics::{Code, Diagnostic, Severity, message};
use crate::intent::{Plan, RoomName, Side};
use crate::units::Mm;

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

/// Which side of the anchored room the loose room goes (D5).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Direction {
    /// The loose room is east of the anchored one (south on y).
    After,
    /// The loose room is west of the anchored one (north on y).
    Before,
}

/// One candidate measurement for a loose component (spec §6.4, D5).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Candidate {
    /// Length in mm of the overlap of the two rooms' spans on the other axis.
    /// Zero when either room is outside the other axis's anchored component.
    pub overlap: Mm,
    /// The anchored room, `a`.
    pub anchor: RoomName,
    /// The loose room, `l`.
    pub loose: RoomName,
    /// Which side of `anchor` the loose room is on.
    pub direction: Direction,
}

impl Candidate {
    /// The `(from, to, relation)` words of the measurement on `axis`.
    fn measure(&self, axis: Axis) -> (String, String, &'static str) {
        let a = self.anchor.as_str();
        let l = self.loose.as_str();
        match (axis, self.direction) {
            (Axis::X, Direction::After) => (format!("{a}.east"), format!("{l}.west"), "east_of"),
            (Axis::X, Direction::Before) => (format!("{l}.east"), format!("{a}.west"), "west_of"),
            (Axis::Y, Direction::After) => (format!("{a}.south"), format!("{l}.north"), "south_of"),
            (Axis::Y, Direction::Before) => {
                (format!("{l}.south"), format!("{a}.north"), "north_of")
            }
        }
    }
}

/// Every candidate for the loose component `loose` on `axis`, in D5 order:
/// anchored rooms in declaration order, then loose rooms in declaration order,
/// then After before Before. `comps` are the components of `axis` from
/// [`components`]. Empty when `comps` has no anchored component.
pub fn candidates(
    edges: &[Edge],
    plan: &Plan,
    axis: Axis,
    comps: &[Component],
    loose: &Component,
) -> Vec<Candidate> {
    let Some(anchored) = comps.iter().find(|c| c.anchored) else {
        return Vec::new();
    };
    let spans = anchored_spans(edges, plan, other_axis(axis));
    let mut out = Vec::new();
    for anchor in &anchored.rooms {
        for room in &loose.rooms {
            let overlap = overlap(spans.get(anchor), spans.get(room));
            for direction in [Direction::After, Direction::Before] {
                out.push(Candidate {
                    overlap,
                    anchor: anchor.clone(),
                    loose: room.clone(),
                    direction,
                });
            }
        }
    }
    out
}

/// The best candidate of [`candidates`]: the largest overlap. A tie keeps the
/// earlier candidate, so the order in [`candidates`] breaks ties. `None` when
/// there are no candidates.
pub fn best_candidate(
    edges: &[Edge],
    plan: &Plan,
    axis: Axis,
    comps: &[Component],
    loose: &Component,
) -> Option<Candidate> {
    let mut best: Option<Candidate> = None;
    for candidate in candidates(edges, plan, axis, comps, loose) {
        if best
            .as_ref()
            .is_none_or(|kept| candidate.overlap > kept.overlap)
        {
            best = Some(candidate);
        }
    }
    best
}

/// The W001 diagnostics of both axes, with the measurement filled in from the
/// best candidate where there is one. A loose room with no candidate, and a
/// depth-unknown room (whose wording has no measurement), keep their
/// [`components`] text. `room` in `data` names the room the suggestion is for.
pub fn suggested_w001(edges: &[Edge], plan: &Plan) -> Vec<Diagnostic> {
    let mut out = Vec::new();
    for axis in [Axis::X, Axis::Y] {
        let (comps, diagnostics) = components(edges, plan, axis);
        for diagnostic in diagnostics {
            out.push(suggest_one(edges, plan, axis, &comps, diagnostic));
        }
    }
    out
}

/// Fill in one W001 from `comps` (the components of `axis`).
fn suggest_one(
    edges: &[Edge],
    plan: &Plan,
    axis: Axis,
    comps: &[Component],
    mut diagnostic: Diagnostic,
) -> Diagnostic {
    let Some(room) = diagnostic
        .data
        .get("room")
        .and_then(|value| value.as_str())
        .map(str::to_string)
    else {
        return diagnostic;
    };
    let depth_unknown = axis == Axis::Y
        && plan
            .rooms
            .values()
            .any(|declared| declared.name.as_str() == room && declared.depth.is_none());
    if depth_unknown {
        return diagnostic;
    }
    // components() reports a component's first room not yet reported, so the
    // first loose component holding the room is the one that reported it.
    let Some(component) = comps
        .iter()
        .find(|c| !c.anchored && c.rooms.iter().any(|r| r.as_str() == room))
    else {
        return diagnostic;
    };
    let Some(best) = best_candidate(edges, plan, axis, comps, component) else {
        return diagnostic;
    };
    let (from, to, relation) = best.measure(axis);
    let loose = best.loose.as_str().to_string();
    let of = best.anchor.as_str().to_string();
    let gap = plan.default_wall.value.to_string();
    diagnostic.message = message(
        Code::W001,
        &[
            ("axis", axis_word(axis).to_string()),
            ("room", loose.clone()),
            ("from", from.clone()),
            ("to", to.clone()),
            ("relation", relation.to_string()),
            ("of", of.clone()),
            ("gap", gap.clone()),
        ],
    );
    if let Some(object) = diagnostic.data.as_object_mut() {
        object.insert("room".to_string(), json!(loose));
        object.insert(
            "suggestion".to_string(),
            json!({
                "from": from,
                "to": to,
                "relation": relation,
                "of": of,
                "gap": gap,
            }),
        );
    }
    diagnostic
}

/// The axis word used in the W001 text.
fn axis_word(axis: Axis) -> &'static str {
    match axis {
        Axis::X => "east–west",
        Axis::Y => "north–south",
    }
}

fn other_axis(axis: Axis) -> Axis {
    match axis {
        Axis::X => Axis::Y,
        Axis::Y => Axis::X,
    }
}

/// The solved span `(min, max)` on `axis` of every room of the anchored
/// component on `axis`. Other rooms have no span, because their coordinates
/// are relative to another root.
fn anchored_spans(edges: &[Edge], plan: &Plan, axis: Axis) -> HashMap<RoomName, (Mm, Mm)> {
    let mut spans = HashMap::new();
    let (comps, _) = components(edges, plan, axis);
    let (coords, _) = assign_coords(edges, &comps, axis);
    let Some(anchored) = comps.iter().find(|c| c.anchored) else {
        return spans;
    };
    let [first, second] = axis_sides(axis);
    for room in &anchored.rooms {
        let at = |side: Side| coords.get(&(room.clone(), side_key(side))).copied();
        if let (Some(p), Some(q)) = (at(first), at(second)) {
            spans.insert(room.clone(), (p.min(q), p.max(q)));
        }
    }
    spans
}

/// The overlap in mm of two spans, zero when they do not overlap or either is
/// missing.
fn overlap(a: Option<&(Mm, Mm)>, b: Option<&(Mm, Mm)>) -> Mm {
    match (a, b) {
        (Some(&(a0, a1)), Some(&(b0, b1))) => (a1.min(b1) - a0.max(b0)).max(0),
        _ => 0,
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

    #[test]
    fn loose_room_suggestion_uses_the_best_facing_face() {
        // Hall and Kitchen are anchored on both axes. Förråd is loose on x and
        // aligned with Hall on y, so it overlaps Hall by 1500 mm and Kitchen by
        // 1000 mm. Hall wins, and After (east_of) comes before Before.
        let plan = parse(
            "room Hall 3000 x 2000\nroom Kitchen 2000 x 1000\n  east_of Hall gap\n  align north Hall\nroom Förråd 1000 x 1500\n  align north Hall\n",
        )
        .expect("parse");
        let (edge_list, diagnostics) = edges(&plan);
        assert!(diagnostics.is_empty(), "{diagnostics:?}");

        let got = suggested_w001(&edge_list, &plan);
        assert_eq!(got.len(), 1, "{got:?}");
        assert_eq!(got[0].code, Code::W001);
        assert_eq!(
            got[0].message,
            r#"Not tied east–west: Förråd. Measure from Hall.east to Förråd.west, or add "Förråd east_of Hall gap 90"."#
        );
    }

    #[test]
    fn no_anchored_candidates_keeps_the_components_text() {
        let plan = parse("room Hall 3000 x 2000\nroom Förråd 1000 x 1500\n").expect("parse");
        let (edge_list, _) = edges(&plan);
        let (mut comps, _) = components(&edge_list, &plan, Axis::X);
        // Unanchor every component, so the loose room has no anchored room to
        // be measured from.
        for comp in &mut comps {
            comp.anchored = false;
        }
        let loose = comps
            .iter()
            .find(|c| c.rooms.iter().any(|r| r.as_str() == "Förråd"))
            .cloned()
            .expect("Förråd has a component");
        assert!(candidates(&edge_list, &plan, Axis::X, &comps, &loose).is_empty());
        assert_eq!(
            best_candidate(&edge_list, &plan, Axis::X, &comps, &loose),
            None
        );
    }
}
