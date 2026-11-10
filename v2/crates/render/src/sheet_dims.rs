//! The dimension chains on the north and west sides of a sheet (spec §15 D42,
//! card W4-11).
//!
//! The chains are drawn in model mm inside the plan group, with `u = n`, so
//! that 1 mm of paper is `n` model mm. Each chain has ticks at the faces of the
//! rooms with an outer wall on that side, segment lengths where they are at
//! least 6 mm long on paper, and a total when there are more than two ticks.

use std::collections::BTreeSet;

use plan_core::resolved::{Resolved, WallKind};
use plan_core::{Mm, Side};

use crate::svg::text;

/// The segments shorter than this many paper mm get no text.
const MIN_PAPER_MM: f64 = 6.0;

/// The `<g id="dims">` group of the plan at scale 1:`n`, for a plan whose
/// extent starts at `minx`, `miny` (model mm).
pub(crate) fn dims_group(resolved: &Resolved, minx: Mm, miny: Mm, n: u32) -> String {
    let u = f64::from(n);
    let mut parts = Vec::new();

    // North: ticks at the west and east faces, along x; the chain lies above the plan.
    let north = chain_ticks(resolved, Side::North, |rect| [rect.west, rect.east]);
    parts.extend(chain(
        &north,
        miny as f64 - 5.0 * u,
        miny as f64 - 11.0 * u,
        u,
        false,
        |along, across| (along, across),
    ));

    // West: ticks at the north and south faces, along y; the chain lies left of the plan.
    let west = chain_ticks(resolved, Side::West, |rect| [rect.north, rect.south]);
    parts.extend(chain(
        &west,
        minx as f64 - 5.0 * u,
        minx as f64 - 11.0 * u,
        u,
        true,
        |along, across| (across, along),
    ));

    format!(r##"<g id="dims">{}</g>"##, parts.join(""))
}

/// The sorted, de-duplicated coordinates of the faces of the rooms that have an
/// outer wall on `side`. `faces` gives the two coordinates of a room rectangle
/// along the chain.
fn chain_ticks(
    resolved: &Resolved,
    side: Side,
    faces: impl Fn(&plan_core::resolved::RoomRect) -> [Mm; 2],
) -> Vec<Mm> {
    let mut ticks = BTreeSet::new();
    for wall in resolved.walls.values() {
        if wall.kind != WallKind::Outer {
            continue;
        }
        let Some(face) = &wall.between.0 else {
            continue;
        };
        if face.side != side {
            continue;
        }
        if let Some(rect) = resolved.rooms.get(&face.room) {
            ticks.extend(faces(rect));
        }
    }
    ticks.into_iter().collect()
}

/// One chain. `across` is the coordinate of the chain line, `total` that of the
/// total line; `place(along, across)` gives the (x, y) model point. Nothing is
/// drawn with fewer than two ticks.
fn chain(
    ticks: &[Mm],
    across: f64,
    total: f64,
    u: f64,
    vertical: bool,
    place: impl Fn(f64, f64) -> (f64, f64),
) -> Vec<String> {
    let mut out = Vec::new();
    let (Some(&first), Some(&last)) = (ticks.first(), ticks.last()) else {
        return out;
    };
    if ticks.len() < 2 {
        return out;
    }
    let line = |a: f64, b: f64, ca: f64, cb: f64, width: f64| {
        let (x1, y1) = place(a, ca);
        let (x2, y2) = place(b, cb);
        format!(
            r##"<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="#000000" stroke-width="{width}"/>"##
        )
    };
    let label = |along: f64, across_at: f64, size: f64, content: String| {
        let (x, y) = place(along, across_at);
        let extra = if vertical {
            format!(r##" transform="rotate(-90 {x} {y})""##)
        } else {
            String::new()
        };
        text(x, y, size, &extra, &content)
    };
    let tick = |at: Mm, across_at: f64| {
        line(
            at as f64,
            at as f64,
            across_at - 1.5 * u,
            across_at + 1.5 * u,
            0.25 * u,
        )
    };

    // The chain line and its ticks.
    out.push(line(first as f64, last as f64, across, across, 0.25 * u));
    for &t in ticks {
        out.push(tick(t, across));
    }
    // The segments that are long enough to print.
    for pair in ticks.windows(2) {
        let (a, b) = (pair[0], pair[1]);
        let len = b - a;
        if len as f64 / u >= MIN_PAPER_MM {
            let mid = (a + b) as f64 / 2.0;
            out.push(label(mid, across - 2.0 * u, 2.2 * u, len.to_string()));
        }
    }
    // The total, unless the chain has exactly two ticks.
    if ticks.len() > 2 {
        out.push(line(first as f64, last as f64, total, total, 0.25 * u));
        out.push(tick(first, total));
        out.push(tick(last, total));
        let mid = (first + last) as f64 / 2.0;
        out.push(label(
            mid,
            total - 2.0 * u,
            2.2 * u,
            (last - first).to_string(),
        ));
    }
    out
}
