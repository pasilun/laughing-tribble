//! Marks: measurement lines drawn over a render (spec §15 D38).
//!
//! A [`Mark`] is a line between two points in mm, with a label. [`render_marked`]
//! (in [`render`](crate::render)) draws them in `<g id="marks">` and labels them
//! through the same placer as the room names.

use plan_core::{Code, Diagnostic, Resolved};

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

/// Where a face is: its coordinate, and the room's span on the other axis.
///
/// `"Garderob.north"` gives `Some((true, y_of_north_face, (west, east)))`: the
/// `true` says the face is horizontal (north or south), so its coordinate is a y.
/// East and west faces give `false` and an x, with the span `(north, south)`.
/// `None` when the text has no `.`, the room is unknown, or the side is not a side.
pub(crate) fn face_of(resolved: &Resolved, face: &str) -> Option<(bool, i64, (i64, i64))> {
    let (room, side) = face.rsplit_once('.')?;
    let (_, rect) = resolved
        .rooms
        .iter()
        .find(|(name, _)| name.as_str() == room)?;
    match side {
        "north" => Some((true, rect.north, (rect.west, rect.east))),
        "south" => Some((true, rect.south, (rect.west, rect.east))),
        "east" => Some((false, rect.east, (rect.north, rect.south))),
        "west" => Some((false, rect.west, (rect.north, rect.south))),
        _ => None,
    }
}

/// A mark between two parallel faces given as `"Room.side"`. `None` if a face
/// is unknown or the two faces are not parallel.
///
/// The line sits at the middle of the two rooms' overlap on the other axis, or
/// of the gap between them when they do not overlap (integer division). If the
/// two faces have the same coordinate, the `to` point moves 1 mm along the
/// mark's axis so that the line has a direction (spec §15 D38, amended).
pub fn mark_between(
    resolved: &Resolved,
    id: &str,
    from: &str,
    to: &str,
    text: String,
    kind: MarkKind,
) -> Option<Mark> {
    let (horizontal, c1, (lo1, hi1)) = face_of(resolved, from)?;
    let (other, c2, (lo2, hi2)) = face_of(resolved, to)?;
    if horizontal != other {
        return None;
    }
    let mid = (lo1.max(lo2) + hi1.min(hi2)) / 2;
    let (start, mut end) = if horizontal {
        ([mid, c1], [mid, c2])
    } else {
        ([c1, mid], [c2, mid])
    };
    if c1 == c2 {
        if horizontal {
            end[1] += 1;
        } else {
            end[0] += 1;
        }
    }
    Some(Mark {
        id: id.to_string(),
        from: start,
        to: end,
        text,
        kind,
    })
}

/// One Conflict mark per E003 in `resolved.diagnostics` that has `data.from`,
/// `data.to`, `data.stated` and `data.implied`. Ids are `conflict:{n}`, n from 1
/// in diagnostics order. The text is `stated {stated}, chain gives {implied}
/// ({r} mm)` with r = |stated − implied|, from the E003 data (spec §15 D38, amended).
pub fn conflict_marks(resolved: &Resolved) -> Vec<Mark> {
    let mut marks = Vec::new();
    for diagnostic in resolved.diagnostics.iter().filter(|d| d.code == Code::E003) {
        let data = &diagnostic.data;
        let (Some(from), Some(to), Some(stated), Some(implied)) = (
            data["from"].as_str(),
            data["to"].as_str(),
            data["stated"].as_i64(),
            data["implied"].as_i64(),
        ) else {
            continue;
        };
        let residual = (stated - implied).abs();
        let id = format!("conflict:{}", marks.len() + 1);
        let text = format!("stated {stated}, chain gives {implied} ({residual} mm)");
        if let Some(mark) = mark_between(resolved, &id, from, to, text, MarkKind::Conflict) {
            marks.push(mark);
        }
    }
    marks
}

/// Marks for measurements to take: one Missing mark per W001 in `w001` (they need
/// `data.from` and `data.to`), then one Suggest mark per I020 in `i020`, at most
/// `max_suggest` of them. Ids are `missing:{n}` and `suggest:{n}`, n from 1. A
/// diagnostic without both keys, or whose mark is `None`, is skipped (spec §15 D39).
pub fn missing_marks(
    resolved: &Resolved,
    w001: &[Diagnostic],
    i020: &[Diagnostic],
    max_suggest: usize,
) -> Vec<Mark> {
    let mut marks = Vec::new();
    for diagnostic in w001 {
        let (Some(from), Some(to)) = (
            diagnostic.data["from"].as_str(),
            diagnostic.data["to"].as_str(),
        ) else {
            continue;
        };
        let id = format!("missing:{}", marks.len() + 1);
        let text = format!("measure {from} → {to}");
        if let Some(mark) = mark_between(resolved, &id, from, to, text, MarkKind::Missing) {
            marks.push(mark);
        }
    }
    let mut suggested = 0;
    for diagnostic in i020 {
        if suggested == max_suggest {
            break;
        }
        let (Some(from), Some(to)) = (
            diagnostic.data["from"].as_str(),
            diagnostic.data["to"].as_str(),
        ) else {
            continue;
        };
        let id = format!("suggest:{}", suggested + 1);
        let text = format!("measure {from} → {to}");
        if let Some(mark) = mark_between(resolved, &id, from, to, text, MarkKind::Suggest) {
            marks.push(mark);
            suggested += 1;
        }
    }
    marks
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

    const FIXTURE_B: &str = include_str!("../../../fixtures/lgh154-b.plan");
    const FIXTURE_C: &str = include_str!("../../../fixtures/lgh154-c.plan");

    /// The draft model of a fixture (W4-02), which resolves even with E003.
    fn draft(src: &str) -> Resolved {
        let plan = plan_core::dsl::parse(src).expect("fixture parses");
        plan_core::resolve_draft(&plan).0.expect("draft resolves")
    }

    #[test]
    fn face_of_gives_coordinate_and_span() {
        let resolved = draft(FIXTURE_B);
        let (horizontal, y, (west, east)) = face_of(&resolved, "Garderob.north").expect("face");
        assert!(horizontal);
        assert_eq!(y, 0);
        assert_eq!((west, east), (0, 1860));
        let (horizontal, _, _) = face_of(&resolved, "Garderob.east").expect("face");
        assert!(!horizontal);
        assert!(face_of(&resolved, "Garderob.up").is_none());
        assert!(face_of(&resolved, "Nowhere.north").is_none());
    }

    #[test]
    fn mark_between_rejects_non_parallel_faces() {
        let resolved = draft(FIXTURE_B);
        let mark = mark_between(
            &resolved,
            "x",
            "Garderob.north",
            "Sovrum.east",
            String::new(),
            MarkKind::Conflict,
        );
        assert!(mark.is_none());
    }

    #[test]
    fn fixture_b_has_one_conflict_mark() {
        let marks = conflict_marks(&draft(FIXTURE_B));
        assert_eq!(marks.len(), 1);
        let mark = &marks[0];
        assert_eq!(mark.id, "conflict:1");
        assert_eq!(mark.from, [930, 0]);
        assert_eq!(mark.to, [930, 4490]);
        assert_eq!(mark.text, "stated 4490, chain gives 4540 (50 mm)");
        assert_eq!(mark.kind, MarkKind::Conflict);
    }

    #[test]
    fn fixture_c_mark_sits_in_the_overlap_and_is_one_mm_long() {
        let marks = conflict_marks(&draft(FIXTURE_C));
        assert_eq!(marks.len(), 1);
        let mark = &marks[0];
        assert_eq!(mark.from, [1920, 4540]);
        assert_eq!(mark.to, [1920, 4541]);
        assert_eq!(mark.text, "stated 0, chain gives 53 (53 mm)");
    }

    #[test]
    fn fixture_a_has_no_conflict_marks() {
        assert!(conflict_marks(&draft(FIXTURE_A)).is_empty());
    }

    #[test]
    fn fixture_a_draws_its_three_suggestions() {
        let resolved = draft(FIXTURE_A);
        let plan = plan_core::dsl::parse(FIXTURE_A).expect("fixture parses");
        let i020 = plan_core::solve::unmeasured(&plan);
        let marks = missing_marks(&resolved, &[], &i020, 3);
        assert_eq!(marks.len(), 3);
        assert!(marks.iter().all(|m| m.kind == MarkKind::Suggest));
        assert_eq!(marks[0].id, "suggest:1");
        assert_eq!(marks[0].from, [0, 556]);
        assert_eq!(marks[0].to, [3081, 556]);
        assert_eq!(marks[0].text, "measure Garderob.west → Hall.east");
        assert_eq!(marks[2].from, [1981, 556]);
        assert_eq!(marks[2].to, [3081, 556]);
    }

    #[test]
    fn missing_marks_respects_max_suggest() {
        let resolved = draft(FIXTURE_A);
        let plan = plan_core::dsl::parse(FIXTURE_A).expect("fixture parses");
        let i020 = plan_core::solve::unmeasured(&plan);
        assert_eq!(missing_marks(&resolved, &[], &i020, 1).len(), 1);
        assert!(missing_marks(&resolved, &[], &i020, 0).is_empty());
    }

    #[test]
    fn preview_w001_becomes_a_missing_mark() {
        let src = "plan \"preview\"\ndefault_wall 90 source assumed\ndefault_outer_wall 300 source assumed\nroom A 2000 x 1000 source laser\nroom B 1500 x 1000 source laser\n";
        let plan = plan_core::dsl::parse(src).expect("parses");
        let preview = plan_core::preview::preview_missing(&plan);
        let (resolved, _) = plan_core::resolve_draft(&preview.plan);
        let resolved = resolved.expect("preview resolves");
        let i020 = plan_core::solve::unmeasured(&plan);
        let marks = missing_marks(&resolved, &preview.assumed, &i020, 3);
        let first = &marks[0];
        assert_eq!(first.kind, MarkKind::Missing);
        assert_eq!(first.id, "missing:1");
        assert_eq!(first.text, "measure A.east → B.west");
        assert_eq!(first.from, [2000, 500]);
        assert_eq!(first.to, [2090, 500]);
    }
}
