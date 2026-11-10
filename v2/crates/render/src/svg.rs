//! SVG drawing of a resolved plan (W1-23).
//!
//! The viewBox is in mm, with x east and y south like the core coordinates.
//! Elements are written in a fixed order: grid, rooms, walls, stubs, fixtures, openings. Every
//! collection is a `BTreeMap`, so the same model always gives the same text.
//! Each element carries its id in `data-id` and as a label on the drawing.

use plan_core::Resolved;
use plan_core::build::format_m2;
use plan_core::intent::{FixtureKind, OpeningKind, Phase, RoomName, Side};
use plan_core::resolved::{
    ResolvedFixture, ResolvedOpening, ResolvedStub, RoomRect, Wall, WallKind,
};
use plan_core::units::Mm;

use crate::corners::corner_rect;

/// Empty margin around the drawn rooms and walls, in mm.
pub(crate) const PAD: Mm = 500;
/// Grid spacing: one line every 1 m.
pub(crate) const GRID: Mm = 1000;
/// Font size of room names, in mm.
const ROOM_NAME_SIZE: Mm = 200;
/// Font size of room areas, in mm.
const ROOM_AREA_SIZE: Mm = 160;
/// Font size of the id labels on walls and openings, in mm.
const ID_SIZE: Mm = 90;
/// Width of the line that marks an opening, in mm.
const OPENING_LINE: Mm = 30;

/// The font of every text element. Embedded in W2-17.
pub(crate) const FONT_FAMILY: &str = "DejaVu Sans, sans-serif";

/// Font sizes of the room name and area labels, in viewBox units.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct RoomFonts {
    pub name: f64,
    pub area: f64,
}

/// Room fonts of the whole-plan drawing: names 200 mm, areas 160 mm.
pub(crate) const PLAN_ROOM_FONTS: RoomFonts = RoomFonts {
    name: ROOM_NAME_SIZE as f64,
    area: ROOM_AREA_SIZE as f64,
};

/// The SVG drawing of a resolved plan, in mm.
///
/// The viewBox is the extent of the rooms and walls plus [`PAD`] on each side.
/// A model with no rooms and no walls gets a 1 m square.
pub fn plan_svg(resolved: &Resolved) -> String {
    let view = view_box(resolved);
    let mut elements = vec![grid(&view)];
    elements.extend(drawn_elements(
        resolved,
        PLAN_ROOM_FONTS,
        OPENING_LINE as f64,
        false,
    ));

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

/// The rooms, walls, stubs, fixtures and openings, in that order, each as one
/// SVG element. `fonts` sets the room and label sizes and `opening_stroke` the width
/// of the opening lines, both in viewBox units; everything else is in mm.
/// `sheet` draws the black and white sheet style (spec §15 D49): untinted rooms
/// and black openings, a window as a framed double line.
pub(crate) fn drawn_elements(
    resolved: &Resolved,
    fonts: RoomFonts,
    opening_stroke: f64,
    sheet: bool,
) -> Vec<String> {
    let mut elements = Vec::new();
    for (name, rect) in &resolved.rooms {
        let area = printed_area(resolved, name);
        elements.push(room(name.as_str(), rect, area, fonts, sheet, None));
    }
    for wall in resolved.walls.values() {
        elements.push(wall_element(wall, resolved, opening_stroke));
    }
    for stub in resolved.stubs.values() {
        elements.push(stub_element(stub, opening_stroke));
    }
    for fixture in resolved.fixtures.values() {
        elements.push(fixture_element(fixture, fonts, opening_stroke));
    }
    for opening in resolved.openings.values() {
        elements.push(opening_element(opening, resolved, opening_stroke, sheet));
    }
    elements
}

/// Every multiple of [`GRID`] in `from..=to`.
pub(crate) fn multiples(from: Mm, to: Mm) -> Vec<Mm> {
    // Round `from` up to a multiple of GRID.
    let first = -((-from).div_euclid(GRID)) * GRID;
    std::iter::successors(Some(first), |value| Some(value + GRID))
        .take_while(|value| *value <= to)
        .collect()
}

/// Whether `name` is a part of another room (§15 D46): it has a rectangle and
/// so does its parent. A part prints no name and no area.
pub(crate) fn is_part(resolved: &Resolved, name: &RoomName) -> bool {
    resolved.room_parts.contains_key(name)
}

/// Whether some part belongs to `name` (§15 D46).
pub(crate) fn has_parts(resolved: &Resolved, name: &RoomName) -> bool {
    resolved.room_parts.values().any(|parent| parent == name)
}

/// The area a room prints, in mm² (§15 D46). `None` for a part. A room with a
/// rectangle prints its own area, plus the area of each of its parts' rectangles.
pub(crate) fn printed_area(resolved: &Resolved, name: &RoomName) -> Option<i64> {
    if is_part(resolved, name) {
        return None;
    }
    let rect_area =
        |rect: &RoomRect| (rect.east - rect.west).saturating_mul(rect.south - rect.north);
    let own = rect_area(resolved.rooms.get(name)?);
    let parts = resolved
        .room_parts
        .iter()
        .filter(|(_, parent)| *parent == name)
        .filter_map(|(part, _)| resolved.rooms.get(part))
        .map(rect_area)
        .fold(0i64, i64::saturating_add);
    Some(own.saturating_add(parts))
}

/// A room: a light rectangle with its name and area. `area` is the printed
/// area in mm² (see [`printed_area`]); `None` (a part) prints no text. On a
/// sheet (`sheet`, D49) the rectangle is white. `label` is the centre of the
/// name and area texts, `None` for the rectangle's centre.
pub(crate) fn room(
    name: &str,
    rect: &RoomRect,
    area: Option<i64>,
    fonts: RoomFonts,
    sheet: bool,
    label: Option<(f64, f64)>,
) -> String {
    let fill = if sheet { "#ffffff" } else { "#eef4fb" };
    let (w, h) = (rect.east - rect.west, rect.south - rect.north);
    let (cx, cy) = label.unwrap_or(((rect.west + w / 2) as f64, (rect.north + h / 2) as f64));
    let labels = match area {
        Some(area) => {
            let name_label = text(
                cx,
                cy - fonts.area / 2.0,
                fonts.name,
                " fill=\"#1a1a1a\"",
                name,
            );
            let area_label = text(
                cx,
                cy + fonts.name / 2.0,
                fonts.area,
                " fill=\"#1a1a1a\"",
                &format!("{} m²", format_m2(area)),
            );
            format!("{name_label}{area_label}")
        }
        None => String::new(),
    };
    format!(
        r##"<g class="room" data-id="{id}"><rect x="{x}" y="{y}" width="{w}" height="{h}" fill="{fill}"/>{labels}</g>"##,
        id = escape(name),
        x = rect.west,
        y = rect.north,
    )
}

/// A wall: a grey rectangle, labelled with its id. The rectangle is the
/// [`corner_rect`] of the wall (D28); the label is centred on the wall's own
/// x and y extents. A demolished wall is a white rectangle with a dashed red
/// outline, a new wall is near-black, and an existing wall is grey. An existing
/// bearing or separating wall (§15 D47) is darker grey, interior or outer. `s` is
/// the opening stroke width, which also sets the dash pattern.
fn wall_element(wall: &Wall, resolved: &Resolved, s: f64) -> String {
    let (x0, y0, x1, y1) = corner_rect(wall, resolved);
    let (x, y) = (x0, y0);
    let (w, h) = (x1 - x0, y1 - y0);
    let heavy = wall.bearing || wall.separating;
    let (fill, outline) = match (wall.phase, wall.kind) {
        (Phase::Demolish, _) => (
            "#ffffff",
            format!(r##" stroke="#c62828" stroke-width="{s}"{}"##, dash_attr(s)),
        ),
        (Phase::New, _) => ("#1a1a1a", String::new()),
        (Phase::Existing, _) if heavy => ("#4a4a4a", String::new()),
        (Phase::Existing, WallKind::Interior) => ("#a6a6a6", String::new()),
        (Phase::Existing, WallKind::Outer) => ("#6e6e6e", String::new()),
    };
    let (own_w, own_h) = (wall.x.1 - wall.x.0, wall.y.1 - wall.y.0);
    let label = id_label(
        &wall.id,
        wall.x.0 + own_w / 2,
        wall.y.0 + own_h / 2,
        own_h > own_w,
    );
    format!(
        r##"<g class="wall" data-id="{id}"><rect x="{x}" y="{y}" width="{w}" height="{h}" fill="{fill}"{outline}/>{label}</g>"##,
        id = escape(&wall.id),
    )
}

/// A wall stub (spec §15 D45): its rectangle as one group, with no label. It is
/// styled as a wall of its phase (W3-20): existing in the interior wall grey,
/// new near-black, and demolished white with a dashed red outline. `s` is the
/// opening stroke width, which also sets the dash pattern.
fn stub_element(stub: &ResolvedStub, s: f64) -> String {
    let (fill, outline) = match stub.phase {
        Phase::Demolish => (
            "#ffffff",
            format!(r##" stroke="#c62828" stroke-width="{s}"{}"##, dash_attr(s)),
        ),
        Phase::New => ("#1a1a1a", String::new()),
        Phase::Existing => ("#a6a6a6", String::new()),
    };
    format!(
        r##"<g class="wall stub" data-id="{id}"><rect x="{x}" y="{y}" width="{w}" height="{h}" fill="{fill}"{outline}/></g>"##,
        id = escape(&stub.id),
        x = stub.x.0,
        y = stub.y.0,
        w = stub.x.1 - stub.x.0,
        h = stub.y.1 - stub.y.0,
    )
}

/// The dash pattern of a demolished element: 4 strokes on, 3 off.
fn dash_attr(s: f64) -> String {
    format!(r##" stroke-dasharray="{} {}""##, 4.0 * s, 3.0 * s)
}

/// A fixture: its rectangle and the symbol of its kind, as one group (spec §15
/// D44). `s` is the opening stroke width. Strokes are `#333333` at `s/2`; a
/// demolished fixture has red dashed strokes, a new one near-black strokes at
/// `s`. A label, or `P` for a plug, is centred in the rectangle.
fn fixture_element(fixture: &ResolvedFixture, fonts: RoomFonts, s: f64) -> String {
    let kind = fixture.kind;
    let (x0, y0) = (fixture.x.0 as f64, fixture.y.0 as f64);
    let (w, h) = (
        (fixture.x.1 - fixture.x.0) as f64,
        (fixture.y.1 - fixture.y.0) as f64,
    );
    let m = w.min(h);
    let (cx, cy) = (x0 + w / 2.0, y0 + h / 2.0);
    let demolish = fixture.phase == Phase::Demolish;
    let (colour, width) = match fixture.phase {
        Phase::Demolish => ("#c62828", s / 2.0),
        Phase::New => ("#1a1a1a", s),
        Phase::Existing => ("#333333", s / 2.0),
    };
    // Every stroke of a demolished fixture is dashed.
    let dash = if demolish {
        dash_attr(s)
    } else {
        String::new()
    };
    let style = |fill: &str, dash: &str| {
        format!(r##" fill="{fill}" stroke="{colour}" stroke-width="{width}"{dash}"##)
    };
    // A shower's rectangle is dashed even when it is not demolished.
    let rect_dash = if kind == FixtureKind::Shower && !demolish {
        format!(r##" stroke-dasharray="{} {}""##, 2.0 * s, 2.0 * s)
    } else {
        dash.clone()
    };
    let rect_fill = match kind {
        FixtureKind::Radiator => "#333333",
        FixtureKind::Balcony => "none",
        _ => "#ffffff",
    };
    let mut shapes = vec![format!(
        r##"<rect x="{x0}" y="{y0}" width="{w}" height="{h}"{attrs}/>"##,
        attrs = style(rect_fill, &rect_dash),
    )];
    let inset = |i: f64, rx: Option<f64>| {
        let rx = rx.map_or_else(String::new, |rx| format!(r##" rx="{rx}""##));
        format!(
            r##"<rect x="{}" y="{}" width="{}" height="{}"{rx}{}/>"##,
            x0 + i,
            y0 + i,
            w - 2.0 * i,
            h - 2.0 * i,
            style("none", &dash),
        )
    };
    let diagonals = || {
        format!(
            r##"<line x1="{x0}" y1="{y0}" x2="{x2}" y2="{y2}"{a}/><line x1="{x2}" y1="{y0}" x2="{x0}" y2="{y2}"{a}/>"##,
            x2 = x0 + w,
            y2 = y0 + h,
            a = style("none", &dash),
        )
    };
    match kind {
        FixtureKind::Stove => {
            let r = m / 8.0;
            for (px, py) in [
                (x0 + w / 4.0, y0 + h / 4.0),
                (x0 + 3.0 * w / 4.0, y0 + h / 4.0),
                (x0 + w / 4.0, y0 + 3.0 * h / 4.0),
                (x0 + 3.0 * w / 4.0, y0 + 3.0 * h / 4.0),
            ] {
                shapes.push(format!(
                    r##"<circle cx="{px}" cy="{py}" r="{r}"{}/>"##,
                    style("none", &dash),
                ));
            }
        }
        FixtureKind::Sink => shapes.push(inset(m / 6.0, None)),
        FixtureKind::Wc => shapes.push(format!(
            r##"<ellipse cx="{cx}" cy="{cy}" rx="{rx}" ry="{ry}"{}/>"##,
            style("none", &dash),
            rx = w * 35.0 / 100.0,
            ry = h * 35.0 / 100.0,
        )),
        FixtureKind::Shower => shapes.push(format!(
            r##"<circle cx="{cx}" cy="{cy}" r="{r}"{}/>"##,
            style("#ffffff", &dash),
            r = m / 10.0,
        )),
        FixtureKind::Bath => shapes.push(inset(m / 8.0, Some(m / 4.0))),
        FixtureKind::Exhaust | FixtureKind::Shaft => shapes.push(diagonals()),
        FixtureKind::Kitchen
        | FixtureKind::Radiator
        | FixtureKind::Plug
        | FixtureKind::Box
        | FixtureKind::Balcony => {}
    }
    // The label, or `P` for a plug, centred in the rectangle.
    let caption = match (&fixture.label, kind) {
        (Some(label), _) => Some((label.as_str(), fonts.area)),
        (None, FixtureKind::Plug) => Some(("P", 0.8 * m)),
        (None, _) => None,
    };
    if let Some((content, size)) = caption {
        shapes.push(text(
            cx,
            cy,
            size,
            &format!(r##" fill="{colour}""##),
            content,
        ));
    }
    format!(
        r##"<g class="fixture" data-id="{id}" data-kind="{word}">{body}</g>"##,
        id = escape(&fixture.id),
        word = kind.word(),
        body = shapes.concat(),
    )
}

/// An opening: a white gap across its wall, a coloured line in the gap, and its id.
///
/// The gap spans the opening's `start..end` along its face and the wall's
/// thickness across it. If the wall is missing, the thickness is the room face.
/// The coloured line is `stroke` wide.
///
/// On a sheet (`sheet`, D49) the gap has a black outline `stroke / 2` wide, the
/// line and door path are black, and a window is two lines at a third and two
/// thirds of the wall thickness instead of the centre line. A demolished
/// opening keeps its red dashed look.
fn opening_element(
    opening: &ResolvedOpening,
    resolved: &Resolved,
    stroke: f64,
    sheet: bool,
) -> String {
    let horizontal = matches!(opening.face.side, Side::North | Side::South);
    let (lo, hi) = across(opening, resolved);
    let (start, end) = (opening.start, opening.end);
    let mid = (lo + hi) / 2;
    // The gap rectangle, and a line from `start` to `end` across the wall at `across`.
    let (gap, cx, cy) = if horizontal {
        ((start, lo, end - start, hi - lo), (start + end) / 2, mid)
    } else {
        ((lo, start, hi - lo, end - start), mid, (start + end) / 2)
    };
    let seg = |across: Mm| {
        if horizontal {
            (start, across, end, across)
        } else {
            (across, start, across, end)
        }
    };
    // A demolished opening is drawn red and dashed; new and existing ones as usual.
    let demolish = opening.phase == Phase::Demolish;
    let colour = match (demolish, opening.kind) {
        (true, _) => "#c62828",
        (false, _) if sheet => "#000000",
        (false, OpeningKind::Door) => "#8c4a00",
        (false, OpeningKind::Window) => "#1f77d0",
        (false, OpeningKind::Passage) => "#2a9d4b",
    };
    let dash = if demolish {
        dash_attr(stroke)
    } else {
        String::new()
    };
    let line_element = |(x1, y1, x2, y2): (Mm, Mm, Mm, Mm)| {
        format!(
            r##"<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{colour}" stroke-width="{stroke}"{dash}/>"##
        )
    };
    let lines = if sheet && opening.kind == OpeningKind::Window {
        [lo + (hi - lo) / 3, lo + 2 * (hi - lo) / 3]
            .into_iter()
            .map(|across| line_element(seg(across)))
            .collect::<String>()
    } else {
        line_element(seg(mid))
    };
    let gap_outline = if sheet {
        format!(r##" stroke="#000000" stroke-width="{}""##, stroke / 2.0)
    } else {
        String::new()
    };
    let label = id_label(&opening.id, cx, cy, !horizontal);
    let swing = swing_path(opening, (lo, hi), colour, stroke, &dash);
    format!(
        r##"<g class="opening" data-id="{id}"><rect x="{gx}" y="{gy}" width="{gw}" height="{gh}" fill="#ffffff"{gap_outline}/>{lines}{swing}{label}</g>"##,
        id = escape(&opening.id),
        gx = gap.0,
        gy = gap.1,
        gw = gap.2,
        gh = gap.3,
    )
}

/// The leaf and swing arc of a hinged door (spec §9.3, D29). Empty for
/// windows, passages and doors without a hinge.
///
/// `wall` is the wall's extent across its thickness, `(lo, hi)`. `dash` is the
/// dash attribute of a demolished door, or empty.
fn swing_path(
    opening: &ResolvedOpening,
    wall: (Mm, Mm),
    colour: &str,
    stroke: f64,
    dash: &str,
) -> String {
    let Some([(hx, hy), (lx, ly), (jx, jy)]) = swing_points(opening, wall) else {
        return String::new();
    };
    let w = opening.end - opening.start;
    let cross = (lx - hx) * (jy - hy) - (ly - hy) * (jx - hx);
    let sweep = u8::from(cross > 0);
    format!(
        r##"<path d="M {hx} {hy} L {lx} {ly} A {w} {w} 0 0 {sweep} {jx} {jy}" fill="none" stroke="{colour}" stroke-width="{}"{dash}/>"##,
        stroke / 2.0,
    )
}

/// The points H (hinge), L (leaf end) and J (other jamb) of a hinged door's
/// swing path (W3-13), in model mm. `wall` is the wall's extent across its
/// thickness, `(lo, hi)`. `None` for windows, passages and doors without a hinge.
fn swing_points(opening: &ResolvedOpening, wall: (Mm, Mm)) -> Option<[(Mm, Mm); 3]> {
    if !matches!(opening.kind, OpeningKind::Door) {
        return None;
    }
    let hinge = opening.hinge?;
    let (lo, hi) = wall;
    let (start, end) = (opening.start, opening.end);
    let w = end - start;
    let side = opening.face.side;
    let room = &opening.face.room;
    let target = opening.opens_into.as_ref().unwrap_or(room);
    let inward = target == room;
    let horizontal = matches!(side, Side::North | Side::South);
    let positive = matches!(side, Side::South | Side::East);
    // The face line on the target room's side of the wall.
    let c = if positive == inward { lo } else { hi };
    // The leaf direction, away from the wall into the target room.
    let s = if positive == inward { -1 } else { 1 };
    // The hinge end of the face, and the other jamb.
    let hinge_at_end = matches!(hinge, Side::East | Side::South);
    let (a, b) = if hinge_at_end {
        (end, start)
    } else {
        (start, end)
    };
    let points = if horizontal {
        [(a, c), (a, c + s * w), (b, c)]
    } else {
        [(c, a), (c + s * w, a), (c, b)]
    };
    Some(points)
}

/// The bounding box `(x0, y0, x1, y1)` of a hinged door's swing, in model mm:
/// the box of its points H, L and J (see [`swing_points`]). `None` for an
/// opening with no swing. Used by the sheet to keep room labels off swings (D49).
pub(crate) fn swing_box(
    opening: &ResolvedOpening,
    resolved: &Resolved,
) -> Option<(Mm, Mm, Mm, Mm)> {
    let points = swing_points(opening, across(opening, resolved))?;
    let xs = points.map(|(x, _)| x);
    let ys = points.map(|(_, y)| y);
    Some((
        xs.into_iter().min()?,
        ys.into_iter().min()?,
        xs.into_iter().max()?,
        ys.into_iter().max()?,
    ))
}

/// The extent of an opening's wall across its thickness, `(lo, hi)`: the
/// wall's extent, or the room face's position when the wall is missing.
pub(crate) fn across(opening: &ResolvedOpening, resolved: &Resolved) -> (Mm, Mm) {
    let horizontal = matches!(opening.face.side, Side::North | Side::South);
    resolved
        .walls
        .get(&opening.wall)
        .map(|wall| if horizontal { wall.y } else { wall.x })
        .or_else(|| face_position(opening, resolved))
        .unwrap_or((0, 0))
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
    text(cx as f64, cy as f64, ID_SIZE as f64, &extra, id)
}

/// A `<text>` element centred on `(x, y)` with the drawing font.
pub(crate) fn text(x: f64, y: f64, size: f64, extra: &str, content: &str) -> String {
    format!(
        r##"<text x="{x}" y="{y}" font-size="{size}" font-family="{FONT_FAMILY}" text-anchor="middle" dominant-baseline="central"{extra}>{}</text>"##,
        escape(content),
    )
}

/// Escape the characters that are special in SVG text and attributes.
pub(crate) fn escape(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::render::{RenderOptions, View, render};
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

    #[test]
    fn hinged_door_has_leaf_and_swing_arc() {
        let svg = fixture_a_svg();
        assert!(
            svg.contains(r##"<path d="M 3081 690 L 2631 690 A 450 450 0 0 1 3081 240""##),
            "{svg}"
        );
        // Fixture A has one hinged door and no other arcs.
        assert_eq!(svg.matches("<path ").count(), 1);
    }

    const REVIEW_1: &str = include_str!("../../../fixtures/review-1.plan");

    fn review_1_svg() -> String {
        let plan = parse(REVIEW_1).expect("review-1 parses");
        let (resolved, diagnostics) = resolve(&plan);
        let resolved = resolved.expect("review-1 resolves");
        assert!(diagnostics.is_empty(), "{diagnostics:?}");
        plan_svg(&resolved)
    }

    fn element_with<'a>(svg: &'a str, data_id: &str) -> &'a str {
        let needle = format!(r##"data-id="{data_id}""##);
        svg.lines()
            .find(|line| line.contains(&needle))
            .unwrap_or_else(|| panic!("no element {data_id}"))
    }

    #[test]
    fn demolished_wall_is_a_dashed_red_outline() {
        let svg = review_1_svg();
        let wall = element_with(&svg, "W:A.east|B.west");
        assert!(
            wall.contains(
                r##"fill="#ffffff" stroke="#c62828" stroke-width="30" stroke-dasharray="120 90""##
            ),
            "{wall}"
        );
    }

    #[test]
    fn existing_outer_wall_is_unchanged() {
        let svg = review_1_svg();
        let wall = element_with(&svg, "W:A.north:outer");
        assert!(wall.contains(r##"fill="#4a4a4a""##), "{wall}");
        assert!(!wall.contains("stroke-dasharray"), "{wall}");
    }

    /// §15 D47: two flats, so the wall between them is separating.
    const APARTMENTS: &str = "plan \"p\"
default_wall 90
default_outer_wall 300

room A 3000 x 2000 source laser apartment \"1\"
room B 2000 x 2000 source laser apartment \"2\"
  east_of A gap
  align north A
";

    fn apartments_svg() -> String {
        let plan = parse(APARTMENTS).expect("apartments parse");
        let (resolved, diagnostics) = resolve(&plan);
        assert!(diagnostics.is_empty(), "{diagnostics:?}");
        plan_svg(&resolved.expect("apartments resolve"))
    }

    #[test]
    fn separating_wall_is_dark_grey() {
        let svg = apartments_svg();
        let wall = element_with(&svg, "W:A.east|B.west");
        assert!(wall.contains(r##"fill="#4a4a4a""##), "{wall}");
    }

    #[test]
    fn fixture_a_has_no_dark_grey_wall() {
        let svg = fixture_a_svg();
        assert!(!svg.contains(r##"fill="#4a4a4a""##));
    }

    #[test]
    fn existing_fixture_has_no_demolish_or_new_wall_drawing() {
        let svg = fixture_a_svg();
        assert!(!svg.contains("#c62828"));
        assert!(!svg.contains(r##"#1a1a1a"/>"##));
    }

    #[test]
    fn new_wall_is_near_black() {
        let plan = parse("plan \"A\"\nroom A 3000 x 2000 source laser\nwall A.south new\n")
            .expect("parses");
        let (resolved, diagnostics) = resolve(&plan);
        let resolved = resolved.expect("resolves");
        assert!(diagnostics.is_empty(), "{diagnostics:?}");
        let svg = plan_svg(&resolved);
        let wall = element_with(&svg, "W:A.south:outer");
        assert!(wall.contains(r##"fill="#1a1a1a""##), "{wall}");
    }

    #[test]
    fn swing_arc_into_its_own_room() {
        let plan = parse("plan \"A\"\nroom A 3000 x 2000 source laser\ndoor A.north at 500 width 900 hinge west opens A\n")
            .expect("parses");
        let (resolved, diagnostics) = resolve(&plan);
        let resolved = resolved.expect("resolves");
        assert!(diagnostics.is_empty(), "{diagnostics:?}");
        let svg = plan_svg(&resolved);
        assert!(
            svg.contains(r##"<path d="M 500 0 L 500 900 A 900 900 0 0 0 1400 0""##),
            "{svg}"
        );
    }

    /// The resolved model of room `Kok 2400 x 4000` with one fixture `line`.
    fn kok_with(line: &str) -> Resolved {
        let text = format!("plan \"Kok\"\nroom Kok 2400 x 4000 source laser\n{line}\n");
        let plan = parse(&text).expect("parses");
        let (resolved, diagnostics) = resolve(&plan);
        assert!(resolved.is_some(), "{diagnostics:?}");
        resolved.expect("resolves")
    }

    /// The `<g class="fixture">` group of `data_id`, up to its closing tag.
    fn fixture_group<'a>(svg: &'a str, data_id: &str) -> &'a str {
        let needle = format!(r##"<g class="fixture" data-id="{data_id}""##);
        let start = svg
            .find(&needle)
            .unwrap_or_else(|| panic!("no fixture {data_id}"));
        let rest = &svg[start..];
        &rest[..rest.find("</g>").expect("closing tag") + "</g>".len()]
    }

    #[test]
    fn stub_is_a_wall_group_in_the_interior_grey() {
        let plan = parse("plan \"Kok\"\ndefault_wall 100 source assumed\nroom Kok 2400 x 4000 source laser\nstub Kok.west at 2000 length 600\n").expect("parses");
        let (resolved, _) = resolve(&plan);
        let svg = plan_svg(&resolved.expect("resolves"));
        assert!(
            svg.contains(
                r##"class="wall stub" data-id="S:Kok.west:1"><rect x="0" y="2000" width="600" height="100" fill="#a6a6a6""##
            ),
            "{svg}"
        );
    }

    #[test]
    fn demolished_stub_is_white_and_dashed_red() {
        let svg = plan_svg(&kok_with("stub Kok.west at 2000 length 600 demolish"));
        let start = svg
            .find(r##"data-id="S:Kok.west:1""##)
            .expect("the stub is drawn");
        let group = &svg[start..];
        let group = &group[..group.find("</g>").expect("closing tag")];
        assert!(group.contains(r##"fill="#ffffff""##), "{group}");
        assert!(group.contains("#c62828"), "{group}");
        assert!(group.contains("stroke-dasharray"), "{group}");
    }

    #[test]
    fn fixture_stove_has_four_burner_circles() {
        let svg = plan_svg(&kok_with("fixture stove Kok.north at 200"));
        let group = fixture_group(&svg, "F:Kok.north:1");
        assert!(group.contains(r##"data-kind="stove""##), "{group}");
        assert!(
            group.contains(r##"<rect x="200" y="0" width="600" height="600""##),
            "{group}"
        );
        assert_eq!(group.matches("<circle").count(), 4, "{group}");
        assert!(
            group.contains(r##"<circle cx="350" cy="150" r="75""##),
            "{group}"
        );
    }

    #[test]
    fn fixture_wc_is_an_ellipse_in_its_rectangle() {
        let svg = plan_svg(&kok_with("fixture wc Kok.east at 100"));
        let group = fixture_group(&svg, "F:Kok.east:1");
        assert_eq!(group.matches("<ellipse").count(), 1, "{group}");
        assert!(group.contains(r##"rx="245""##), "{group}");
        assert!(group.contains(r##"ry="140""##), "{group}");
    }

    #[test]
    fn demolished_fixture_is_red_and_dashed() {
        let svg = plan_svg(&kok_with("fixture sink Kok.north at 100 demolish"));
        let group = fixture_group(&svg, "F:Kok.north:1");
        assert!(group.contains("#c62828"), "{group}");
        assert!(group.contains(r##"stroke-dasharray="120 90""##), "{group}");
        assert!(!group.contains("#333333"), "{group}");
    }

    #[test]
    fn new_fixture_is_near_black_at_full_stroke() {
        let svg = plan_svg(&kok_with(
            "fixture box Kok.north at 100 width 500 depth 300 new",
        ));
        let group = fixture_group(&svg, "F:Kok.north:1");
        assert!(
            group.contains(r##"stroke="#1a1a1a" stroke-width="30""##),
            "{group}"
        );
    }

    #[test]
    fn plug_shows_p_and_label_replaces_it() {
        let svg = plan_svg(&kok_with("fixture plug Kok.north at 100"));
        assert!(fixture_group(&svg, "F:Kok.north:1").contains(">P</text>"));
        let svg = plan_svg(&kok_with("fixture plug Kok.north at 100 label \"X\""));
        let group = fixture_group(&svg, "F:Kok.north:1");
        assert!(group.contains(">X</text>"), "{group}");
        assert!(!group.contains(">P</text>"), "{group}");
    }

    #[test]
    fn fixture_labels_view_has_its_id() {
        let resolved = kok_with("fixture stove Kok.north at 200");
        let opts = RenderOptions {
            view: View::Labels,
            region: None,
            max_tokens: 1600,
        };
        let rendered = render(&resolved, &opts).expect("renders");
        assert!(
            rendered.labels.iter().any(|l| l.id == "F:Kok.north:1"),
            "{:?}",
            rendered.labels
        );
    }

    #[test]
    fn fixtures_are_not_labelled_in_the_plan_view() {
        let resolved = kok_with("fixture stove Kok.north at 200");
        let opts = RenderOptions {
            view: View::Plan,
            region: None,
            max_tokens: 1600,
        };
        let rendered = render(&resolved, &opts).expect("renders");
        assert!(rendered.labels.iter().all(|l| l.id != "F:Kok.north:1"));
    }

    #[test]
    fn fixture_a_has_no_fixture_group() {
        assert!(!fixture_a_svg().contains(r##"class="fixture""##));
    }

    #[test]
    fn plan_view_keeps_its_colours() {
        let svg = fixture_a_svg();
        assert!(svg.contains("#1f77d0"), "{svg}");
        assert!(svg.contains("#eef4fb"), "{svg}");
    }

    /// The L-shaped room of §15 D46: `Matvra` is a part of `Kok`.
    fn l_shape() -> Resolved {
        let text = "plan \"Kok\"\nroom Kok 2400 x 4000 source laser\nroom Matvra 2400 x 1500 source laser part Kok\n  south_of Kok open\n  align west Kok\n";
        let loaded = plan_core::load(text).expect("L shape loads");
        loaded.resolved.expect("L shape resolves")
    }

    #[test]
    fn part_prints_no_name_and_parent_prints_summed_area() {
        let svg = plan_svg(&l_shape());
        assert_eq!(svg.matches("13.20 m²").count(), 1, "{svg}");
        assert!(!svg.contains("3.60 m²"), "{svg}");
        assert!(!svg.contains("9.60 m²"), "{svg}");
        assert!(!svg.contains(">Matvra<"), "{svg}");
        assert!(svg.contains(">Kok<"), "{svg}");
    }
}
