//! Outer corners of the drawing (spec §15 D28).
//!
//! An outer wall on a north or south face is drawn longer by the thickness of
//! the adjoining east or west outer wall of the same room, so the corner square
//! is covered. The model does not change: only the drawn rectangle does.

use plan_core::intent::Side;
use plan_core::resolved::{Resolved, Wall, WallKind};
use plan_core::units::Mm;

/// The rectangle to draw for `wall`: (x0, y0, x1, y1) in mm.
pub(crate) fn corner_rect(wall: &Wall, resolved: &Resolved) -> (Mm, Mm, Mm, Mm) {
    let (mut x0, y0, mut x1, y1) = (wall.x.0, wall.y.0, wall.x.1, wall.y.1);
    if wall.kind != WallKind::Outer {
        return (x0, y0, x1, y1);
    }
    let Some(face) = &wall.between.0 else {
        return (x0, y0, x1, y1);
    };
    let Some(r) = resolved.rooms.get(&face.room) else {
        return (x0, y0, x1, y1);
    };
    if matches!(face.side, Side::North | Side::South) {
        // The outer wall of the adjoining face lies on this room's north or
        // south line, at the end of the drawn wall.
        let on_line = |v: &Wall| match face.side {
            Side::North => v.y.0 == r.north,
            _ => v.y.1 == r.south,
        };
        let corner_thickness = |side: Side| {
            resolved.walls.values().find_map(|v| {
                let adjoins = v.kind == WallKind::Outer
                    && v.between
                        .0
                        .as_ref()
                        .is_some_and(|f| f.room == face.room && f.side == side);
                (adjoins && on_line(v)).then_some(v.thickness)
            })
        };
        if wall.x.0 == r.west
            && let Some(thickness) = corner_thickness(Side::West)
        {
            x0 -= thickness;
        }
        if wall.x.1 == r.east
            && let Some(thickness) = corner_thickness(Side::East)
        {
            x1 += thickness;
        }
    }
    (x0, y0, x1, y1)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::svg::plan_svg;

    const FIXTURE_A: &str = include_str!("../../../fixtures/lgh154-a.plan");

    fn fixture_a() -> Resolved {
        let loaded = plan_core::load(FIXTURE_A).expect("fixture A loads");
        loaded.resolved.expect("fixture A resolves")
    }

    /// The drawn rectangle of the wall with `id`.
    fn drawn(resolved: &Resolved, id: &str) -> (Mm, Mm, Mm, Mm) {
        let wall = resolved
            .walls
            .get(id)
            .unwrap_or_else(|| panic!("no wall {id}"));
        corner_rect(wall, resolved)
    }

    #[test]
    fn north_outer_wall_covers_the_west_corner_square() {
        let resolved = fixture_a();
        assert_eq!(
            drawn(&resolved, "W:Garderob.north:outer"),
            (-300, -300, 1981, 0)
        );
    }

    #[test]
    fn north_outer_wall_covers_the_east_corner_square() {
        let resolved = fixture_a();
        assert_eq!(drawn(&resolved, "W:WC.north:outer"), (3171, -300, 5841, 0));
    }

    #[test]
    fn south_outer_walls_cover_their_corner_squares() {
        let resolved = fixture_a();
        assert_eq!(
            drawn(&resolved, "W:Sovrum.south:outer"),
            (-300, 4540, 1981, 4840)
        );
        assert_eq!(
            drawn(&resolved, "W:Vardagsrum.south:outer"),
            (1981, 4593, 5841, 4893)
        );
    }

    #[test]
    fn north_outer_wall_without_a_corner_wall_is_unchanged() {
        let resolved = fixture_a();
        assert_eq!(
            drawn(&resolved, "W:Hall.north:outer"),
            (1981, -300, 3171, 0)
        );
    }

    #[test]
    fn east_and_west_outer_walls_are_unchanged() {
        let resolved = fixture_a();
        assert_eq!(
            drawn(&resolved, "W:Garderob.west:outer"),
            (-300, 0, 0, 2450)
        );
    }

    #[test]
    fn interior_walls_are_unchanged() {
        let resolved = fixture_a();
        assert_eq!(
            drawn(&resolved, "W:Hall.east|WC.west"),
            (3081, 0, 3171, 1113)
        );
    }

    #[test]
    fn plan_svg_draws_the_extended_north_wall() {
        let svg = plan_svg(&fixture_a());
        assert!(
            svg.contains(
                r##"data-id="W:Garderob.north:outer"><rect x="-300" y="-300" width="2281" height="300""##
            ),
            "{svg}"
        );
    }
}
