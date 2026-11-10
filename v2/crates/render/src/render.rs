//! `render`: the SVG of a resolved plan, sized to the viewport (W2-13).
//!
//! The image is `size_px` pixels, and its viewBox is `size_px × mm_per_px`
//! mm, so one pixel is exactly `mm_per_px` mm. Strokes and text given in
//! pixels are multiplied by `mm_per_px`. Labels (W2-14) are not drawn yet.

use plan_core::{Diagnostic, RectMm, Resolved, element_ids, element_rect};

use crate::labels::PlacedLabel;
use crate::svg::{FONT_FAMILY, GRID, PAD, RoomFonts, drawn_elements, multiples};
use crate::viewport::{Viewport, fit};

/// What the picture shows. Only `Plan` is drawn in week two.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum View {
    Plan,
    Labels,
}

/// A part of the plan to zoom to (W2-16). Not used yet: every region is `None`.
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

/// Draw a resolved plan. Lengths in mm, x east, y south.
///
/// The content is the union of every element's rectangle, padded by 500 mm
/// and fitted to `max_tokens`. An empty plan uses a 1 m square.
pub fn render(resolved: &Resolved, opts: &RenderOptions) -> Result<Rendered, Diagnostic> {
    let content = content_rect(resolved);
    let viewport = fit(
        [content.x0, content.y0, content.width(), content.height()],
        opts.max_tokens,
    );
    let svg = svg_text(resolved, &viewport);
    Ok(Rendered {
        svg,
        viewport,
        labels: Vec::new(),
    })
}

/// The padded union of every element's rectangle, in mm.
fn content_rect(resolved: &Resolved) -> RectMm {
    element_ids(resolved)
        .iter()
        .filter_map(|id| element_rect(resolved, id))
        .reduce(|a, b| a.union(&b))
        .unwrap_or(RectMm {
            x0: 0,
            y0: 0,
            x1: GRID,
            y1: GRID,
        })
        .pad(PAD)
}

/// The full SVG document for `vp`.
fn svg_text(resolved: &Resolved, vp: &Viewport) -> String {
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
    for element in drawn_elements(resolved, fonts) {
        out.push_str(&element);
        out.push('\n');
    }

    out.push_str(&scale_bar(vp, vh));
    out.push('\n');
    out.push_str("</svg>\n");
    out
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
}
