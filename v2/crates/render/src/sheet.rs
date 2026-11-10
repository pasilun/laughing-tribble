//! Sheets: the plan at a standard scale on A4 or A3 with a title strip
//! (spec §15 D31, card W3-14).
//!
//! Everything in the SVG is in paper mm. The plan is drawn in a group that
//! maps model mm to paper mm: `k` mm of paper per model mm, `1 / scale`.

use std::collections::BTreeMap;

use plan_core::{Code, Diagnostic, Resolved, Severity, message};
use serde_json::json;

use crate::corners::corner_rect;
use crate::render::without_text;
use crate::svg::{FONT_FAMILY, RoomFonts, drawn_elements, escape, text};

/// The standard scales, 1:n, smallest first.
const SCALES: [u32; 7] = [20, 25, 50, 100, 200, 500, 1000];

/// The language of the words printed on a sheet (spec §15 D41).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Lang {
    /// English.
    En,
    /// Swedish.
    Sv,
}

/// The words printed on a sheet, in one language.
struct Words {
    scale: &'static str,
    property: &'static str,
    address: &'static str,
    applicant: &'static str,
    drawing: &'static str,
    drawn_by: &'static str,
    date: &'static str,
}

fn words(lang: Lang) -> Words {
    match lang {
        Lang::En => Words {
            scale: "Scale",
            property: "Property",
            address: "Address",
            applicant: "Applicant",
            drawing: "Drawing",
            drawn_by: "Drawn by",
            date: "Date",
        },
        Lang::Sv => Words {
            scale: "Skala",
            property: "Fastighet",
            address: "Adress",
            applicant: "Sökande",
            drawing: "Ritning",
            drawn_by: "Ritad av",
            date: "Datum",
        },
    }
}

/// The paper sizes of a sheet. Always landscape.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Paper {
    /// 297 × 210 mm.
    A4,
    /// 420 × 297 mm.
    A3,
}

impl Paper {
    /// The landscape size (width, height) in mm.
    pub fn size_mm(self) -> (f64, f64) {
        match self {
            Paper::A4 => (297.0, 210.0),
            Paper::A3 => (420.0, 297.0),
        }
    }

    /// The name of the paper, `"A4"` or `"A3"`.
    pub fn name(self) -> &'static str {
        match self {
            Paper::A4 => "A4",
            Paper::A3 => "A3",
        }
    }
}

/// What to draw on a sheet. `scale` is `None` for the first scale that fits.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SheetOptions {
    /// The paper size.
    pub paper: Paper,
    /// The scale denominator n of 1:n, or `None` to choose one.
    pub scale: Option<u32>,
    /// The title, printed at the left of the title strip.
    pub title: String,
    /// The date, printed at the right of the title strip, if any.
    pub date: Option<String>,
    /// The language of the printed words.
    pub lang: Lang,
    /// The plan's title statements (keys: property, address, applicant,
    /// drawing, drawn_by, date, description). When empty, the strip is the
    /// one-row strip; otherwise it is the two-row title block (§15 D41).
    pub block: BTreeMap<String, String>,
}

/// A drawn sheet: the SVG in paper mm, with the paper and the scale used.
#[derive(Clone, Debug, PartialEq)]
pub struct Sheet {
    /// The SVG document.
    pub svg: String,
    /// The paper size.
    pub paper: Paper,
    /// The scale denominator n of 1:n.
    pub scale: u32,
}

/// Draw `resolved` on a sheet (spec §15 D31).
///
/// Returns E018 (Error) when the plan does not fit the available area at the
/// scale asked for, or at the automatic scale when no listed scale fits.
pub fn sheet(resolved: &Resolved, opts: &SheetOptions) -> Result<Sheet, Diagnostic> {
    let paper = opts.paper;
    let (w, h) = paper.size_mm();
    let (minx, miny, maxx, maxy) = extent(resolved);
    let (ew, eh) = ((maxx - minx) as f64, (maxy - miny) as f64);
    // 10 mm margin, 15 mm title strip, 5 mm padding.
    let (aw, ah) = (w - 30.0, h - 45.0);
    let fits = |n: u32| n > 0 && ew / f64::from(n) <= aw && eh / f64::from(n) <= ah;
    let first_fit = SCALES.iter().copied().find(|&n| fits(n));
    let n = opts.scale.unwrap_or_else(|| first_fit.unwrap_or(1000));
    if !fits(n) {
        let mut args = vec![
            ("paper", paper.name().to_string()),
            ("scale", n.to_string()),
        ];
        if let Some(fit) = first_fit {
            args.push(("fit", fit.to_string()));
        }
        return Err(Diagnostic {
            code: Code::E018,
            severity: Severity::Error,
            message: message(Code::E018, &args),
            span: None,
            refs: Vec::new(),
            data: json!({"paper": paper.name(), "scale": n, "fit": first_fit}),
        });
    }

    let nf = f64::from(n);
    let k = 1.0 / nf;
    let tx = 15.0 + (aw - ew * k) / 2.0 - minx as f64 * k;
    let ty = 15.0 + (ah - eh * k) / 2.0 - miny as f64 * k;
    let fonts = RoomFonts {
        name: 3.5 * nf,
        area: 2.5 * nf,
    };

    let mut plan = Vec::new();
    for element in drawn_elements(resolved, fonts, 0.35 * nf) {
        if element.starts_with(r#"<g class="room""#) {
            plan.push(element);
        } else {
            plan.push(without_text(&element));
        }
    }
    for rect in resolved.rooms.values() {
        let (rw, rd) = (rect.east - rect.west, rect.south - rect.north);
        let (cx, cy) = (rect.west + rw / 2, rect.north + rd / 2);
        plan.push(text(
            cx as f64,
            cy as f64 + 4.5 * nf,
            2.5 * nf,
            " fill=\"#1a1a1a\"",
            &format!("{rw} × {rd}"),
        ));
    }

    let has_block = !opts.block.is_empty();
    let baseline = if has_block { h - 19.5 } else { h - 15.5 };
    let mut out = Vec::new();
    out.push(format!(
        r##"<svg xmlns="http://www.w3.org/2000/svg" width="{w}mm" height="{h}mm" viewBox="0 0 {w} {h}">"##
    ));
    out.push(format!(
        r##"<rect x="0" y="0" width="{w}" height="{h}" fill="#ffffff"/>"##
    ));
    out.push(format!(
        r##"<rect x="10" y="10" width="{}" height="{}" fill="none" stroke="#000000" stroke-width="0.35"/>"##,
        w - 20.0,
        h - 20.0,
    ));
    out.push(format!(
        r##"<line x1="10" y1="{y}" x2="{x2}" y2="{y}" stroke="#000000" stroke-width="0.35"/>"##,
        y = h - 25.0,
        x2 = w - 10.0,
    ));
    out.push(format!(
        r##"<g id="plan" transform="translate({tx} {ty}) scale({k})">{}</g>"##,
        plan.join("\n"),
    ));
    let words = words(opts.lang);
    out.push(strip_text(
        w / 2.0,
        "middle",
        baseline,
        &format!("{} 1:{n} ({})", words.scale, paper.name()),
    ));
    if has_block {
        out.extend(title_block(opts, &words, w, h));
    } else {
        out.push(strip_text(14.0, "start", baseline, &opts.title));
        if let Some(date) = &opts.date {
            out.push(strip_text(w - 14.0, "end", baseline, date));
        }
    }
    out.push(format!(
        r##"<line x1="{x1}" y1="{y}" x2="{x2}" y2="{y}" stroke="#000000" stroke-width="0.5"/>"##,
        x1 = w / 2.0 - 500.0 / nf,
        x2 = w / 2.0 + 500.0 / nf,
        y = h - 12.0,
    ));
    out.push(text(w / 2.0, h - 14.5, 2.5, "", "1 m"));
    out.push("</svg>".to_string());

    Ok(Sheet {
        svg: format!("{}\n", out.join("\n")),
        paper,
        scale: n,
    })
}

/// The extent of the rooms and the outer rectangles of the walls, in model
/// mm: (minx, miny, maxx, maxy). `(0, 0, 1000, 1000)` when there is neither.
fn extent(resolved: &Resolved) -> (i64, i64, i64, i64) {
    let mut boxes: Vec<(i64, i64, i64, i64)> = resolved
        .rooms
        .values()
        .map(|rect| (rect.west, rect.north, rect.east, rect.south))
        .collect();
    boxes.extend(
        resolved
            .walls
            .values()
            .map(|wall| corner_rect(wall, resolved)),
    );
    if boxes.is_empty() {
        return (0, 0, 1000, 1000);
    }
    (
        boxes.iter().map(|b| b.0.min(b.2)).min().unwrap_or(0),
        boxes.iter().map(|b| b.1.min(b.3)).min().unwrap_or(0),
        boxes.iter().map(|b| b.0.max(b.2)).max().unwrap_or(0),
        boxes.iter().map(|b| b.1.max(b.3)).max().unwrap_or(0),
    )
}

/// A 3.5 mm text in the title strip, on the baseline `y`.
fn strip_text(x: f64, anchor: &str, y: f64, content: &str) -> String {
    sized_text(x, anchor, y, 3.5, content)
}

/// A text of `size` mm at `x` on the baseline `y`.
fn sized_text(x: f64, anchor: &str, y: f64, size: f64, content: &str) -> String {
    format!(
        r##"<text x="{x}" y="{y}" font-size="{size}" font-family="{FONT_FAMILY}" text-anchor="{anchor}">{}</text>"##,
        escape(content),
    )
}

/// The two rows of the title block (§15 D41), 2.8 mm text on the baselines
/// `H − 19.5` and `H − 14`. Left: the sheet title (or the description) and the
/// property and address. Right: the drawing and date, the applicant and the
/// drawn-by. Each row lists only the parts that are present.
fn title_block(opts: &SheetOptions, words: &Words, w: f64, h: f64) -> Vec<String> {
    let field = |key: &str| opts.block.get(key).map(String::as_str);
    let (row1, row2, size) = (h - 19.5, h - 14.0, 2.8);
    let mut out = Vec::new();

    let title = field("description").unwrap_or(&opts.title);
    out.push(sized_text(14.0, "start", row1, size, title));

    let property = field("property").map(|p| format!("{}: {p}", words.property));
    let address = field("address").map(|a| match &property {
        Some(_) => format!(", {a}"),
        None => format!("{}: {a}", words.address),
    });
    let left2: String = [property, address].into_iter().flatten().collect();
    if !left2.is_empty() {
        out.push(sized_text(14.0, "start", row2, size, &left2));
    }

    let date = opts.date.as_deref().or_else(|| field("date"));
    let right1 = [
        field("drawing").map(|d| format!("{}: {d}", words.drawing)),
        date.map(|d| format!("{}: {d}", words.date)),
    ];
    let right1: Vec<String> = right1.into_iter().flatten().collect();
    if !right1.is_empty() {
        out.push(sized_text(w - 14.0, "end", row1, size, &right1.join(" · ")));
    }

    let right2 = [
        field("applicant").map(|a| format!("{}: {a}", words.applicant)),
        field("drawn_by").map(|d| format!("{}: {d}", words.drawn_by)),
    ];
    let right2: Vec<String> = right2.into_iter().flatten().collect();
    if !right2.is_empty() {
        out.push(sized_text(w - 14.0, "end", row2, size, &right2.join(" · ")));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURE_A: &str = include_str!("../../../fixtures/lgh154-a.plan");

    fn fixture_a() -> Resolved {
        let loaded = plan_core::load(FIXTURE_A).expect("fixture A loads");
        loaded.resolved.expect("fixture A resolves")
    }

    fn opts(paper: Paper, scale: Option<u32>) -> SheetOptions {
        SheetOptions {
            paper,
            scale,
            title: "Lgh 154".to_string(),
            date: None,
            lang: Lang::En,
            block: BTreeMap::new(),
        }
    }

    fn block_opts(lang: Lang) -> SheetOptions {
        let block = [
            ("property", "Stockholm Gnejsen 6"),
            ("drawing", "A-01"),
            ("applicant", "Brf Gnejsen"),
        ]
        .into_iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect();
        SheetOptions {
            date: Some("2026-11-10".to_string()),
            lang,
            block,
            ..opts(Paper::A3, None)
        }
    }

    #[test]
    fn swedish_scale_text_with_empty_block() {
        let options = SheetOptions {
            lang: Lang::Sv,
            ..opts(Paper::A3, None)
        };
        let svg = sheet(&fixture_a(), &options).expect("fits").svg;
        assert!(svg.contains("Skala 1:25 (A3)"));
        assert!(!svg.contains("Scale 1:"));
    }

    #[test]
    fn title_block_in_swedish() {
        let svg = sheet(&fixture_a(), &block_opts(Lang::Sv))
            .expect("fits")
            .svg;
        assert!(svg.contains("Fastighet: Stockholm Gnejsen 6"), "{svg}");
        assert!(svg.contains("Ritning: A-01 · Datum: 2026-11-10"), "{svg}");
        assert!(svg.contains("Sökande: Brf Gnejsen"), "{svg}");
        assert!(svg.contains("Skala 1:25 (A3)"), "{svg}");
    }

    #[test]
    fn title_block_in_english() {
        let svg = sheet(&fixture_a(), &block_opts(Lang::En))
            .expect("fits")
            .svg;
        assert!(svg.contains("Property: Stockholm Gnejsen 6"), "{svg}");
        assert!(svg.contains("Drawing: A-01 · Date: 2026-11-10"), "{svg}");
        assert!(svg.contains("Applicant: Brf Gnejsen"), "{svg}");
    }

    #[test]
    fn title_block_address_joins_the_property_row_and_description_replaces_title() {
        let mut options = block_opts(Lang::En);
        options
            .block
            .insert("address".to_string(), "Gnejsvägen 6".to_string());
        options
            .block
            .insert("description".to_string(), "Ny planlösning".to_string());
        let svg = sheet(&fixture_a(), &options).expect("fits").svg;
        assert!(svg.contains("Property: Stockholm Gnejsen 6, Gnejsvägen 6"));
        assert!(svg.contains(">Ny planlösning</text>"));
        assert!(!svg.contains(">Lgh 154</text>"));
    }

    #[test]
    fn opts_date_wins_over_block_date() {
        let mut options = block_opts(Lang::En);
        options
            .block
            .insert("date".to_string(), "2020-01-01".to_string());
        let svg = sheet(&fixture_a(), &options).expect("fits").svg;
        assert!(svg.contains("Date: 2026-11-10"));
        assert!(!svg.contains("2020-01-01"));
    }

    #[test]
    fn automatic_scale_is_the_first_that_fits() {
        let a4 = sheet(&fixture_a(), &opts(Paper::A4, None)).expect("A4 fits");
        assert_eq!(a4.scale, 50);
        let a3 = sheet(&fixture_a(), &opts(Paper::A3, None)).expect("A3 fits");
        assert_eq!(a3.scale, 25);
    }

    #[test]
    fn a3_svg_has_size_scale_title_and_room_sizes() {
        let svg = sheet(&fixture_a(), &opts(Paper::A3, None))
            .expect("fits")
            .svg;
        assert!(svg.starts_with(
            r#"<svg xmlns="http://www.w3.org/2000/svg" width="420mm" height="297mm" viewBox="0 0 420 297">"#
        ));
        assert!(svg.contains("scale(0.04)"));
        assert!(svg.contains("Scale 1:25 (A3)"));
        assert!(svg.contains(">Lgh 154</text>"));
        assert!(svg.contains("1860 × 2360"));
        assert!(!svg.contains("W:Garderob.north:outer</text>"));
    }

    #[test]
    fn explicit_scale_that_does_not_fit_is_e018() {
        let err = sheet(&fixture_a(), &opts(Paper::A4, Some(20))).expect_err("does not fit");
        assert_eq!(err.code, Code::E018);
        assert_eq!(err.severity, Severity::Error);
        assert_eq!(err.message, "Plan does not fit on A4 at 1:20. Use 1:50.");
        assert_eq!(err.data["scale"], 20);
        assert_eq!(err.data["fit"], 50);
    }

    #[test]
    fn explicit_scale_that_fits_is_used() {
        let sheet = sheet(&fixture_a(), &opts(Paper::A4, Some(100))).expect("fits");
        assert_eq!(sheet.scale, 100);
    }

    #[test]
    fn explicit_scale_zero_does_not_fit() {
        let err = sheet(&fixture_a(), &opts(Paper::A4, Some(0))).expect_err("zero does not fit");
        assert_eq!(err.code, Code::E018);
    }

    #[test]
    fn title_is_escaped() {
        let mut options = opts(Paper::A4, None);
        options.title = "A & B".to_string();
        let svg = sheet(&fixture_a(), &options).expect("fits").svg;
        assert!(svg.contains(">A &amp; B</text>"));
    }

    #[test]
    fn date_is_printed_at_the_right_when_given() {
        let mut options = opts(Paper::A4, None);
        options.date = Some("2026-11-10".to_string());
        let svg = sheet(&fixture_a(), &options).expect("fits").svg;
        assert!(svg.contains(r#"text-anchor="end">2026-11-10</text>"#));
    }

    /// The value of the attribute `name="…"` in `element`, as a number.
    fn attr_value(element: &str, name: &str) -> f64 {
        let key = format!(" {name}=\"");
        let start = element
            .find(&key)
            .unwrap_or_else(|| panic!("no {name} in {element}"))
            + key.len();
        let end = start + element[start..].find('"').expect("closing quote");
        element[start..end].parse().expect("a number")
    }

    /// The whole `<text …>…</text>` element that contains `content`.
    fn text_element(svg: &str, content: &str) -> String {
        let end = svg
            .find(&format!("{content}</text>"))
            .unwrap_or_else(|| panic!("no text {content}"))
            + content.len()
            + "</text>".len();
        let start = svg[..end].rfind("<text").expect("a text start");
        svg[start..end].to_string()
    }

    #[test]
    fn clear_size_text_starts_below_the_area_line() {
        let svg = sheet(&fixture_a(), &opts(Paper::A3, None))
            .expect("fits")
            .svg;
        // The area line of Garderob, inside its room group.
        let group_start = svg
            .find(r#"<g class="room" data-id="Garderob">"#)
            .expect("Garderob is drawn");
        let group = &svg[group_start..];
        let group = &group[..group.find("</g>").expect("group end")];
        let area = text_element(group, " m²");
        let area_bottom = attr_value(&area, "y") + attr_value(&area, "font-size") / 2.0;

        // The clear size of Garderob, drawn after the room groups.
        let clear = text_element(&svg, "1860 × 2360");
        let clear_top = attr_value(&clear, "y") - attr_value(&clear, "font-size") / 2.0;

        assert!(
            clear_top > area_bottom,
            "clear size starts at {clear_top}, area line ends at {area_bottom}"
        );
    }

    #[test]
    fn scale_bar_label_sits_above_its_bar() {
        for paper in [Paper::A4, Paper::A3] {
            let svg = sheet(&fixture_a(), &opts(paper, None)).expect("fits").svg;
            // The scale bar: the 0.5 mm line of the title strip rule, below the plan.
            let stroke = svg
                .find(r#"stroke-width="0.5""#)
                .expect("scale bar is drawn");
            let start = svg[..stroke].rfind("<line").expect("a line start");
            let bar = &svg[start..stroke + svg[stroke..].find("/>").expect("line end")];
            let bar_y = attr_value(bar, "y1");

            let label = text_element(&svg, "1 m");
            let label_y = attr_value(&label, "y");
            let font_size = attr_value(&label, "font-size");

            assert!(
                label_y <= bar_y - font_size,
                "{}: label centre at {label_y}, bar at {bar_y}, font size {font_size}",
                paper.name()
            );
        }
    }
}
