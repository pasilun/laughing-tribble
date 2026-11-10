//! Core entry points for clients (spec §5.3, §10, §15 D3): the MCP server, the
//! renderer and the CLI all parse, check names and resolve the same way, so
//! that work lives here.

use serde::{Deserialize, Serialize};

use crate::diagnostics::Diagnostic;
use crate::dsl::parse;
use crate::intent::{Plan, RoomName, Side};
use crate::resolved::{Resolved, resolve};
use crate::units::Mm;

/// A plan and what the kernel made of it. Lengths in mm, x east, y south.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Resolve {
    pub plan: Plan,
    /// `None` when any Error diagnostic exists (§6.2 step 7).
    pub resolved: Option<Resolved>,
    /// All diagnostics from name resolution, solving and building, in the order the steps ran.
    pub diagnostics: Vec<Diagnostic>,
}

/// Resolve a plan that is already parsed. Never fails; errors are diagnostics.
pub fn resolve_plan(plan: &Plan) -> Resolve {
    let (resolved, diagnostics) = resolve(plan);
    Resolve {
        plan: plan.clone(),
        resolved,
        diagnostics,
    }
}

/// Parse DSL text, check names, and resolve. A parse error or name error
/// (E006, E001, E002) returns `Err` with those diagnostics and nothing else.
///
/// The name check (E001, and E002 for a duplicate room) is part of [`parse`]
/// (§7.4), so it is not repeated here.
pub fn load(src: &str) -> Result<Resolve, Vec<Diagnostic>> {
    let plan = parse(src).map_err(|diagnostic| vec![diagnostic])?;
    Ok(resolve_plan(&plan))
}

/// An axis-aligned rectangle in mm; x0 <= x1 (west to east), y0 <= y1 (north to south).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct RectMm {
    pub x0: Mm,
    pub y0: Mm,
    pub x1: Mm,
    pub y1: Mm,
}

impl RectMm {
    /// x1 - x0.
    pub fn width(&self) -> Mm {
        self.x1 - self.x0
    }

    /// y1 - y0.
    pub fn height(&self) -> Mm {
        self.y1 - self.y0
    }

    /// Smallest rectangle holding both.
    pub fn union(&self, other: &RectMm) -> RectMm {
        RectMm {
            x0: self.x0.min(other.x0),
            y0: self.y0.min(other.y0),
            x1: self.x1.max(other.x1),
            y1: self.y1.max(other.y1),
        }
    }

    /// Grow by `m` mm on every side.
    pub fn pad(&self, m: Mm) -> RectMm {
        RectMm {
            x0: self.x0 - m,
            y0: self.y0 - m,
            x1: self.x1 + m,
            y1: self.y1 + m,
        }
    }
}

/// The rectangle of one element: a room name (its solved inner faces), a wall id
/// (`W:…`, its body), or an opening id (`O:…`). `None` for an unknown id.
///
/// Walls use the body extents already computed for `interior_walls` (§7.7) and
/// outer walls alike. An opening spans its `start`..`end` along its face and the
/// wall's extent across the face.
pub fn element_rect(resolved: &Resolved, id: &str) -> Option<RectMm> {
    let room = RoomName::new(id)
        .ok()
        .and_then(|name| resolved.rooms.get(&name).copied());
    if let Some(room) = room {
        return Some(RectMm {
            x0: room.west,
            y0: room.north,
            x1: room.east,
            y1: room.south,
        });
    }
    if let Some(wall) = resolved.walls.get(id) {
        return Some(RectMm {
            x0: wall.x.0,
            y0: wall.y.0,
            x1: wall.x.1,
            y1: wall.y.1,
        });
    }
    let opening = resolved.openings.get(id)?;
    let wall = resolved.walls.get(&opening.wall)?;
    let rect = match opening.face.side {
        Side::North | Side::South => RectMm {
            x0: opening.start,
            y0: wall.y.0,
            x1: opening.end,
            y1: wall.y.1,
        },
        Side::East | Side::West => RectMm {
            x0: wall.x.0,
            y0: opening.start,
            x1: wall.x.1,
            y1: opening.end,
        },
    };
    Some(rect)
}

/// Every room name, wall id and opening id, sorted: rooms (by name), then walls,
/// then openings.
pub fn element_ids(resolved: &Resolved) -> Vec<String> {
    resolved
        .rooms
        .keys()
        .map(ToString::to_string)
        .chain(resolved.walls.keys().cloned())
        .chain(resolved.openings.keys().cloned())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::diagnostics::Code;
    use crate::report::solve_json;
    use serde_json::Value;

    const FIXTURE_A: &str = include_str!("../../../fixtures/lgh154-a.plan");
    const FIXTURE_B: &str = include_str!("../../../fixtures/lgh154-b.plan");
    const EXPECTED_A: &str = include_str!("../../../fixtures/lgh154-a.expected.json");

    #[test]
    fn load_fixture_a() {
        let r = load(FIXTURE_A).expect("fixture A loads");
        assert!(r.resolved.is_some(), "{:?}", r.diagnostics);
        let value = solve_json("lgh154-a", r.resolved.as_ref(), &r.diagnostics);
        let expected: Value = serde_json::from_str(EXPECTED_A).expect("expected JSON parses");
        // The §7.7 comparer is not reachable from core tests, so compare the
        // geometry objects exactly.
        assert_eq!(value["faces"], expected["faces"], "{value:#}");
        assert_eq!(value["areas_mm2"], expected["areas_mm2"], "{value:#}");
    }

    #[test]
    fn load_fixture_b() {
        let r = load(FIXTURE_B).expect("fixture B loads");
        assert!(r.resolved.is_none());
        assert_eq!(r.diagnostics.len(), 1, "{:?}", r.diagnostics);
        assert_eq!(r.diagnostics[0].code, Code::E003);
    }

    #[test]
    fn load_parse_error() {
        let ds = load("room A 3000 * 2000\n").expect_err("parse error");
        assert_eq!(ds.len(), 1);
        assert_eq!(ds[0].code, Code::E006);
    }

    #[test]
    fn load_unknown_room() {
        let ds = load("room Sovrum 1 x 1\nroom B 1 x 1\n  east_of Sovrun gap\n")
            .expect_err("unknown room");
        assert_eq!(ds.len(), 1);
        assert_eq!(ds[0].code, Code::E001);
    }

    fn rect(x0: Mm, y0: Mm, x1: Mm, y1: Mm) -> RectMm {
        RectMm { x0, y0, x1, y1 }
    }

    #[test]
    fn element_rects_for_fixture_a() {
        let r = load(FIXTURE_A).expect("fixture A loads");
        let model = r.resolved.as_ref().expect("fixture A resolves");
        assert_eq!(
            element_rect(model, "Garderob"),
            Some(rect(0, 0, 1860, 2360))
        );
        assert_eq!(
            element_rect(model, "W:Garderob.east|Hall.west"),
            Some(rect(1860, 0, 1981, 1113))
        );
        assert_eq!(
            element_rect(model, "W:Vardagsrum.north|WC.south"),
            Some(rect(3081, 990, 5541, 1113))
        );
        assert_eq!(
            element_rect(model, "O:WC.west:1"),
            Some(rect(3081, 240, 3171, 690))
        );
        assert_eq!(element_rect(model, "Nope"), None);
    }

    #[test]
    fn element_ids_for_fixture_a() {
        let r = load(FIXTURE_A).expect("fixture A loads");
        let model = r.resolved.as_ref().expect("fixture A resolves");
        let ids = element_ids(model);
        let head: Vec<&str> = ids.iter().take(5).map(String::as_str).collect();
        assert_eq!(head, ["Garderob", "Hall", "Sovrum", "Vardagsrum", "WC"]);
        assert!(ids.iter().any(|id| id == "O:WC.west:1"), "{ids:?}");
    }

    #[test]
    fn rect_helpers() {
        let a = rect(0, 0, 10, 20);
        let b = rect(5, -3, 12, 4);
        assert_eq!(a.width(), 10);
        assert_eq!(a.height(), 20);
        assert_eq!(a.union(&b), rect(0, -3, 12, 20));
        assert_eq!(a.pad(2), rect(-2, -2, 12, 22));
    }
}
