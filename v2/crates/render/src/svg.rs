//! SVG drawing of a resolved plan (W1-23).
//!
//! The viewBox is in mm, with x east and y south like the core coordinates.
//! Elements are written in a fixed order: grid, rooms, walls, openings. Every
//! collection is a `BTreeMap`, so the same model always gives the same text.
//! Each element carries its id in `data-id` and as a label on the drawing.

use plan_core::Resolved;
use plan_core::build::format_m2;
use plan_core::intent::{OpeningKind, Side};
use plan_core::resolved::{ResolvedOpening, RoomRect, Wall, WallKind};
use plan_core::units::Mm;

/// Empty margin around the drawn rooms and walls, in mm.
const PAD: Mm = 500;
/// Grid spacing: one line every 1 m.
const GRID: Mm = 1000;
/// Font size of room names, in mm.
const ROOM_NAME_SIZE: Mm = 200;
/// Font size of room areas, in mm.
const ROOM_AREA_SIZE: Mm = 160;
/// Font size of the id labels on walls and openings, in mm.
const ID_SIZE: Mm = 90;
/// Width of the line that marks an opening, in mm.
const OPENING_LINE: Mm = 30;

/// The font of every text element. Embedded in W2-17.
const FONT_FAMILY: &str = "DejaVu Sans, sans-serif";

/// The SVG drawing of a resolved plan, in mm.
///
/// The viewBox is the extent of the rooms and walls plus [`PAD`] on each side.
/// A model with no rooms and no walls gets a 1 m square.
pub fn plan_svg(resolved: &Resolved) -> String {
    let view = view_box(resolved);
    let mut elements = vec![grid(&view)];
    for (name, rect) in &resolved.rooms {
        elements.push(room(name.as_str(), rect));
    }
    for wall in resolved.walls.values() {
        elements.push(wall_element(wall));
    }
    for opening in resolved.openings.values() {
        elements.push(opening_element(opening, resolved));
    }

    let mut out = format!(
        r##"<svg xmlns="http://www.w3.org/2000/svg" width="{w}mm" height="{h}mm" viewBox="{x} {y} {w} {h}">"##,
        x = view.x,
        y = view.y,
        w = view.w,
        h = view.h,
    );
    out.push('\n');
    out.push_str(&format!(
        r##"<rect x="{x}" y="{y}" width="{w}" height="{h}" fill="#ffffff"/>"##,
        x = view.x,
        y = view.y,
        w = view.w,
        h = view.h,
    ));
    out.push('\n');
    for element in elements {
        out.push_str(&element);
        out.push('\n');
    }
    out.push_str("</svg>\n");
    out
}

/// The drawing area in mm: origin and size.
struct View {
    x: Mm,
    y: Mm,
    w: Mm,
    h: Mm,
}

fn view_box(resolved: &Resolved) -> View {
    // (west, north, east, south) of every room and wall.
    let boxes: Vec<(Mm, Mm, Mm, Mm)> = resolved
        .rooms
        .values()
        .map(|rect| (rect.west, rect.north, rect.east, rect.south))
        .chain(
            resolved
                .walls
                .values()
                .map(|wall| (wall.x.0, wall.y.0, wall.x.1, wall.y.1)),
        )
        .collect();
    let (min_x, min_y, max_x, max_y) = if boxes.is_empty() {
        (0, 0, GRID, GRID)
    } else {
        (
            boxes.iter().map(|b| b.0.min(b.2)).min().unwrap_or(0),
            boxes.iter().map(|b| b.1.min(b.3)).min().unwrap_or(0),
            boxes.iter().map(|b| b.0.max(b.2)).max().unwrap_or(0),
            boxes.iter().map(|b| b.1.max(b.3)).max().unwrap_or(0),
        )
    };
    View {
        x: min_x - PAD,
        y: min_y - PAD,
        w: (max_x - min_x) + 2 * PAD,
        h: (max_y - min_y) + 2 * PAD,
    }
}

/// Lines every [`GRID`] mm across the view, vertical then horizontal.
fn grid(view: &View) -> String {
    let (x_end, y_end) = (view.x + view.w, view.y + view.h);
    let mut lines = String::new();
    for x in multiples(view.x, x_end) {
        lines.push_str(&format!(
            r##"<line x1="{x}" y1="{y0}" x2="{x}" y2="{y1}"/>"##,
            y0 = view.y,
            y1 = y_end,
        ));
    }
    for y in multiples(view.y, y_end) {
        lines.push_str(&format!(
            r##"<line x1="{x0}" y1="{y}" x2="{x1}" y2="{y}"/>"##,
            x0 = view.x,
            x1 = x_end,
        ));
    }
    format!(r##"<g class="grid" stroke="#d0d0d0" stroke-width="8">{lines}</g>"##)
}

/// Every multiple of [`GRID`] in `from..=to`.
fn multiples(from: Mm, to: Mm) -> Vec<Mm> {
    // Round `from` up to a multiple of GRID.
    let first = -((-from).div_euclid(GRID)) * GRID;
    std::iter::successors(Some(first), |value| Some(value + GRID))
        .take_while(|value| *value <= to)
        .collect()
}

/// A room: a light rectangle with its name and area.
fn room(name: &str, rect: &RoomRect) -> String {
    let (w, h) = (rect.east - rect.west, rect.south - rect.north);
    let (cx, cy) = (rect.west + w / 2, rect.north + h / 2);
    let area = format_m2(w.saturating_mul(h));
    let name_label = text(
        cx,
        cy - ROOM_AREA_SIZE / 2,
        ROOM_NAME_SIZE,
        " fill=\"#1a1a1a\"",
        name,
    );
    let area_label = text(
        cx,
        cy + ROOM_NAME_SIZE / 2,
        ROOM_AREA_SIZE,
        " fill=\"#1a1a1a\"",
        &format!("{area} m²"),
    );
    format!(
        r##"<g class="room" data-id="{id}"><rect x="{x}" y="{y}" width="{w}" height="{h}" fill="#eef4fb"/>{name_label}{area_label}</g>"##,
        id = escape(name),
        x = rect.west,
        y = rect.north,
    )
}

/// A wall: a grey rectangle over its x and y extents, labelled with its id.
fn wall_element(wall: &Wall) -> String {
    let (x, y) = (wall.x.0, wall.y.0);
    let (w, h) = (wall.x.1 - wall.x.0, wall.y.1 - wall.y.0);
    let fill = match wall.kind {
        WallKind::Interior => "#a6a6a6",
        WallKind::Outer => "#6e6e6e",
    };
    let label = id_label(&wall.id, x + w / 2, y + h / 2, h > w);
    format!(
        r##"<g class="wall" data-id="{id}"><rect x="{x}" y="{y}" width="{w}" height="{h}" fill="{fill}"/>{label}</g>"##,
        id = escape(&wall.id),
    )
}

/// An opening: a white gap across its wall, a coloured line in the gap, and its id.
///
/// The gap spans the opening's `start..end` along its face and the wall's
/// thickness across it. If the wall is missing, the thickness is the room face.
fn opening_element(opening: &ResolvedOpening, resolved: &Resolved) -> String {
    let horizontal = matches!(opening.face.side, Side::North | Side::South);
    let (lo, hi) = resolved
        .walls
        .get(&opening.wall)
        .map(|wall| if horizontal { wall.y } else { wall.x })
        .or_else(|| face_position(opening, resolved))
        .unwrap_or((0, 0));
    let (start, end) = (opening.start, opening.end);
    let mid = (lo + hi) / 2;
    let (gap, line, cx, cy) = if horizontal {
        (
            (start, lo, end - start, hi - lo),
            (start, mid, end, mid),
            (start + end) / 2,
            mid,
        )
    } else {
        (
            (lo, start, hi - lo, end - start),
            (mid, start, mid, end),
            mid,
            (start + end) / 2,
        )
    };
    let colour = match opening.kind {
        OpeningKind::Door => "#8c4a00",
        OpeningKind::Window => "#1f77d0",
        OpeningKind::Passage => "#2a9d4b",
    };
    let label = id_label(&opening.id, cx, cy, !horizontal);
    format!(
        r##"<g class="opening" data-id="{id}"><rect x="{gx}" y="{gy}" width="{gw}" height="{gh}" fill="#ffffff"/><line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{colour}" stroke-width="{OPENING_LINE}"/>{label}</g>"##,
        id = escape(&opening.id),
        gx = gap.0,
        gy = gap.1,
        gw = gap.2,
        gh = gap.3,
        x1 = line.0,
        y1 = line.1,
        x2 = line.2,
        y2 = line.3,
    )
}

/// The position of an opening's face as a zero-thickness band `(v, v)`, from
/// the room face it sits in. Used only when its wall is missing.
fn face_position(opening: &ResolvedOpening, resolved: &Resolved) -> Option<(Mm, Mm)> {
    let rect = resolved.rooms.get(&opening.face.room)?;
    let value = match opening.face.side {
        Side::North => rect.north,
        Side::South => rect.south,
        Side::East => rect.east,
        Side::West => rect.west,
    };
    Some((value, value))
}

/// The id of an element, centred on `(cx, cy)`; rotated when `vertical`.
fn id_label(id: &str, cx: Mm, cy: Mm, vertical: bool) -> String {
    let transform = if vertical {
        format!(r##" transform="rotate(-90 {cx} {cy})""##)
    } else {
        String::new()
    };
    let extra = format!(
        r##" fill="#111111" stroke="#ffffff" stroke-width="{}" paint-order="stroke"{transform}"##,
        ID_SIZE / 8,
    );
    text(cx, cy, ID_SIZE, &extra, id)
}

/// A `<text>` element centred on `(x, y)` with the drawing font.
fn text(x: Mm, y: Mm, size: Mm, extra: &str, content: &str) -> String {
    format!(
        r##"<text x="{x}" y="{y}" font-size="{size}" font-family="{FONT_FAMILY}" text-anchor="middle" dominant-baseline="central"{extra}>{}</text>"##,
        escape(content),
    )
}

/// Escape the characters that are special in SVG text and attributes.
fn escape(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

#[cfg(test)]
mod tests {
    use super::*;
    use plan_core::dsl::parse;
    use plan_core::resolve;

    const FIXTURE_A: &str = include_str!("../../../fixtures/lgh154-a.plan");

    fn fixture_a() -> Resolved {
        let plan = parse(FIXTURE_A).expect("fixture A parses");
        let (resolved, diagnostics) = resolve(&plan);
        assert!(resolved.is_some(), "{diagnostics:?}");
        resolved.expect("fixture A resolves")
    }

    fn fixture_a_svg() -> String {
        plan_svg(&fixture_a())
    }

    #[test]
    fn one_room_group_per_room_with_name_and_area() {
        let resolved = fixture_a();
        let svg = plan_svg(&resolved);
        assert_eq!(
            svg.matches(r##"<g class="room" "##).count(),
            resolved.rooms.len()
        );
        assert!(svg.contains(r##"data-id="Garderob""##));
        assert!(svg.contains(r##">Garderob</text>"##));
        // Garderob is 1860 x 2360 mm, so 4.3896 m² shows as 4.39.
        assert!(svg.contains(r##">4.39 m²</text>"##));
    }

    #[test]
    fn one_rect_per_wall_with_its_id() {
        let resolved = fixture_a();
        let svg = fixture_a_svg();
        assert_eq!(
            svg.matches(r##"<g class="wall" "##).count(),
            resolved.walls.len()
        );
        assert!(svg.contains(r##"data-id="W:Garderob.east|Hall.west""##));
        assert!(svg.contains(r##">W:Garderob.east|Hall.west</text>"##));
        assert!(svg.contains(r##"fill="#a6a6a6""##));
    }

    #[test]
    fn one_labelled_element_per_opening() {
        let resolved = fixture_a();
        let svg = fixture_a_svg();
        assert_eq!(
            svg.matches(r##"<g class="opening" "##).count(),
            resolved.openings.len()
        );
        for id in resolved.openings.keys() {
            assert!(svg.contains(&format!(r##"data-id="{id}""##)), "{id}");
            assert!(svg.contains(&format!(">{id}</text>")), "{id}");
        }
    }

    #[test]
    fn grid_lines_every_metre() {
        let svg = fixture_a_svg();
        let grid = svg
            .split(r#"<g class="grid""#)
            .nth(1)
            .and_then(|rest| rest.split("</g>").next())
            .expect("grid group");
        let mut vertical = 0;
        let mut horizontal = 0;
        for line in grid.split("<line ").skip(1) {
            let value = |name: &str| -> i64 {
                let start = line.find(name).expect("attribute present") + name.len();
                let rest = &line[start..];
                rest[..rest.find('"').expect("closing quote")]
                    .parse()
                    .expect("integer")
            };
            let (x1, x2) = (value(r##"x1=""##), value(r##"x2=""##));
            let (y1, y2) = (value(r##"y1=""##), value(r##"y2=""##));
            if x1 == x2 {
                assert_eq!(x1 % GRID, 0, "{line}");
                vertical += 1;
            } else {
                assert_eq!(y1, y2);
                assert_eq!(y1 % GRID, 0, "{line}");
                horizontal += 1;
            }
        }
        assert!(vertical >= 2 && horizontal >= 2, "{vertical} {horizontal}");
    }

    #[test]
    fn every_text_uses_the_drawing_font() {
        let svg = fixture_a_svg();
        let texts = svg.matches("<text ").count();
        assert!(texts > 0);
        assert_eq!(
            svg.matches(r##"font-family="DejaVu Sans, sans-serif""##)
                .count(),
            texts
        );
    }

    #[test]
    fn output_is_deterministic() {
        assert_eq!(fixture_a_svg(), fixture_a_svg());
    }
}
