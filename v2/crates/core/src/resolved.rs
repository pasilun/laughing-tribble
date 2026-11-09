//! The resolved model: the solved geometry of a plan, computed and never edited
//! directly (spec §5.3).
//!
//! [`resolve`] runs the solver on both axes (§6), then builds the walls, the
//! openings, the areas and the spaces (§9). It returns `None` as soon as an
//! Error diagnostic exists, so a [`Resolved`] always comes from a plan that
//! solves cleanly. The `nodes` field of §5.3 is not filled yet.

use std::collections::BTreeMap;

use serde::Serialize;

use crate::build::{
    Coords, PlacedOpening, SegmentKind, built_walls, diagnose, place_openings, room_areas, spaces,
};
use crate::diagnostics::{Diagnostic, Severity};
use crate::intent::{FaceRef, OpeningKind, Plan, RoomName, Side};
use crate::solve::{
    Axis, FaceKey, assign_coords, check_cycles, components, conflict_diagnostic, edges,
    within_tolerance_diagnostic,
};
use crate::units::{Mm, Source};

/// Id of a wall, as in §5.3 (`W:<A>.<side>|<B>.<side>` or `W:<Room>.<side>:outer`).
pub type WallId = String;
/// Id of an opening, `O:<Room>.<side>:<n>`.
pub type OpeningId = String;

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

/// Whether a wall is between two rooms or on the outside.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum WallKind {
    /// Between two rooms.
    Interior,
    /// On the outside of a room.
    Outer,
}

/// A wall segment of the resolved model (§5.3, without the node ids).
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Wall {
    /// The semantic id.
    pub id: WallId,
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
        diagnostics.extend(comp_diags);
        let (axis_coords, tree) = assign_coords(&all_edges, &comps, axis);
        for check in check_cycles(&all_edges, &axis_coords, &tree, axis) {
            diagnostics.extend(conflict_diagnostic(&check, &all_edges));
            diagnostics.extend(within_tolerance_diagnostic(&check, &all_edges));
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
    let resolved = Resolved {
        rooms: rooms(plan, &coords),
        walls: walls
            .iter()
            .filter_map(|wall| {
                let kind = match wall.kind {
                    SegmentKind::Interior => WallKind::Interior,
                    SegmentKind::Outer => WallKind::Outer,
                    SegmentKind::Open => return None,
                };
                let model = Wall {
                    id: wall.id.clone(),
                    kind,
                    thickness: wall.thickness,
                    thickness_source: wall.source,
                    derived: wall.derived,
                    between: (Some(wall.face.clone()), wall.other.clone()),
                    x: wall.x,
                    y: wall.y,
                };
                Some((wall.id.clone(), model))
            })
            .collect(),
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
    fn fixture_b_has_e003_and_no_model() -> Result<(), Box<dyn std::error::Error>> {
        let plan = fixture(FIXTURE_B);
        let (resolved, diagnostics) = resolve(&plan);
        assert!(resolved.is_none());
        let e003 = diagnostics.iter().filter(|d| d.code == Code::E003).count();
        assert_eq!(e003, 1);
        Ok(())
    }
}
