//! The resolved model: the solved geometry of a plan, computed and never edited
//! directly (spec §5.3).
//!
//! [`resolve`] runs the solver on both axes (§6), then builds the walls, the
//! openings, the areas and the spaces (§9). It returns `None` as soon as an
//! Error diagnostic exists, so a [`Resolved`] always comes from a plan that
//! solves cleanly. The nodes are the wall end points (§5.3, `N:<x>,<y>`).

use std::collections::BTreeMap;

use serde::Serialize;

use crate::build::{
    BuiltWall, Coords, PlacedOpening, SegmentKind, built_walls, diagnose, place_openings,
    room_areas, spaces,
};
use crate::diagnostics::{Diagnostic, Severity};
use crate::intent::{FaceRef, OpeningKind, Plan, RoomName, Side};
use crate::solve::components::with_suggested_data;
use crate::solve::{
    AdjustedEdge, Axis, Component, CycleCheck, Edge, FaceKey, adjusted_diagnostic, assign_coords,
    check_cycles, components, conflict_diagnostic, distribute, edges,
};
use crate::units::{Mm, Source};

/// Id of a wall, as in §5.3 (`W:<A>.<side>|<B>.<side>` or `W:<Room>.<side>:outer`).
pub type WallId = String;
/// Id of an opening, `O:<Room>.<side>:<n>`.
pub type OpeningId = String;
/// Id of a node, `N:<x>,<y>` with the coordinates in mm (§5.3).
pub type NodeId = String;

/// Side indices used by the solver's map keys: north 0, east 1, south 2, west 3.
const NORTH: u8 = 0;
const EAST: u8 = 1;
const SOUTH: u8 = 2;
const WEST: u8 = 3;

/// The solved model of a plan (§5.3). Coordinates are mm, x east, y south.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Resolved {
    /// Solved inner faces of every room that has all four faces solved.
    pub rooms: BTreeMap<RoomName, RoomRect>,
    /// Wall end points by id. A point shared by several walls is one node.
    pub nodes: BTreeMap<NodeId, Pt>,
    /// Walls by id.
    pub walls: BTreeMap<WallId, Wall>,
    /// Openings by id.
    pub openings: BTreeMap<OpeningId, ResolvedOpening>,
    /// Rooms joined by `open`, with their total area.
    pub spaces: Vec<Space>,
    /// Every diagnostic found while resolving (warnings and infos; errors give `None`).
    pub diagnostics: Vec<Diagnostic>,
}

/// The inner rectangle of a room in mm.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub struct RoomRect {
    /// x of the west face.
    pub west: Mm,
    /// x of the east face.
    pub east: Mm,
    /// y of the north face.
    pub north: Mm,
    /// y of the south face.
    pub south: Mm,
}

/// A point in mm, x east, y south (§5.3).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub struct Pt {
    /// x in mm.
    pub x: Mm,
    /// y in mm.
    pub y: Mm,
}

/// Which side of the line from `from` to `to` a wall's body lies on (§5.3).
/// Internal only: not serialised.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RefSide {
    /// On the left of from→to.
    Left,
    /// On the line.
    Center,
    /// On the right of from→to.
    Right,
}

/// Whether a wall is between two rooms or on the outside.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum WallKind {
    /// Between two rooms.
    Interior,
    /// On the outside of a room.
    Outer,
}

/// A wall segment of the resolved model (§5.3).
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Wall {
    /// The semantic id.
    pub id: WallId,
    /// The west or north end node.
    pub from: NodeId,
    /// The east or south end node.
    pub to: NodeId,
    /// Which side of from→to the body lies on. Internal only.
    #[serde(skip)]
    pub reference: RefSide,
    /// Interior or outer.
    pub kind: WallKind,
    /// Thickness in mm.
    pub thickness: Mm,
    /// Where the thickness comes from.
    pub thickness_source: Source,
    /// `true` when the thickness is derived from the room positions (I010).
    pub derived: bool,
    /// The rooms on either side: the room face it came from, and the facing face
    /// for an interior wall.
    pub between: (Option<FaceRef>, Option<FaceRef>),
    /// Extent along x in mm, as `(min, max)`.
    pub x: (Mm, Mm),
    /// Extent along y in mm, as `(min, max)`.
    pub y: (Mm, Mm),
}

/// An opening placed on its face (§5.3 `ResolvedOpening`).
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ResolvedOpening {
    /// The id, `O:<Room>.<side>:<n>`.
    pub id: OpeningId,
    /// Door, window or passage.
    pub kind: OpeningKind,
    /// The room face it sits in.
    pub face: FaceRef,
    /// Absolute start along the face in mm.
    pub start: Mm,
    /// Absolute end along the face in mm.
    pub end: Mm,
    /// The id of the wall it sits in.
    pub wall: WallId,
    /// Doors: the compass side of the hinge, as written.
    pub hinge: Option<Side>,
    /// Doors: the room the leaf swings into, if the intent names one.
    pub opens_into: Option<RoomName>,
}

/// Rooms joined by `open`, with their total area (§9.5).
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Space {
    /// The rooms, sorted by name.
    pub rooms: Vec<RoomName>,
    /// Sum of the rooms' areas in mm².
    pub area: i64,
}

/// Solve and build `plan`.
///
/// Returns the resolved model and every diagnostic found. The model is `None`
/// when any Error diagnostic exists (for example E003 for a conflicting cycle,
/// E010, E004, E007 or E013); the diagnostics are then still returned.
pub fn resolve(plan: &Plan) -> (Option<Resolved>, Vec<Diagnostic>) {
    let (all_edges, mut diagnostics) = edges(plan);

    let mut coords = Coords::default();
    for axis in [Axis::X, Axis::Y] {
        let (comps, comp_diags) = components(&all_edges, plan, axis);
        // The W001s carry the W2-09 keys in `data` (§6.4, D5), as `plan suggest` does.
        diagnostics.extend(
            comp_diags
                .into_iter()
                .map(|d| with_suggested_data(&all_edges, plan, axis, &comps, d)),
        );
        let (mut axis_coords, tree) = assign_coords(&all_edges, &comps, axis);
        let checks = check_cycles(&all_edges, &axis_coords, &tree, axis);
        for check in &checks {
            diagnostics.extend(conflict_diagnostic(check, &all_edges));
        }
        // §6.2 step 5: with no conflict on the axis, spread the within-tolerance
        // residuals over the components that have one.
        if !checks.iter().any(|check| check.conflict) {
            let moved = distribute_axis(&all_edges, &comps, axis, &checks, &mut axis_coords);
            diagnostics.extend(adjusted_diagnostic(axis, &moved));
        }
        match axis {
            Axis::X => coords.x = axis_coords,
            Axis::Y => coords.y = axis_coords,
        }
    }
    if has_error(&diagnostics) {
        return (None, diagnostics);
    }

    let walls = built_walls(plan, &coords);
    diagnostics.extend(diagnose(&walls));
    let (openings, opening_diags) = place_openings(plan, &coords, &walls);
    diagnostics.extend(opening_diags);
    if has_error(&diagnostics) {
        return (None, diagnostics);
    }

    let areas = room_areas(plan, &coords);
    let mut nodes: BTreeMap<NodeId, Pt> = BTreeMap::new();
    let mut wall_models: BTreeMap<WallId, Wall> = BTreeMap::new();
    for wall in &walls {
        let kind = match wall.kind {
            SegmentKind::Interior => WallKind::Interior,
            SegmentKind::Outer => WallKind::Outer,
            SegmentKind::Open => continue,
        };
        let (from, to) = wall_ends(wall);
        let (from_id, to_id) = (node_id(from), node_id(to));
        nodes.insert(from_id.clone(), from);
        nodes.insert(to_id.clone(), to);
        let model = Wall {
            id: wall.id.clone(),
            from: from_id,
            to: to_id,
            reference: RefSide::Center,
            kind,
            thickness: wall.thickness,
            thickness_source: wall.source,
            derived: wall.derived,
            between: (Some(wall.face.clone()), wall.other.clone()),
            x: wall.x,
            y: wall.y,
        };
        wall_models.insert(wall.id.clone(), model);
    }
    let resolved = Resolved {
        rooms: rooms(plan, &coords),
        nodes,
        walls: wall_models,
        openings: openings
            .iter()
            .map(|opening| (opening.id.clone(), opening_model(opening)))
            .collect(),
        spaces: spaces(plan, &areas)
            .into_iter()
            .map(|space| Space {
                rooms: space.rooms,
                area: space.area,
            })
            .collect(),
        diagnostics: diagnostics.clone(),
    };
    (Some(resolved), diagnostics)
}

/// Distribute every component of `axis` that has a non-zero within-tolerance
/// residual (§6.2 step 5). Each distributed component's coordinates replace the
/// first-pass ones in `coords`; a component that `distribute` cannot solve keeps
/// them. Returns the edges that moved more than half a millimetre, in edge-index
/// order.
fn distribute_axis(
    edges: &[Edge],
    comps: &[Component],
    axis: Axis,
    checks: &[CycleCheck],
    coords: &mut BTreeMap<FaceKey, Mm>,
) -> Vec<AdjustedEdge> {
    let mut moved = Vec::new();
    for comp in comps {
        let has_residual = checks.iter().any(|check| {
            check.residual != 0
                && edges
                    .get(check.stated)
                    .is_some_and(|stated| comp.faces.contains(&stated.from))
        });
        if !has_residual {
            continue;
        }
        let Some(dist) = distribute(edges, comp, axis, &*coords) else {
            continue;
        };
        coords.extend(dist.coords);
        moved.extend(dist.edges.into_iter().filter(|a| a.shift.abs() > 0.5));
    }
    moved.sort_by_key(|a| a.edge);
    moved
}

/// The two end points of a wall on its node line, the room face it was made
/// from (§9.2). `from` is the west or north end, `to` the east or south end.
fn wall_ends(wall: &BuiltWall) -> (Pt, Pt) {
    // The face line is an end of the body extent: the near end on an east or
    // south face, the far end on a west or north face (see merge.rs `body`).
    let (vertical, line) = match wall.face.side {
        Side::East => (true, wall.x.0),
        Side::West => (true, wall.x.1),
        Side::North => (false, wall.y.1),
        Side::South => (false, wall.y.0),
    };
    if vertical {
        (
            Pt {
                x: line,
                y: wall.y.0,
            },
            Pt {
                x: line,
                y: wall.y.1,
            },
        )
    } else {
        (
            Pt {
                x: wall.x.0,
                y: line,
            },
            Pt {
                x: wall.x.1,
                y: line,
            },
        )
    }
}

/// The §5.3 id of a node: `N:<x>,<y>`.
fn node_id(pt: Pt) -> NodeId {
    format!("N:{},{}", pt.x, pt.y)
}

/// True when any diagnostic has the Error severity.
pub(crate) fn has_error(diagnostics: &[Diagnostic]) -> bool {
    diagnostics.iter().any(|d| d.severity == Severity::Error)
}

/// The solved inner rectangle of every room whose four faces have coordinates.
fn rooms(plan: &Plan, coords: &Coords) -> BTreeMap<RoomName, RoomRect> {
    plan.rooms
        .keys()
        .filter_map(|name| {
            let rect = RoomRect {
                west: coord(&coords.x, name, WEST)?,
                east: coord(&coords.x, name, EAST)?,
                north: coord(&coords.y, name, NORTH)?,
                south: coord(&coords.y, name, SOUTH)?,
            };
            Some((name.clone(), rect))
        })
        .collect()
}

/// One coordinate of a room face, if the solver gave it one.
fn coord(map: &BTreeMap<FaceKey, Mm>, room: &RoomName, side: u8) -> Option<Mm> {
    map.get(&(room.clone(), side)).copied()
}

/// The resolved form of a placed opening.
fn opening_model(opening: &PlacedOpening) -> ResolvedOpening {
    ResolvedOpening {
        id: opening.id.clone(),
        kind: opening.kind,
        face: opening.face.clone(),
        start: opening.start,
        end: opening.end,
        wall: opening.wall.clone(),
        hinge: opening.hinge,
        opens_into: opening.opens_into.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::diagnostics::Code;
    use crate::dsl::parse;

    const FIXTURE_A: &str = include_str!("../../../fixtures/lgh154-a.plan");
    const FIXTURE_B: &str = include_str!("../../../fixtures/lgh154-b.plan");

    fn fixture(src: &str) -> Plan {
        parse(src).expect("fixture parses")
    }

    #[test]
    fn fixture_a_resolves_every_room() -> Result<(), Box<dyn std::error::Error>> {
        let plan = fixture(FIXTURE_A);
        let (resolved, diagnostics) = resolve(&plan);
        assert!(!has_error(&diagnostics), "{diagnostics:?}");
        let resolved = resolved.ok_or("fixture A should resolve")?;
        assert_eq!(resolved.rooms.len(), plan.rooms.len());
        let garderob = RoomName::new("Garderob")?;
        let rect = resolved
            .rooms
            .get(&garderob)
            .ok_or("Garderob has no rectangle")?;
        assert_eq!(rect.east - rect.west, 1860);
        assert_eq!(rect.south - rect.north, 2360);
        Ok(())
    }

    #[test]
    fn fixture_a_nodes_and_wall_ends() -> Result<(), Box<dyn std::error::Error>> {
        let plan = fixture(FIXTURE_A);
        let (resolved, _) = resolve(&plan);
        let resolved = resolved.ok_or("fixture A should resolve")?;
        // Hand count: 15 walls give 30 end points. Ten points are each an end of
        // two walls: (0,0), (1981,0), (3171,0), (5541,0), (1860,1113),
        // (5541,1113), (0,2450), (1860,2450), (0,4540) and (5541,4593). So
        // 30 - 10 = 20 distinct nodes.
        assert_eq!(resolved.walls.len(), 15);
        assert_eq!(resolved.nodes.len(), 20);
        for wall in resolved.walls.values() {
            assert!(
                resolved.nodes.contains_key(&wall.from),
                "from of {}",
                wall.id
            );
            assert!(resolved.nodes.contains_key(&wall.to), "to of {}", wall.id);
        }
        Ok(())
    }

    /// Test plan 1 of W2-09: a loose room with two laser rooms.
    const LOOSE_ROOM: &str = "room Hall 1000 x 2000 source laser
room Förråd 800 x 2000 source laser
  align north Hall
";

    #[test]
    fn loose_room_w001_from_resolve_carries_the_suggested_data() {
        use crate::solve::components::suggested_w001;
        let plan = fixture(LOOSE_ROOM);
        let (_, diagnostics) = resolve(&plan);
        let (edge_list, _) = edges(&plan);
        let suggested = suggested_w001(&edge_list, &plan);

        let resolved_w001: Vec<&Diagnostic> = diagnostics
            .iter()
            .filter(|d| d.code == Code::W001)
            .collect();
        assert_eq!(resolved_w001.len(), 1, "{diagnostics:?}");
        let got = resolved_w001[0];
        let want = suggested
            .iter()
            .find(|d| d.data["axis"] == got.data["axis"] && d.data["room"] == got.data["room"])
            .expect("suggested_w001 has the same W001");
        for key in ["from", "to", "relation", "of", "gap", "alternatives"] {
            assert_eq!(got.data[key], want.data[key], "data.{key}: {:?}", got.data);
        }
        assert_eq!(got.data["from"], "Hall.east");
        assert_eq!(got.data["to"], "Förråd.west");
    }

    #[test]
    fn fixture_b_has_e003_and_no_model() -> Result<(), Box<dyn std::error::Error>> {
        let plan = fixture(FIXTURE_B);
        let (resolved, diagnostics) = resolve(&plan);
        assert!(resolved.is_none());
        let e003 = diagnostics.iter().filter(|d| d.code == Code::E003).count();
        assert_eq!(e003, 1);
        Ok(())
    }
}
