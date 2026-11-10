//! PDF of a sheet (spec §11 P2-05, §15 D32, card W3-15).
//!
//! The sheet SVG is converted with svg2pdf. The font is DejaVu Sans, embedded
//! in the binary, so the text looks the same on every machine and is
//! selectable in the PDF. `PageOptions { dpi: 96.0 }` makes the page the true
//! paper size: usvg reads "420mm" as pixels at 96 dpi.

use std::sync::Arc;

use plan_core::Diagnostic;
use svg2pdf::usvg;

use crate::png::e012;
use crate::sheet::Sheet;

/// The PDF of a sheet SVG (one page, the sheet's paper size).
pub fn pdf(sheet: &Sheet) -> Result<Vec<u8>, Diagnostic> {
    let mut db = usvg::fontdb::Database::new();
    db.load_font_data(include_bytes!("../assets/DejaVuSans.ttf").to_vec());
    db.set_sans_serif_family("DejaVu Sans");
    let opt = usvg::Options {
        fontdb: Arc::new(db),
        ..Default::default()
    };
    let tree = usvg::Tree::from_str(&sheet.svg, &opt).map_err(|e| e012(&e.to_string()))?;
    svg2pdf::to_pdf(
        &tree,
        svg2pdf::ConversionOptions::default(),
        // usvg reads "420mm" as px at 96 dpi; 96 here turns that back into true mm.
        svg2pdf::PageOptions { dpi: 96.0 },
    )
    .map_err(|e| e012(&e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sheet::{Lang, Paper, SheetOptions, sheet};

    const FIXTURE_A: &str = include_str!("../../../fixtures/lgh154-a.plan");

    fn fixture_a_sheet(paper: Paper) -> Sheet {
        let loaded = plan_core::load(FIXTURE_A).expect("fixture A loads");
        let resolved = loaded.resolved.expect("fixture A resolves");
        let opts = SheetOptions {
            paper,
            scale: None,
            title: "Lgh 154".to_string(),
            date: None,
            lang: Lang::En,
            block: std::collections::BTreeMap::new(),
            dims: false,
        };
        sheet(&resolved, &opts).expect("fixture A sheet")
    }

    fn contains(bytes: &[u8], needle: &str) -> bool {
        bytes.windows(needle.len()).any(|w| w == needle.as_bytes())
    }

    #[test]
    fn a3_pdf_has_a3_media_box() {
        let bytes = pdf(&fixture_a_sheet(Paper::A3)).expect("A3 pdf");
        assert!(bytes.starts_with(b"%PDF-"));
        assert!(contains(&bytes, "/MediaBox [0 0 1190.55"));
        assert!(contains(&bytes, "841.88"));
    }

    #[test]
    fn a4_pdf_has_a4_media_box() {
        let bytes = pdf(&fixture_a_sheet(Paper::A4)).expect("A4 pdf");
        assert!(bytes.starts_with(b"%PDF-"));
        assert!(contains(&bytes, "/MediaBox [0 0 841.88"));
        assert!(contains(&bytes, "595.27"));
    }

    #[test]
    fn font_is_embedded() {
        let bytes = pdf(&fixture_a_sheet(Paper::A3)).expect("A3 pdf");
        assert!(contains(&bytes, "DejaVuSans"));
    }
}
