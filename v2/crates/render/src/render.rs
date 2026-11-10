//! `render`: the SVG of a resolved plan, sized to the viewport (W2-13).
//!
//! The image is `size_px` pixels, and its viewBox is `size_px × mm_per_px`
//! mm, so one pixel is exactly `mm_per_px` mm. Strokes and text given in
//! pixels are multiplied by `mm_per_px`. Labels (W2-15) are placed by
//! [`place`](crate::labels::place) and drawn last, in `<g id="labels">`. The
//! id labels of the other drawings are removed, so each text appears once.

use plan_core::build::format_m2;
use plan_core::dsl::resolve::SUGGEST_MIN;
use plan_core::{Code, Diagnostic, RectMm, Resolved, Severity, element_ids, element_rect, message};
use serde_json::json;
use strsim::jaro_winkler;

use crate::labels::{LabelReq, PlacedLabel, place};
use crate::marks::{Mark, mark_colour, marks_group, point_px};
use crate::svg::{FONT_FAMILY, GRID, PAD, RoomFonts, drawn_elements, multiples, text};
use crate::viewport::{Viewport, fit, within_limits};

/// What the picture shows. Only `Plan` is drawn in week two.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum View {
    Plan,
    Labels,
}

/// A part of the plan to zoom to (W2-16).
///
/// `Id` is padded by [`CROP_PAD`] around the element. `RectMm` is `[x, y, w, h]`
/// in mm, used as it is (a side under 1 mm counts as 1 mm).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Region {
    Id(String),
    RectMm([i64; 4]),
}

/// Options for [`render`].
#[derive(Clone, Debug, PartialEq)]
pub struct RenderOptions {
    pub view: View,
    pub region: Option<Region>,
    pub max_tokens: u32,
}

/// A rendered picture and the mapping from mm to its pixels.
#[derive(Clone, Debug, PartialEq)]
pub struct Rendered {
    pub svg: String,
    pub viewport: Viewport,
    pub labels: Vec<PlacedLabel>,
}

/// Padding around a cropped element, in mm (spec §15 D9).
const CROP_PAD: i64 = 600;

/// Draw a resolved plan. Lengths in mm, x east, y south.
///
/// Without a region the content is the union of every element's rectangle,
/// padded by 500 mm, and fitted to `max_tokens`. An empty plan uses a 1 m
/// square. A region replaces that content rectangle (see [`Region`]). An
/// unknown element id gives E011.
pub fn render(resolved: &Resolved, opts: &RenderOptions) -> Result<Rendered, Diagnostic> {
    render_marked(resolved, opts, &[])
}

/// [`render`], plus the `marks` drawn on top (spec §15 D38).
///
/// Without a region the content also holds each mark's two points. The marks
/// are drawn after the scale bar and labelled after the rooms. With no marks
/// the output is the same as [`render`].
pub fn render_marked(
    resolved: &Resolved,
    opts: &RenderOptions,
    marks: &[Mark],
) -> Result<Rendered, Diagnostic> {
    render_with(resolved, opts, marks, None, "")
}

/// [`render_marked`], plus two extras (spec §15 D40, the diff view). `extra_rect`
/// joins the content rectangle when there is no region. `extra_svg` is drawn
/// after the marks and before the labels. With neither, the output is the same
/// as [`render_marked`].
pub(crate) fn render_with(
    resolved: &Resolved,
    opts: &RenderOptions,
    marks: &[Mark],
    extra_rect: Option<RectMm>,
    extra_svg: &str,
) -> Result<Rendered, Diagnostic> {
    let content = content_rect(resolved, opts.region.as_ref(), marks, extra_rect)?;
    let viewport = fit(
        [content.x0, content.y0, content.width(), content.height()],
        opts.max_tokens,
    );
    if !within_limits(&viewport, opts.max_tokens) {
        return Err(crate::png::e012(
            "the region is too large to draw at this limit",
        ));
    }
    let labels = place(
        &label_requests(resolved, opts.view, &viewport, marks),
        viewport.size_px,
    );
    let svg = svg_text(resolved, &viewport, &labels, marks, extra_svg);
    Ok(Rendered {
        svg,
        viewport,
        labels,
    })
}

/// The label requests of `view`, anchored at the centre of each element in px.
///
/// Rooms are always labelled (`name area`, priority 0), then each mark at the
/// midpoint of its line (priority 0), moved 20 px to the side when the line is
/// shorter than 40 px (spec §15 D38, second amendment). Walls and stubs (1),
/// openings and fixtures (2) carry their id, and only in [`View::Labels`]. Elements whose anchor lies outside the
/// image get no request.
fn label_requests(resolved: &Resolved, view: View, vp: &Viewport, marks: &[Mark]) -> Vec<LabelReq> {
    let mut reqs = Vec::new();
    for name in resolved.rooms.keys() {
        let id = name.as_str();
        let Some(rect) = element_rect(resolved, id) else {
            continue;
        };
        let area = format_m2(rect.width().saturating_mul(rect.height()));
        reqs.extend(request(resolved, vp, id, format!("{id} {area} m²"), 0));
    }
    for mark in marks {
        let mid = [
            (mark.from[0] + mark.to[0]) as f64 / 2.0,
            (mark.from[1] + mark.to[1]) as f64 / 2.0,
        ];
        if let Some(mut anchor_px) = point_px(mid, vp) {
            // A mark shorter than 40 px gets its label 20 px to the side, so the
            // label does not hide it (spec §15 D38, second amendment).
            let len_mm =
                ((mark.to[0] - mark.from[0]) as f64).hypot((mark.to[1] - mark.from[1]) as f64);
            if len_mm / vp.mm_per_px < 40.0 {
                if mark.from[0] == mark.to[0] {
                    anchor_px[0] += 20.0;
                } else if mark.from[1] == mark.to[1] {
                    anchor_px[1] -= 20.0;
                }
            }
            reqs.push(LabelReq {
                id: mark.id.clone(),
                text: mark.text.clone(),
                anchor_px,
                priority: 0,
            });
        }
    }
    if view == View::Labels {
        for id in resolved.walls.keys().chain(resolved.stubs.keys()) {
            reqs.extend(request(resolved, vp, id, id.to_string(), 1));
        }
        for id in resolved.openings.keys() {
            reqs.extend(request(resolved, vp, id, id.to_string(), 2));
        }
        for id in resolved.fixtures.keys() {
            reqs.extend(request(resolved, vp, id, id.to_string(), 2));
        }
    }
    reqs
}

/// One request for element `id`, or `None` when its anchor is off the image.
fn request(
    resolved: &Resolved,
    vp: &Viewport,
    id: &str,
    text: String,
    priority: u8,
) -> Option<LabelReq> {
    let rect = element_rect(resolved, id)?;
    let anchor_px = anchor_px(&rect, vp)?;
    Some(LabelReq {
        id: id.to_string(),
        text,
        anchor_px,
        priority,
    })
}

/// The centre of `rect` in px, or `None` when it lies outside the image.
fn anchor_px(rect: &RectMm, vp: &Viewport) -> Option<[f64; 2]> {
    let mpp = vp.mm_per_px;
    let [ox, oy] = vp.origin_mm;
    let [w, h] = vp.size_px;
    let px = [
        ((rect.x0 + rect.x1) as f64 / 2.0 - ox as f64) / mpp,
        ((rect.y0 + rect.y1) as f64 / 2.0 - oy as f64) / mpp,
    ];
    let inside = (0.0..=f64::from(w)).contains(&px[0]) && (0.0..=f64::from(h)).contains(&px[1]);
    inside.then_some(px)
}

/// The rectangle to draw, in mm: the padded union of every element's
/// rectangle, or the region when one is given.
fn content_rect(
    resolved: &Resolved,
    region: Option<&Region>,
    marks: &[Mark],
    extra: Option<RectMm>,
) -> Result<RectMm, Diagnostic> {
    match region {
        None => Ok(element_ids(resolved)
            .iter()
            .filter_map(|id| element_rect(resolved, id))
            .chain(marks.iter().map(|m| RectMm {
                x0: m.from[0].min(m.to[0]),
                y0: m.from[1].min(m.to[1]),
                x1: m.from[0].max(m.to[0]),
                y1: m.from[1].max(m.to[1]),
            }))
            .chain(extra)
            .reduce(|a, b| a.union(&b))
            .unwrap_or(RectMm {
                x0: 0,
                y0: 0,
                x1: GRID,
                y1: GRID,
            })
            .pad(PAD)),
        Some(Region::Id(id)) => match element_rect(resolved, id) {
            Some(rect) => Ok(rect.pad(CROP_PAD)),
            None => Err(unknown_element(resolved, id)),
        },
        Some(Region::RectMm([x, y, w, h])) => Ok(RectMm {
            x0: *x,
            y0: *y,
            x1: x.saturating_add((*w).max(1)),
            y1: y.saturating_add((*h).max(1)),
        }),
    }
}

/// E011 for an id that names no room, wall or opening. The suggestion is the
/// id with the highest Jaro–Winkler score, given when that score is at least
/// [`SUGGEST_MIN`] (same rule as E001).
fn unknown_element(resolved: &Resolved, id: &str) -> Diagnostic {
    let mut best: Option<(f64, String)> = None;
    for candidate in element_ids(resolved) {
        let score = jaro_winkler(id, &candidate);
        if best.as_ref().is_none_or(|(top, _)| score > *top) {
            best = Some((score, candidate));
        }
    }
    let suggestion = best
        .filter(|(score, _)| *score >= SUGGEST_MIN)
        .map(|(_, candidate)| candidate);
    let mut args = vec![("id", id.to_string())];
    if let Some(found) = &suggestion {
        args.push(("suggestion", found.clone()));
    }
    Diagnostic {
        code: Code::E011,
        severity: Severity::Error,
        message: message(Code::E011, &args),
        span: None,
        refs: vec![id.to_string()],
        data: json!({ "id": id, "suggestion": suggestion }),
    }
}

/// The full SVG document for `vp`.
fn svg_text(
    resolved: &Resolved,
    vp: &Viewport,
    labels: &[PlacedLabel],
    marks: &[Mark],
    extra_svg: &str,
) -> String {
    let mpp = vp.mm_per_px;
    let [ox, oy] = vp.origin_mm;
    let [w, h] = vp.size_px;
    let (vw, vh) = (f64::from(w) * mpp, f64::from(h) * mpp);
    let (x_end, y_end) = (ox as f64 + vw, oy as f64 + vh);

    let mut out = format!(
        r#"<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="{ox} {oy} {vw} {vh}">"#
    );
    out.push('\n');
    out.push_str(&format!(
        r#"<rect x="{ox}" y="{oy}" width="{vw}" height="{vh}" fill="white"/>"#
    ));
    out.push('\n');

    let mut lines = String::new();
    for x in multiples(ox, x_end.floor() as i64) {
        lines.push_str(&format!(
            r#"<line x1="{x}" y1="{oy}" x2="{x}" y2="{y_end}"/>"#
        ));
    }
    for y in multiples(oy, y_end.floor() as i64) {
        lines.push_str(&format!(
            r#"<line x1="{ox}" y1="{y}" x2="{x_end}" y2="{y}"/>"#
        ));
    }
    out.push_str(&format!(
        r##"<g id="grid" stroke="#d0d0d0" stroke-width="{mpp}">{lines}</g>"##
    ));
    out.push('\n');

    let fonts = RoomFonts {
        name: 12.0 * mpp,
        area: 12.0 * mpp,
    };
    // Opening lines are 3 px wide, so they keep their size at any scale.
    let opening_stroke = 3.0 * mpp;
    for element in drawn_elements(resolved, fonts, opening_stroke, false) {
        out.push_str(&without_text(&element));
        out.push('\n');
    }

    out.push_str(&scale_bar(vp, vh));
    out.push('\n');
    if !marks.is_empty() {
        out.push_str(&marks_group(marks, vp));
        out.push('\n');
    }
    if !extra_svg.is_empty() {
        out.push_str(extra_svg);
        out.push('\n');
    }
    out.push_str(&labels_group_marked(labels, vp, marks));
    out.push('\n');
    out.push_str("</svg>\n");
    out
}

/// `element` with every `<text>` removed: the labels are drawn by [`labels_group`].
pub(crate) fn without_text(element: &str) -> String {
    const END: &str = "</text>";
    let mut out = String::with_capacity(element.len());
    let mut rest = element;
    while let Some(start) = rest.find("<text ") {
        out.push_str(&rest[..start]);
        match rest[start..].find(END) {
            Some(end) => rest = &rest[start + end + END.len()..],
            None => return out,
        }
    }
    out.push_str(rest);
    out
}

/// The `<g id="labels">` group: for each label, its leader line (if any) and
/// its text, centred in the box. Converted from px back to mm. Without marks
/// (only the tests call this form).
#[cfg(test)]
fn labels_group(labels: &[PlacedLabel], vp: &Viewport) -> String {
    labels_group_marked(labels, vp, &[])
}

/// [`labels_group`], where a label whose id is a mark id is drawn in that
/// mark's colour.
fn labels_group_marked(labels: &[PlacedLabel], vp: &Viewport, marks: &[Mark]) -> String {
    let mpp = vp.mm_per_px;
    let [ox, oy] = vp.origin_mm;
    let to_mm = |p: [f64; 2]| [ox as f64 + p[0] * mpp, oy as f64 + p[1] * mpp];
    let mut body = String::new();
    for label in labels {
        let centre = to_mm(label.center_px);
        if label.leader {
            let anchor = to_mm(label.anchor_px);
            body.push_str(&format!(
                r##"<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="#555" stroke-width="{mpp}"/>"##,
                x1 = anchor[0],
                y1 = anchor[1],
                x2 = centre[0],
                y2 = centre[1],
            ));
        }
        let fill = mark_colour(marks, &label.id).unwrap_or("#000");
        let extra = format!(
            r##" fill="{fill}" stroke="#fff" stroke-width="{}" paint-order="stroke""##,
            3.0 * mpp
        );
        body.push_str(&text(centre[0], centre[1], 12.0 * mpp, &extra, &label.text));
    }
    format!(r##"<g id="labels">{body}</g>"##)
}

/// A 1 m black bar 20 px from the left and 30 px above the bottom, labelled `1 m`.
fn scale_bar(vp: &Viewport, vh: f64) -> String {
    let mpp = vp.mm_per_px;
    let x0 = vp.origin_mm[0] as f64 + 20.0 * mpp;
    let y = vp.origin_mm[1] as f64 + vh - 30.0 * mpp;
    let x1 = x0 + 1000.0;
    let label_x = x0 + 500.0;
    let label_y = y - 6.0 * mpp;
    let font_size = 12.0 * mpp;
    let stroke = 3.0 * mpp;
    format!(
        r##"<g id="scale"><line x1="{x0}" y1="{y}" x2="{x1}" y2="{y}" stroke="#000000" stroke-width="{stroke}"/><text x="{label_x}" y="{label_y}" font-size="{font_size}" font-family="{FONT_FAMILY}" text-anchor="middle">1 m</text></g>"##
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURE_A: &str = include_str!("../../../fixtures/lgh154-a.plan");

    fn fixture_a() -> Resolved {
        let loaded = plan_core::load(FIXTURE_A).expect("fixture A loads");
        loaded.resolved.expect("fixture A resolves")
    }

    fn plan_render(max_tokens: u32) -> Rendered {
        let opts = RenderOptions {
            view: View::Plan,
            region: None,
            max_tokens,
        };
        render(&fixture_a(), &opts).expect("fixture A renders")
    }

    /// The value of the first `name="…"` attribute in `text`.
    fn attr<'a>(text: &'a str, name: &str) -> &'a str {
        let key = format!("{name}=\"");
        let start = text.find(&key).expect("attribute present") + key.len();
        let rest = &text[start..];
        &rest[..rest.find('"').expect("closing quote")]
    }

    #[test]
    fn svg_size_matches_viewport() {
        let rendered = plan_render(1600);
        let vp = rendered.viewport;
        let root = rendered.svg.lines().next().expect("root element");
        assert_eq!(attr(root, "width"), vp.size_px[0].to_string());
        assert_eq!(attr(root, "height"), vp.size_px[1].to_string());
        let view_box: Vec<f64> = attr(root, "viewBox")
            .split(' ')
            .map(|v| v.parse().expect("number"))
            .collect();
        assert_eq!(view_box[0], vp.origin_mm[0] as f64);
        assert_eq!(view_box[1], vp.origin_mm[1] as f64);
        assert_eq!(
            view_box[2],
            f64::from(vp.size_px[0]) * vp.mm_per_px,
            "viewBox width"
        );
        assert!(vp.tokens <= 1600, "{}", vp.tokens);
        assert!(vp.size_px.iter().max().copied().unwrap_or(0) <= 2576);
    }

    #[test]
    fn viewport_is_fit_of_content() {
        let resolved = fixture_a();
        let content = element_ids(&resolved)
            .iter()
            .filter_map(|id| element_rect(&resolved, id))
            .reduce(|a, b| a.union(&b))
            .expect("fixture A has elements")
            .pad(500);
        let expected = fit(
            [content.x0, content.y0, content.width(), content.height()],
            1600,
        );
        assert_eq!(plan_render(1600).viewport, expected);
    }

    #[test]
    fn opening_line_is_three_px_wide() {
        // Same opening, drawn at 1 mm/px and at 6 mm/px: 3 mm and 18 mm.
        let fine = crop(Region::RectMm([0, 0, 1000, 500]));
        assert_eq!(fine.viewport.mm_per_px, 1.0);
        assert_eq!(opening_stroke_width(&fine.svg), "3");

        let coarse = plan_render(1600);
        assert_eq!(coarse.viewport.mm_per_px, 6.0);
        assert_eq!(opening_stroke_width(&coarse.svg), "18");
    }

    /// The `stroke-width` of the first opening's coloured line.
    fn opening_stroke_width(svg: &str) -> &str {
        let rest = svg
            .split(r#"<g class="opening""#)
            .nth(1)
            .expect("an opening group");
        let line = rest.split("<line ").nth(1).expect("opening line");
        attr(line, "stroke-width")
    }

    #[test]
    fn has_grid_and_scale() {
        let svg = plan_render(1600).svg;
        assert!(svg.contains(r#"id="grid""#));
        assert!(svg.contains(r#"id="scale""#));
        assert!(svg.contains(">1 m<"));
    }

    #[test]
    fn more_tokens_finer_scale() {
        let coarse = plan_render(1600).viewport.mm_per_px;
        let fine = plan_render(4784).viewport.mm_per_px;
        assert!(fine < coarse, "{fine} vs {coarse}");
    }

    fn labels_render(view: View) -> Rendered {
        let opts = RenderOptions {
            view,
            region: None,
            max_tokens: 1600,
        };
        render(&fixture_a(), &opts).expect("fixture A renders")
    }

    /// `[x0, y0, x1, y1]` of a placed label's box, in px.
    fn box_of(label: &PlacedLabel) -> [f64; 4] {
        let [cx, cy] = label.center_px;
        let [w, h] = label.size_px;
        [cx - w / 2.0, cy - h / 2.0, cx + w / 2.0, cy + h / 2.0]
    }

    #[test]
    fn labels_view_has_every_id_once() {
        let resolved = fixture_a();
        let svg = labels_render(View::Labels).svg;
        for id in element_ids(&resolved) {
            let rect = element_rect(&resolved, &id).expect("element rect");
            let is_room = resolved.rooms.keys().any(|k| k.as_str() == id);
            let text = if is_room {
                let area = format_m2(rect.width() * rect.height());
                format!("{id} {area} m²")
            } else {
                id.clone()
            };
            let needle = format!(">{text}<");
            assert_eq!(svg.matches(&needle).count(), 1, "{needle}");
        }
    }

    #[test]
    fn plan_view_has_rooms_only() {
        let svg = labels_render(View::Plan).svg;
        assert!(svg.contains(">Garderob 4.39 m²<"));
        assert!(!svg.contains(">W:"));
    }

    #[test]
    fn no_overlaps_in_fixture_a() {
        let rendered = labels_render(View::Labels);
        let free: Vec<&PlacedLabel> = rendered.labels.iter().filter(|l| !l.overlaps).collect();
        for (i, a) in free.iter().enumerate() {
            for b in &free[i + 1..] {
                let (ba, bb) = (box_of(a), box_of(b));
                let hit = ba[0] < bb[2] && bb[0] < ba[2] && ba[1] < bb[3] && bb[1] < ba[3];
                assert!(!hit, "{} and {} overlap", a.id, b.id);
            }
        }
        let crowded: Vec<&str> = rendered
            .labels
            .iter()
            .filter(|l| l.overlaps)
            .map(|l| l.id.as_str())
            .collect();
        eprintln!("{} labels overlap: {crowded:?}", crowded.len());
    }

    fn crop(region: Region) -> Rendered {
        let opts = RenderOptions {
            view: View::Labels,
            region: Some(region),
            max_tokens: 1600,
        };
        render(&fixture_a(), &opts).expect("fixture A crops")
    }

    #[test]
    fn crop_hall() {
        let rendered = crop(Region::Id("Hall".to_string()));
        let vp = rendered.viewport;
        assert_eq!(vp.origin_mm, [1381, -600]);
        assert_eq!(vp.mm_per_px, 2.5);
        assert_eq!(vp.size_px, [920, 926]);
        assert!(rendered.labels.iter().any(|l| l.id == "Hall"));
        // WC's centre (x 4356) is outside the crop (x 1381..3681).
        assert!(!rendered.labels.iter().any(|l| l.id == "WC"));
    }

    #[test]
    fn crop_rect() {
        let vp = crop(Region::RectMm([0, 0, 1000, 500])).viewport;
        assert_eq!(vp.origin_mm, [0, 0]);
        assert_eq!(vp.mm_per_px, 1.0);
        assert_eq!(vp.size_px, [1000, 500]);
    }

    #[test]
    fn crop_rect_small_sides_count_as_one_mm() {
        let vp = crop(Region::RectMm([10, 20, 0, -5])).viewport;
        assert_eq!(vp.origin_mm, [10, 20]);
        assert_eq!(vp.size_px, [1, 1]);
    }

    fn crop_error(region: Region) -> Diagnostic {
        let opts = RenderOptions {
            view: View::Labels,
            region: Some(region),
            max_tokens: 1600,
        };
        render(&fixture_a(), &opts).expect_err("unknown id")
    }

    #[test]
    fn unknown_id_suggests() {
        let d = crop_error(Region::Id("Hal".to_string()));
        assert_eq!(d.code, Code::E011);
        assert_eq!(d.severity, Severity::Error);
        assert_eq!(
            d.message,
            r#"Unknown element "Hal". Did you mean "Hall"? Use a room name, or a wall or opening id from get."#
        );
        assert_eq!(d.span, None);
        assert_eq!(d.refs, vec!["Hal".to_string()]);
        assert_eq!(d.data["suggestion"], "Hall");
    }

    #[test]
    fn unknown_id_no_suggestion() {
        let d = crop_error(Region::Id("Zzz".to_string()));
        assert_eq!(
            d.message,
            r#"Unknown element "Zzz". Use a room name, or a wall or opening id from get."#
        );
        assert!(d.data["suggestion"].is_null());
    }

    #[test]
    fn escape() {
        let label = PlacedLabel {
            id: "A".to_string(),
            text: "A&B".to_string(),
            anchor_px: [10.0, 10.0],
            center_px: [10.0, 10.0],
            size_px: [20.0, 16.0],
            leader: false,
            overlaps: false,
        };
        let vp = fit([0, 0, 1000, 1000], 1600);
        let svg = labels_group(&[label], &vp);
        assert!(svg.contains(">A&amp;B<"), "{svg}");
        assert!(!svg.contains("A&B"), "{svg}");
    }

    const FIXTURE_B: &str = include_str!("../../../fixtures/lgh154-b.plan");
    const FIXTURE_C: &str = include_str!("../../../fixtures/lgh154-c.plan");

    /// For the `conflict:1` mark of `src` drawn at 1600 tokens: the label's
    /// anchor in px, the mark's midpoint in px, and the mark's length in px.
    fn conflict_label_anchor(src: &str) -> ([f64; 2], [f64; 2], f64) {
        let plan = plan_core::dsl::parse(src).expect("fixture parses");
        let resolved = plan_core::resolve_draft(&plan).0.expect("draft resolves");
        let marks = crate::marks::conflict_marks(&resolved);
        let opts = RenderOptions {
            view: View::Plan,
            region: None,
            max_tokens: 1600,
        };
        let rendered = render_marked(&resolved, &opts, &marks).expect("fixture renders");
        assert_eq!(rendered.viewport.mm_per_px, 6.0);
        let mark = marks
            .iter()
            .find(|m| m.id == "conflict:1")
            .expect("conflict:1 mark");
        let mid = [
            (mark.from[0] + mark.to[0]) as f64 / 2.0,
            (mark.from[1] + mark.to[1]) as f64 / 2.0,
        ];
        let mid_px = point_px(mid, &rendered.viewport).expect("midpoint in image");
        let len_mm = ((mark.to[0] - mark.from[0]) as f64).hypot((mark.to[1] - mark.from[1]) as f64);
        let label = rendered
            .labels
            .iter()
            .find(|l| l.id == "conflict:1")
            .expect("label for conflict:1");
        (
            label.anchor_px,
            mid_px,
            len_mm / rendered.viewport.mm_per_px,
        )
    }

    #[test]
    fn short_mark_label_moves_beside_it() {
        // Fixture C's mark is 1 mm (under 40 px): its label is 20 px east of the midpoint.
        let (anchor, mid_px, len_px) = conflict_label_anchor(FIXTURE_C);
        assert!(len_px < 40.0, "{len_px}");
        assert!(
            (anchor[0] - (mid_px[0] + 20.0)).abs() < 1e-9,
            "{anchor:?} {mid_px:?}"
        );
        assert!(
            (anchor[1] - mid_px[1]).abs() < 1e-9,
            "{anchor:?} {mid_px:?}"
        );

        // Fixture B's mark is about 748 px long: its label stays on the midpoint.
        let (anchor, mid_px, len_px) = conflict_label_anchor(FIXTURE_B);
        assert!(len_px >= 40.0, "{len_px}");
        assert!(
            (anchor[0] - mid_px[0]).abs() < 1e-9,
            "{anchor:?} {mid_px:?}"
        );
        assert!(
            (anchor[1] - mid_px[1]).abs() < 1e-9,
            "{anchor:?} {mid_px:?}"
        );
    }
}
