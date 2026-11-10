//! The resolved model: the solved geometry of a plan, computed and never edited
//! directly (spec §5.3).
//!
//! [`resolve`] runs the solver on both axes (§6), then builds the walls, the
//! openings, the areas and the spaces (§9). It returns `None` as soon as an
//! Error diagnostic exists, so a [`Resolved`] always comes from a plan that
//! solves cleanly. The nodes are the wall end points (§5.3, `N:<x>,<y>`).

use std::collections::BTreeMap;

use serde::Serialize;
use serde_json::json;

use crate::build::{
    BuiltWall, Coords, PlacedOpening, SegmentKind, built_walls, diagnose, place_fixtures,
    place_openings, room_areas, spaces,
};
use crate::diagnostics::{Code, Diagnostic, Severity, message};
use crate::intent::{FaceRef, FixtureKind, OpeningKind, Phase, Plan, RoomName, Side, WallOverride};
use crate::solve::components::with_suggested_data;
use crate::solve::{
    AdjustedEdge, Axis, Component, CycleCheck, Edge, FaceId, FaceKey, adjusted_diagnostic,
    assign_coords, check_cycles, components, conflict_diagnostic, distribute, edges,
};
use crate::units::{Mm, Source};
use crate::validate::validate;

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
    /// Fixtures by id, `F:<Room>.<side>:<n>` (§15 D44).
    pub fixtures: BTreeMap<String, ResolvedFixture>,
    /// Rooms joined by `open`, with their total area.
    pub spaces: Vec<Space>,
    /// The phase of every room that has a rectangle in `rooms`.
    pub room_phases: BTreeMap<RoomName, Phase>,
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
    /// Load-bearing wall (§15 D34). `false` without a wall override.
    pub bearing: bool,
    /// Fire rating text, e.g. "EI60" (§15 D34).
    pub fire: Option<String>,
    /// Existing, demolished or new (§15 D34). `Existing` without a wall override.
    pub phase: Phase,
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
    /// Existing, demolished or new.
    pub phase: Phase,
    /// Opening height in mm, if known.
    pub height: Option<Mm>,
}

/// A fixture as a rectangle in mm, x east, y south (§15 D44).
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ResolvedFixture {
    /// The id, `F:<Room>.<side>:<n>`, numbered per face by `at`, then kind word.
    pub id: String,
    /// The kind of fixture.
    pub kind: FixtureKind,
    /// The room face it stands against.
    pub face: FaceRef,
    /// Extent along x in mm, as `(min, max)`.
    pub x: (Mm, Mm),
    /// Extent along y in mm, as `(min, max)`.
    pub y: (Mm, Mm),
    /// Free text label, if any.
    pub label: Option<String>,
    /// Existing, demolished or new.
    pub phase: Phase,
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
    resolve_with(plan, false)
}

/// Solve and build `plan` for drawing (§15 D37).
///
/// Like [`resolve`], but the model is `None` only for the errors in
/// [`stops_draft`]. An axis with E003 keeps its first-pass coordinates, and an
/// opening that cannot be placed is left out. Every diagnostic is returned,
/// errors included.
pub fn resolve_draft(plan: &Plan) -> (Option<Resolved>, Vec<Diagnostic>) {
    resolve_with(plan, true)
}

/// The shared body of [`resolve`] and [`resolve_draft`]. `draft` selects the
/// stop test: [`has_error`] normally, [`stops_draft`] in draft mode.
fn resolve_with(plan: &Plan, draft: bool) -> (Option<Resolved>, Vec<Diagnostic>) {
    let stops = |diagnostics: &[Diagnostic]| {
        if draft {
            stops_draft(diagnostics)
        } else {
            has_error(diagnostics)
        }
    };
    let mut diagnostics = validate(plan);
    if stops(&diagnostics) {
        return (None, diagnostics);
    }
    let (all_edges, edge_diags) = edges(plan);
    diagnostics.extend(edge_diags);

    let mut coords = Coords::default();
    // Rooms whose two faces on an axis are in different components (D24).
    let mut unplaced: Vec<(RoomName, Axis)> = Vec::new();
    // Rooms in a loose component (no anchor), on either axis (D27).
    let mut loose: Vec<RoomName> = Vec::new();
    for axis in [Axis::X, Axis::Y] {
        let (comps, comp_diags) = components(&all_edges, plan, axis);
        for comp in comps.iter().filter(|comp| !comp.anchored) {
            loose.extend(comp.rooms.iter().cloned());
        }
        // The W001s carry the W2-09 keys in `data` (§6.4, D5), as `plan suggest` does.
        diagnostics.extend(
            comp_diags
                .into_iter()
                .map(|d| with_suggested_data(&all_edges, plan, axis, &comps, d)),
        );
        for room in unplaced_rooms(plan, &comps, axis) {
            unplaced.push((room, axis));
        }
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
    if stops(&diagnostics) {
        return (None, diagnostics);
    }
    // D24: an unplaced room gets no coordinates on its axis, so it has no
    // rectangle, walls, area or openings. Its W001 stays.
    for (room, axis) in &unplaced {
        let (map, sides) = match axis {
            Axis::X => (&mut coords.x, [WEST, EAST]),
            Axis::Y => (&mut coords.y, [NORTH, SOUTH]),
        };
        for side in sides {
            map.remove(&(room.clone(), side));
        }
    }
    diagnostics.extend(overlaps(plan, &coords, &loose));
    if stops(&diagnostics) {
        return (None, diagnostics);
    }

    let walls = built_walls(plan, &coords);
    diagnostics.extend(diagnose(&walls));
    let (openings, opening_diags) = place_openings(plan, &coords, &walls);
    diagnostics.extend(opening_diags);
    let rooms = rooms(plan, &coords);
    let (fixtures, fixture_diags) = place_fixtures(plan, &rooms, &walls);
    diagnostics.extend(fixture_diags);
    if stops(&diagnostics) {
        return (None, diagnostics);
    }

    diagnostics.extend(reference_checks(plan, &coords));
    let areas = room_areas(plan, &coords);
    let mut nodes: BTreeMap<NodeId, Pt> = BTreeMap::new();
    let mut wall_models: BTreeMap<WallId, Wall> = BTreeMap::new();
    for wall in &walls {
        let kind = match wall.kind {
            SegmentKind::Interior => WallKind::Interior,
            SegmentKind::Outer => WallKind::Outer,
            SegmentKind::Open => continue,
        };
        let attributes = wall_override(plan, wall);
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
            bearing: attributes.is_some_and(|o| o.bearing),
            fire: attributes.and_then(|o| o.fire.clone()),
            phase: attributes.map_or(Phase::Existing, |o| o.phase),
        };
        wall_models.insert(wall.id.clone(), model);
    }
    let room_phases = rooms
        .keys()
        .filter_map(|name| Some((name.clone(), plan.rooms.get(name)?.phase)))
        .collect();
    let resolved = Resolved {
        rooms,
        nodes,
        walls: wall_models,
        openings: openings
            .iter()
            .map(|opening| (opening.id.clone(), opening_model(opening)))
            .collect(),
        fixtures,
        spaces: spaces(plan, &areas)
            .into_iter()
            .map(|space| Space {
                rooms: space.rooms,
                area: space.area,
            })
            .collect(),
        room_phases,
        diagnostics: diagnostics.clone(),
    };
    (Some(resolved), diagnostics)
}

/// The rooms of `plan` whose two faces on `axis` (west and east on x, north and
/// south on y) are in different components of `comps` (§15 D24), in order.
fn unplaced_rooms(plan: &Plan, comps: &[Component], axis: Axis) -> Vec<RoomName> {
    let sides = match axis {
        Axis::X => [Side::West, Side::East],
        Axis::Y => [Side::North, Side::South],
    };
    let component_of = |room: &RoomName, side: Side| {
        let face = FaceId {
            room: room.clone(),
            side,
        };
        comps.iter().position(|comp| comp.faces.contains(&face))
    };
    plan.order
        .iter()
        .filter(|room| component_of(room, sides[0]) != component_of(room, sides[1]))
        .cloned()
        .collect()
}

/// E005 for every pair of placed rooms whose rectangles overlap with a positive
/// width and depth. The pair is `a` before `b` in `plan.order`. Loose rooms are
/// not compared (D27), and rooms that only touch do not overlap.
fn overlaps(plan: &Plan, coords: &Coords, loose: &[RoomName]) -> Vec<Diagnostic> {
    let rects = rooms(plan, coords);
    let placed: Vec<(&RoomName, &RoomRect)> = plan
        .order
        .iter()
        .filter(|room| !loose.contains(room))
        .filter_map(|room| rects.get(room).map(|rect| (room, rect)))
        .collect();
    let mut out = Vec::new();
    for (i, (a, ra)) in placed.iter().enumerate() {
        for (b, rb) in &placed[i + 1..] {
            let dx = ra.east.min(rb.east) - ra.west.max(rb.west);
            let dy = ra.south.min(rb.south) - ra.north.max(rb.north);
            if dx <= 0 || dy <= 0 {
                continue;
            }
            let args = [
                ("a", a.to_string()),
                ("b", b.to_string()),
                ("dx", dx.to_string()),
                ("dy", dy.to_string()),
            ];
            out.push(Diagnostic {
                code: Code::E005,
                severity: Severity::Error,
                message: message(Code::E005, &args),
                span: None,
                refs: vec![a.to_string(), b.to_string()],
                data: json!({ "a": a, "b": b, "dx": dx, "dy": dy }),
            });
        }
    }
    out
}

/// Distribute every component of `axis` that has a non-zero within-tolerance
/// residual (§6.2 step 5). Each distributed component's coordinates replace the
/// first-pass ones in `coords`; a component that `distribute` cannot solve keeps
/// them. Returns the edges whose drawn value differs from the stated one, in
/// edge-index order (§15 D23).
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
        moved.extend(dist.edges.into_iter().filter(|a| a.adjusted != a.value));
    }
    moved.sort_by_key(|a| a.edge);
    moved
}

/// The first wall override of `plan` on the face of `wall`, or on the facing
/// face of an interior wall (§15 D34).
fn wall_override<'a>(plan: &'a Plan, wall: &BuiltWall) -> Option<&'a WallOverride> {
    plan.wall_overrides
        .iter()
        .find(|o| o.face == wall.face || wall.other.as_ref().is_some_and(|other| o.face == *other))
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

/// In draft mode (§15 D37) only these errors leave nothing to draw: bad sizes,
/// self relations, non-parallel measures, overlapping rooms.
fn stops_draft(diagnostics: &[Diagnostic]) -> bool {
    diagnostics
        .iter()
        .any(|d| matches!(d.code, Code::E014 | Code::E015 | Code::E010 | Code::E005))
}

/// W020 for every reference measure (§8, §15 D25) whose drawn distance differs
/// from the measured value by more than the measure's tolerance. Measures are
/// checked in plan order. A measure is skipped when a coordinate is missing or
/// when its two faces are on different axes.
fn reference_checks(plan: &Plan, coords: &Coords) -> Vec<Diagnostic> {
    let mut out = Vec::new();
    for measure in plan.measures.iter().filter(|m| m.reference) {
        let (from, to) = (&measure.from, &measure.to);
        let map = match (from.side, to.side) {
            (Side::East | Side::West, Side::East | Side::West) => &coords.x,
            (Side::North | Side::South, Side::North | Side::South) => &coords.y,
            _ => continue,
        };
        let (Some(start), Some(end)) = (
            coord(map, &from.room, side_index(from.side)),
            coord(map, &to.room, side_index(to.side)),
        ) else {
            continue;
        };
        let drawn = (end - start).abs();
        let value = &measure.value;
        let diff = (drawn - value.value).abs();
        if diff <= value.tolerance {
            continue;
        }
        let from_label = face_text(from);
        let to_label = face_text(to);
        let args = [
            ("from", from_label.clone()),
            ("to", to_label.clone()),
            ("drawn", drawn.to_string()),
            ("value", value.value.to_string()),
            ("diff", diff.to_string()),
        ];
        out.push(Diagnostic {
            code: Code::W020,
            severity: Severity::Warning,
            message: message(Code::W020, &args),
            span: None,
            refs: vec![from_label.clone(), to_label.clone()],
            data: json!({
                "from": from_label,
                "to": to_label,
                "drawn": drawn,
                "measured": value,
                "diff": diff,
            }),
        });
    }
    out
}

/// The side index used by the solver's map keys (see [`NORTH`]).
fn side_index(side: Side) -> u8 {
    match side {
        Side::North => NORTH,
        Side::East => EAST,
        Side::South => SOUTH,
        Side::West => WEST,
    }
}

/// `Room.side` with the side in lower case, as in the W020 message.
fn face_text(face: &FaceRef) -> String {
    let side = match face.side {
        Side::North => "north",
        Side::East => "east",
        Side::South => "south",
        Side::West => "west",
    };
    format!("{}.{}", face.room, side)
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
        phase: opening.phase,
        height: opening.height,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::diagnostics::Code;
    use crate::dsl::parse;
    use crate::intent::Phase;

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

    /// W3-03: a room with an unknown size that nothing ties is left out.
    const UNKNOWN_SIZE_NOT_TIED: &str = "plan \"p\"
default_wall 90 source assumed
default_outer_wall 300 source assumed

room A 2000 x ? source laser
room B 1500 x 1000 source laser
  east_of A gap
  align north A
";

    #[test]
    fn unknown_size_not_tied_room_is_left_out() -> Result<(), Box<dyn std::error::Error>> {
        let plan = fixture(UNKNOWN_SIZE_NOT_TIED);
        let (resolved, diagnostics) = resolve(&plan);
        assert!(!has_error(&diagnostics), "{diagnostics:?}");
        let w001: Vec<&Diagnostic> = diagnostics
            .iter()
            .filter(|d| d.code == Code::W001)
            .collect();
        assert_eq!(w001.len(), 1, "{diagnostics:?}");
        assert_eq!(
            w001[0].message,
            "A depth unknown; measure A.north to A.south"
        );
        assert!(
            !diagnostics.iter().any(|d| d.message.contains("is 0 mm")),
            "{diagnostics:?}"
        );
        let resolved = resolved.ok_or("the plan should resolve")?;
        let names: Vec<&RoomName> = resolved.rooms.keys().collect();
        assert_eq!(names, vec![&RoomName::new("B")?]);
        assert!(
            !resolved
                .walls
                .keys()
                .any(|id| id.contains("A.north") || id.contains("A.south")),
            "{:?}",
            resolved.walls.keys().collect::<Vec<_>>()
        );
        let b = resolved
            .rooms
            .get(&RoomName::new("B")?)
            .ok_or("B has no rectangle")?;
        assert_eq!((b.west, b.east, b.north, b.south), (2090, 3590, 0, 1000));
        Ok(())
    }

    #[test]
    fn unknown_depth_tied_through_other_rooms_is_kept() -> Result<(), Box<dyn std::error::Error>> {
        let plan = fixture(FIXTURE_A);
        let (resolved, _) = resolve(&plan);
        let resolved = resolved.ok_or("fixture A should resolve")?;
        let hall = resolved
            .rooms
            .get(&RoomName::new("Hall")?)
            .ok_or("Hall has no rectangle")?;
        assert_eq!((hall.north, hall.south), (0, 1113));
        Ok(())
    }

    /// W3-04: two placed rooms on top of each other give E005 and no model.
    const OVERLAPPING: &str = "plan \"p\"
default_wall 90 source assumed
default_outer_wall 300 source assumed

room A 2000 x 1000 source laser
room B 1500 x 1000 source laser
  east_of A gap
  align north A
room C 1500 x 1000 source laser
  east_of A gap
  align north A
";

    #[test]
    fn overlapping_placed_rooms_give_e005_and_no_model() -> Result<(), Box<dyn std::error::Error>> {
        let plan = fixture(OVERLAPPING);
        let (resolved, diagnostics) = resolve(&plan);
        assert!(resolved.is_none());
        let e005: Vec<&Diagnostic> = diagnostics
            .iter()
            .filter(|d| d.code == Code::E005)
            .collect();
        assert_eq!(e005.len(), 1, "{diagnostics:?}");
        assert_eq!(e005[0].severity, Severity::Error);
        assert_eq!(e005[0].message, "B and C overlap by 1500 × 1000 mm.");
        assert_eq!(e005[0].refs, vec!["B", "C"]);
        assert_eq!(e005[0].span, None);
        Ok(())
    }

    /// W3-04: a loose room is not compared, so only its W001 is given.
    const LOOSE_BESIDE: &str = "plan \"p\"
default_wall 90 source assumed
default_outer_wall 300 source assumed

room A 2000 x 1000 source laser
room B 1500 x 1000 source laser
";

    #[test]
    fn loose_room_is_not_compared_for_overlap() -> Result<(), Box<dyn std::error::Error>> {
        let plan = fixture(LOOSE_BESIDE);
        let (_, diagnostics) = resolve(&plan);
        assert!(
            !diagnostics.iter().any(|d| d.code == Code::E005),
            "{diagnostics:?}"
        );
        let w001 = diagnostics.iter().filter(|d| d.code == Code::W001).count();
        assert_eq!(w001, 2, "{diagnostics:?}");
        Ok(())
    }

    #[test]
    fn fixture_a_has_no_e005() {
        let plan = fixture(FIXTURE_A);
        let (_, diagnostics) = resolve(&plan);
        assert!(
            !diagnostics.iter().any(|d| d.code == Code::E005),
            "{diagnostics:?}"
        );
    }

    /// W020 (§8, D25): dist-1 with its measure made a laser reference.
    fn dist_1_reference(value: &str) -> String {
        const DIST_1: &str = include_str!("../../../fixtures/dist-1.plan");
        DIST_1.replace(
            "measure B.east to A.east = 520 source estimated",
            &format!("measure B.east to A.east = {value} source laser reference"),
        )
    }

    #[test]
    fn reference_measure_off_by_more_than_tolerance_gives_w020() {
        let plan = fixture(&dist_1_reference("520"));
        let (resolved, diagnostics) = resolve(&plan);
        assert!(resolved.is_some(), "{diagnostics:?}");
        assert_eq!(diagnostics.len(), 1, "{diagnostics:?}");
        let d = &diagnostics[0];
        assert_eq!(d.code, Code::W020);
        assert_eq!(d.severity, Severity::Warning);
        assert_eq!(
            d.message,
            "Reference measure B.east→A.east: drawn 500, measured 520 (20 mm)."
        );
        assert_eq!(d.refs, vec!["B.east", "A.east"]);
        assert_eq!(d.data["from"], "B.east");
        assert_eq!(d.data["to"], "A.east");
        assert_eq!(d.data["drawn"], 500);
        assert_eq!(d.data["diff"], 20);
        assert_eq!(d.data["measured"]["value"], 520);
    }

    /// W3-19: wall attributes (§15 D34), opening phase and height, and room phases.
    const REVIEW_1: &str = include_str!("../../../fixtures/review-1.plan");

    #[test]
    fn wall_attributes_openings_and_room_phases() -> Result<(), Box<dyn std::error::Error>> {
        let plan = fixture(REVIEW_1);
        let (resolved, diagnostics) = resolve(&plan);
        assert!(resolved.is_some(), "{diagnostics:?}");
        let resolved = resolved.ok_or("review-1 should resolve")?;

        let interior = resolved
            .walls
            .get("W:A.east|B.west")
            .ok_or("no interior wall W:A.east|B.west")?;
        assert!(interior.bearing);
        assert_eq!(interior.fire.as_deref(), Some("EI60"));
        assert_eq!(interior.phase, Phase::Demolish);

        let north = resolved
            .walls
            .get("W:A.north:outer")
            .ok_or("no wall W:A.north:outer")?;
        assert!(north.bearing);
        assert_eq!(north.fire, None);
        assert_eq!(north.phase, Phase::Existing);

        let b_north = resolved
            .walls
            .get("W:B.north:outer")
            .ok_or("no wall W:B.north:outer")?;
        assert!(!b_north.bearing);

        let door = resolved
            .openings
            .get("O:A.north:1")
            .ok_or("no opening O:A.north:1")?;
        assert_eq!(door.phase, Phase::New);
        assert_eq!(door.height, None);

        let window = resolved
            .openings
            .get("O:B.south:1")
            .ok_or("no opening O:B.south:1")?;
        assert_eq!(window.phase, Phase::New);
        assert_eq!(window.height, Some(1200));

        assert_eq!(
            resolved.room_phases.get(&RoomName::new("A")?),
            Some(&Phase::Existing)
        );
        assert_eq!(
            resolved.room_phases.get(&RoomName::new("B")?),
            Some(&Phase::Demolish)
        );
        Ok(())
    }

    /// W4-02 (§15 D37): the draft keeps the first-pass geometry of a conflict.
    #[test]
    fn fixture_b_draft_keeps_first_pass_geometry() -> Result<(), Box<dyn std::error::Error>> {
        let plan = fixture(FIXTURE_B);
        let (strict, _) = resolve(&plan);
        assert!(strict.is_none());
        let (resolved, diagnostics) = resolve_draft(&plan);
        let e003 = diagnostics.iter().filter(|d| d.code == Code::E003).count();
        assert_eq!(e003, 1, "{diagnostics:?}");
        let resolved = resolved.ok_or("fixture B should draft")?;
        assert_eq!(resolved.diagnostics, diagnostics);
        let garderob = RoomName::new("Garderob")?;
        let sovrum = RoomName::new("Sovrum")?;
        let g = resolved
            .rooms
            .get(&garderob)
            .ok_or("Garderob has no rectangle")?;
        assert_eq!(g.north, 0);
        let s = resolved
            .rooms
            .get(&sovrum)
            .ok_or("Sovrum has no rectangle")?;
        assert_eq!(s.south, 4490);
        Ok(())
    }

    /// W4-02 (§15 D37): fixture C's `align south` gives Vardagsrum the same south
    /// face as Sovrum in the draft.
    #[test]
    fn fixture_c_draft_keeps_first_pass_geometry() -> Result<(), Box<dyn std::error::Error>> {
        let plan = fixture(include_str!("../../../fixtures/lgh154-c.plan"));
        let (resolved, diagnostics) = resolve_draft(&plan);
        let resolved = resolved.ok_or("fixture C should draft")?;
        let sovrum = resolved
            .rooms
            .get(&RoomName::new("Sovrum")?)
            .ok_or("Sovrum has no rectangle")?;
        assert_eq!(sovrum.south, 4540);
        let vardagsrum = resolved
            .rooms
            .get(&RoomName::new("Vardagsrum")?)
            .ok_or("Vardagsrum has no rectangle")?;
        assert_eq!(vardagsrum.south, 4540, "{diagnostics:?}");
        Ok(())
    }

    /// W4-02 (§15 D37): without errors the draft is the same as `resolve`.
    #[test]
    fn fixture_a_draft_equals_resolve() {
        let plan = fixture(FIXTURE_A);
        assert_eq!(resolve_draft(&plan), resolve(&plan));
    }

    /// W4-02 (§15 D37): a room with a zero width leaves nothing to draw.
    #[test]
    fn zero_size_room_has_no_draft() {
        let plan = fixture("room A 0 x 2000 source laser\n");
        let (resolved, diagnostics) = resolve_draft(&plan);
        assert!(resolved.is_none(), "{diagnostics:?}");
    }

    #[test]
    fn reference_measure_within_tolerance_gives_no_diagnostic() {
        let plan = fixture(&dist_1_reference("502"));
        let (resolved, diagnostics) = resolve(&plan);
        assert!(resolved.is_some(), "{diagnostics:?}");
        assert!(diagnostics.is_empty(), "{diagnostics:?}");
    }
}
