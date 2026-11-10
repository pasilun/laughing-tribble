//! PNG of a render (spec §11 P2-03, §15 D9, D11).
//!
//! The SVG from [`render`](crate::render::render) is rasterised with resvg. The
//! font is DejaVu Sans, embedded in the binary, so text looks the same on every
//! machine.

use std::sync::Arc;

use plan_core::{Code, Diagnostic, Severity, message};
use serde_json::json;

use crate::render::Rendered;

/// Rasterise a render to PNG bytes, exactly `viewport.size_px` pixels.
pub fn png(r: &Rendered) -> Result<Vec<u8>, Diagnostic> {
    let mut db = resvg::usvg::fontdb::Database::new();
    db.load_font_data(include_bytes!("../assets/DejaVuSans.ttf").to_vec());
    db.set_sans_serif_family("DejaVu Sans");
    let opt = resvg::usvg::Options {
        fontdb: Arc::new(db),
        ..Default::default()
    };
    let tree = resvg::usvg::Tree::from_str(&r.svg, &opt).map_err(|e| e012(&e.to_string()))?;
    let [w, h] = r.viewport.size_px;
    let mut pixmap = resvg::tiny_skia::Pixmap::new(w, h).ok_or_else(|| e012("empty image"))?;
    let size = tree.size();
    let t =
        resvg::tiny_skia::Transform::from_scale(w as f32 / size.width(), h as f32 / size.height());
    resvg::render(&tree, t, &mut pixmap.as_mut());
    pixmap.encode_png().map_err(|e| e012(&e.to_string()))
}

/// E012 for a render that could not be rasterised.
pub(crate) fn e012(reason: &str) -> Diagnostic {
    let args = [("reason", reason.to_string())];
    Diagnostic {
        code: Code::E012,
        severity: Severity::Error,
        message: message(Code::E012, &args),
        span: None,
        refs: Vec::new(),
        data: json!({ "reason": reason }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::render::{RenderOptions, View, render};
    use crate::viewport::Viewport;

    const FIXTURE_A: &str = include_str!("../../../fixtures/lgh154-a.plan");

    fn fixture_a_labels() -> Rendered {
        let loaded = plan_core::load(FIXTURE_A).expect("fixture A loads");
        let resolved = loaded.resolved.expect("fixture A resolves");
        let opts = RenderOptions {
            view: View::Labels,
            region: None,
            max_tokens: 1600,
        };
        render(&resolved, &opts).expect("fixture A renders")
    }

    fn hand_made(svg: &str) -> Rendered {
        Rendered {
            svg: svg.to_string(),
            viewport: Viewport {
                origin_mm: [0, 0],
                mm_per_px: 10.0,
                size_px: [200, 100],
                tokens: 0,
            },
            labels: Vec::new(),
        }
    }

    fn be_u32(bytes: &[u8], at: usize) -> u32 {
        u32::from_be_bytes([bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]])
    }

    #[test]
    fn png_size_matches_viewport() {
        let r = fixture_a_labels();
        let bytes = png(&r).expect("fixture A rasterises");
        assert!(bytes.starts_with(b"\x89PNG"));
        assert_eq!(be_u32(&bytes, 16), r.viewport.size_px[0]);
        assert_eq!(be_u32(&bytes, 20), r.viewport.size_px[1]);
    }

    #[test]
    fn text_is_drawn() {
        let rect = r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2000 1000" width="2000" height="1000"><rect x="0" y="0" width="2000" height="1000" fill="white"/></svg>"#;
        let with_text = r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2000 1000" width="2000" height="1000"><rect x="0" y="0" width="2000" height="1000" fill="white"/><text x="100" y="500" font-family="DejaVu Sans, sans-serif" font-size="300">Förråd</text></svg>"#;
        let a = png(&hand_made(rect)).expect("rect renders");
        let b = png(&hand_made(with_text)).expect("text renders");
        assert_ne!(a, b);
    }

    #[test]
    fn bad_svg_is_e012() {
        let err = png(&hand_made("<svg")).expect_err("broken svg is an error");
        assert_eq!(err.code, Code::E012);
    }
}
