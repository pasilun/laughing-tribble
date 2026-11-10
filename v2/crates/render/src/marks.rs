//! Marks: measurement lines drawn over a render (spec §15 D38).
//!
//! A [`Mark`] is a line between two points in mm, with a label. [`render_marked`]
//! (in [`render`](crate::render)) draws them in `<g id="marks">` and labels them
//! through the same placer as the room names.

use crate::viewport::Viewport;

/// What a mark says. Each kind has its own colour.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MarkKind {
    /// Stated and drawn lengths disagree (red).
    Conflict,
    /// A measurement is missing (amber). Drawn dashed.
    Missing,
    /// A suggested measurement (blue). Drawn dashed.
    Suggest,
}

impl MarkKind {
    /// The stroke and label colour of this kind.
    pub(crate) fn colour(self) -> &'static str {
        match self {
            MarkKind::Conflict => "#c62828",
            MarkKind::Missing => "#e08a00",
            MarkKind::Suggest => "#1565c0",
        }
    }

    /// Whether the line is drawn dashed.
    fn dashed(self) -> bool {
        !matches!(self, MarkKind::Conflict)
    }
}

/// A line between `from` and `to` (mm, x east, y south) with a label `text`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Mark {
    pub id: String,
    pub from: [i64; 2],
    pub to: [i64; 2],
    pub text: String,
    pub kind: MarkKind,
}

/// The `<g id="marks">` group for `marks`, in mm units of `vp`.
///
/// Per mark: the line, then its end ticks. A vertical mark gets horizontal
/// ticks, a horizontal one vertical ticks, and any other mark gets none.
pub(crate) fn marks_group(marks: &[Mark], vp: &Viewport) -> String {
    let mpp = vp.mm_per_px;
    let mut body = String::new();
    for mark in marks {
        let [x1, y1] = mark.from;
        let [x2, y2] = mark.to;
        let colour = mark.kind.colour();
        let width = 2.0 * mpp;
        let dash = if mark.kind.dashed() {
            format!(r##" stroke-dasharray="{} {}""##, 6.0 * mpp, 4.0 * mpp)
        } else {
            String::new()
        };
        body.push_str(&format!(
            r#"<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{colour}" stroke-width="{width}"{dash}/>"#
        ));
        let half = 5.0 * mpp;
        let ticks: Vec<(f64, f64, f64, f64)> = if x1 == x2 {
            // Vertical mark: horizontal ticks.
            [(x1, y1), (x2, y2)]
                .iter()
                .map(|&(x, y)| {
                    let (x, y) = (x as f64, y as f64);
                    (x - half, y, x + half, y)
                })
                .collect()
        } else if y1 == y2 {
            // Horizontal mark: vertical ticks.
            [(x1, y1), (x2, y2)]
                .iter()
                .map(|&(x, y)| {
                    let (x, y) = (x as f64, y as f64);
                    (x, y - half, x, y + half)
                })
                .collect()
        } else {
            Vec::new()
        };
        for (a, b, c, d) in ticks {
            body.push_str(&format!(
                r#"<line x1="{a}" y1="{b}" x2="{c}" y2="{d}" stroke="{colour}" stroke-width="{width}"/>"#
            ));
        }
    }
    format!(r#"<g id="marks">{body}</g>"#)
}

/// The label colour of a label whose id is a mark id, or `None`.
pub(crate) fn mark_colour<'a>(marks: &'a [Mark], id: &str) -> Option<&'a str> {
    marks.iter().find(|m| m.id == id).map(|m| m.kind.colour())
}

/// The px position of the mm point `p` in `vp`, or `None` when it is outside the image.
pub(crate) fn point_px(p: [f64; 2], vp: &Viewport) -> Option<[f64; 2]> {
    let mpp = vp.mm_per_px;
    let [ox, oy] = vp.origin_mm;
    let [w, h] = vp.size_px;
    let px = [(p[0] - ox as f64) / mpp, (p[1] - oy as f64) / mpp];
    let inside = (0.0..=f64::from(w)).contains(&px[0]) && (0.0..=f64::from(h)).contains(&px[1]);
    inside.then_some(px)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::render::{RenderOptions, View, render, render_marked};
    use plan_core::Resolved;

    const FIXTURE_A: &str = include_str!("../../../fixtures/lgh154-a.plan");

    fn fixture_a() -> Resolved {
        let loaded = plan_core::load(FIXTURE_A).expect("fixture A loads");
        loaded.resolved.expect("fixture A resolves")
    }

    fn plan_opts() -> RenderOptions {
        RenderOptions {
            view: View::Plan,
            region: None,
            max_tokens: 1600,
        }
    }

    fn conflict_mark() -> Mark {
        Mark {
            id: "m1".to_string(),
            from: [930, 0],
            to: [930, 4540],
            text: "stated 4490, drawn 4540 (50 mm)".to_string(),
            kind: MarkKind::Conflict,
        }
    }

    /// The text of the `<g id="marks">` group.
    fn marks_part(svg: &str) -> &str {
        let start = svg.find(r#"<g id="marks">"#).expect("marks group");
        let rest = &svg[start..];
        &rest[..rest.find("</g>").expect("group end")]
    }

    #[test]
    fn no_marks_is_render() {
        let resolved = fixture_a();
        let plain = render(&resolved, &plan_opts()).expect("renders");
        let marked = render_marked(&resolved, &plan_opts(), &[]).expect("renders");
        assert_eq!(marked.svg, plain.svg);
        assert_eq!(marked.labels, plain.labels);
    }

    #[test]
    fn conflict_mark_is_drawn_and_labelled() {
        let rendered =
            render_marked(&fixture_a(), &plan_opts(), &[conflict_mark()]).expect("renders");
        assert!(rendered.svg.contains(r#"<g id="marks">"#));
        assert!(
            rendered
                .svg
                .contains(r##"x1="930" y1="0" x2="930" y2="4540" stroke="#c62828""##)
        );
        assert_eq!(marks_part(&rendered.svg).matches("<line").count(), 3);
        assert!(rendered.labels.iter().any(|l| l.id == "m1"));
        assert!(rendered.svg.contains(r##"fill="#c62828""##));
    }

    #[test]
    fn missing_mark_is_dashed() {
        let mark = Mark {
            kind: MarkKind::Missing,
            ..conflict_mark()
        };
        let rendered = render_marked(&fixture_a(), &plan_opts(), &[mark]).expect("renders");
        let line = marks_part(&rendered.svg)
            .split("<line ")
            .nth(1)
            .expect("the mark line");
        assert!(line.contains("stroke-dasharray"), "{line}");
    }

    #[test]
    fn diagonal_mark_has_no_ticks() {
        let mark = Mark {
            from: [0, 0],
            to: [1000, 1000],
            ..conflict_mark()
        };
        let rendered = render_marked(&fixture_a(), &plan_opts(), &[mark]).expect("renders");
        assert_eq!(marks_part(&rendered.svg).matches("<line").count(), 1);
    }

    #[test]
    fn picture_grows_to_hold_a_mark() {
        let mark = Mark {
            from: [0, 0],
            to: [20000, 0],
            ..conflict_mark()
        };
        let rendered = render_marked(&fixture_a(), &plan_opts(), &[mark]).expect("renders");
        let vp = rendered.viewport;
        assert!(vp.origin_mm[0] as f64 + vp.size_px[0] as f64 * vp.mm_per_px >= 20000.0);
    }
}
