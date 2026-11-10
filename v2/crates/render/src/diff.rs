//! The diff view: what a change adds, removes and moves (spec §15 D40).
//!
//! Walls and openings are compared by id between two resolved plans. The
//! picture is the `after` plan, with the differences drawn on top in
//! `<g id="diff">`, under the labels.

use std::collections::BTreeMap;
use std::fmt::Display;

use plan_core::{Diagnostic, RectMm, Resolved, element_ids, element_rect};

use crate::render::{RenderOptions, Rendered, render_with};
use crate::svg::escape;

/// How many walls and openings were added, removed and changed.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, serde::Serialize)]
pub struct DiffCounts {
    pub added: usize,
    pub removed: usize,
    pub changed: usize,
}

/// The kind of one difference. The order is the drawing order.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
enum Kind {
    Removed,
    Changed,
    Added,
}

impl Kind {
    const ALL: [Kind; 3] = [Kind::Removed, Kind::Changed, Kind::Added];

    fn name(self) -> &'static str {
        match self {
            Kind::Removed => "removed",
            Kind::Changed => "changed",
            Kind::Added => "added",
        }
    }
}

/// One wall or opening that differs. `rect` is the `before` rectangle for a
/// removed element and the `after` rectangle otherwise.
struct Difference {
    id: String,
    kind: Kind,
    rect: RectMm,
}

/// The picture of `after`, with the differences from `before` drawn on top.
///
/// Without a region the content also covers `before`, so removed parts are
/// inside the picture. Each difference is one `<rect>` with `data-id` and
/// `data-diff`. With no differences there is no `<g id="diff">`.
pub fn render_diff(
    before: &Resolved,
    after: &Resolved,
    opts: &RenderOptions,
) -> Result<(Rendered, DiffCounts), Diagnostic> {
    let differences = differences(before, after);
    let counts = counts(&differences);
    let content = element_ids(before)
        .iter()
        .filter_map(|id| element_rect(before, id))
        .reduce(|a, b| a.union(&b));
    // The stroke widths depend on the scale, which depends on the content, so
    // the first pass finds the scale and the second draws the group in it.
    let first = render_with(after, opts, &[], content, "")?;
    let group = diff_group(&differences, first.viewport.mm_per_px);
    let rendered = render_with(after, opts, &[], content, &group)?;
    Ok((rendered, counts))
}

/// Every wall and opening that was added, removed or changed, sorted by kind
/// (removed, changed, added) and then by id.
fn differences(before: &Resolved, after: &Resolved) -> Vec<Difference> {
    let mut out = Vec::new();
    compare(
        &before.walls,
        &after.walls,
        |a, b| (a.x, a.y, a.thickness) == (b.x, b.y, b.thickness),
        (before, after),
        &mut out,
    );
    compare(
        &before.openings,
        &after.openings,
        |a, b| (a.start, a.end, &a.wall) == (b.start, b.end, &b.wall),
        (before, after),
        &mut out,
    );
    out.sort_by(|a, b| a.kind.cmp(&b.kind).then_with(|| a.id.cmp(&b.id)));
    out
}

/// Compare the elements of one kind by id. `same` tells whether two elements
/// with the same id have the same extents.
fn compare<K: Ord + Display, V>(
    before: &BTreeMap<K, V>,
    after: &BTreeMap<K, V>,
    same: impl Fn(&V, &V) -> bool,
    plans: (&Resolved, &Resolved),
    out: &mut Vec<Difference>,
) {
    let (before_plan, after_plan) = plans;
    for (id, old) in before {
        match after.get(id) {
            None => push(out, &id.to_string(), Kind::Removed, before_plan),
            Some(new) if !same(old, new) => push(out, &id.to_string(), Kind::Changed, after_plan),
            Some(_) => {}
        }
    }
    for id in after.keys() {
        if !before.contains_key(id) {
            push(out, &id.to_string(), Kind::Added, after_plan);
        }
    }
}

/// Record a difference for `id`, with its rectangle taken from `plan`.
fn push(out: &mut Vec<Difference>, id: &str, kind: Kind, plan: &Resolved) {
    if let Some(rect) = element_rect(plan, id) {
        out.push(Difference {
            id: id.to_string(),
            kind,
            rect,
        });
    }
}

fn counts(differences: &[Difference]) -> DiffCounts {
    let mut counts = DiffCounts::default();
    for difference in differences {
        match difference.kind {
            Kind::Removed => counts.removed += 1,
            Kind::Changed => counts.changed += 1,
            Kind::Added => counts.added += 1,
        }
    }
    counts
}

/// The `<g id="diff">` group, or nothing when there are no differences.
fn diff_group(differences: &[Difference], mpp: f64) -> String {
    let mut body = String::new();
    for kind in Kind::ALL {
        for difference in differences.iter().filter(|d| d.kind == kind) {
            body.push_str(&diff_rect(difference, mpp));
        }
    }
    if body.is_empty() {
        String::new()
    } else {
        format!(r#"<g id="diff">{body}</g>"#)
    }
}

/// One difference as a `<rect>`, styled by its kind.
fn diff_rect(difference: &Difference, mpp: f64) -> String {
    let rect = difference.rect;
    let style = match difference.kind {
        Kind::Removed => format!(
            r##"fill="none" stroke="#c62828" stroke-width="{}" stroke-dasharray="{} {}""##,
            2.0 * mpp,
            6.0 * mpp,
            4.0 * mpp
        ),
        Kind::Changed => r##"fill="#e08a00" fill-opacity="0.6""##.to_string(),
        Kind::Added => r##"fill="#2e7d32" fill-opacity="0.6""##.to_string(),
    };
    format!(
        r#"<rect x="{x}" y="{y}" width="{w}" height="{h}" {style} data-id="{id}" data-diff="{kind}"/>"#,
        x = rect.x0,
        y = rect.y0,
        w = rect.width(),
        h = rect.height(),
        id = escape(&difference.id),
        kind = difference.kind.name(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::render::View;

    const FIXTURE_A: &str = include_str!("../../../fixtures/lgh154-a.plan");
    const WC_LINE: &str = "room WC 2370 x 990 source laser";
    const SOVRUM_WINDOW_LINE: &str = "window Sovrum.south at 380 width 1350 source laser\n";
    const WALL_ID: &str = "W:Vardagsrum.north|WC.south";

    fn resolve(src: &str) -> Resolved {
        let loaded = plan_core::load(src).expect("plan loads");
        loaded.resolved.expect("plan resolves")
    }

    fn opts() -> RenderOptions {
        RenderOptions {
            view: View::Plan,
            region: None,
            max_tokens: 1600,
        }
    }

    /// Fixture A with the WC room 210 mm deeper.
    fn wc_variant() -> String {
        let src = FIXTURE_A.replace(WC_LINE, "room WC 2370 x 1200 source laser");
        assert_ne!(src, FIXTURE_A, "the WC line is in fixture A");
        src
    }

    /// The `<rect` of `svg` that holds `data-id="id"` and `data-diff="kind"`.
    fn diff_line<'a>(svg: &'a str, id: &str, kind: &str) -> &'a str {
        let id_attr = format!(r#"data-id="{id}""#);
        let kind_attr = format!(r#"data-diff="{kind}""#);
        svg.split("<rect ")
            .find(|rect| rect.contains(&id_attr) && rect.contains(&kind_attr))
            .unwrap_or_else(|| panic!("no {kind} rect for {id}"))
    }

    /// The value of the `y` attribute of a rect line.
    fn rect_y(line: &str) -> i64 {
        let rest = line.split(r#" y=""#).nth(1).expect("y attribute");
        rest.split('"')
            .next()
            .expect("closing quote")
            .parse()
            .expect("integer")
    }

    #[test]
    fn moved_room_changes_its_walls() {
        let before = resolve(FIXTURE_A);
        let after = resolve(&wc_variant());
        let (rendered, counts) = render_diff(&before, &after, &opts()).expect("diff renders");
        assert!(counts.changed > 0, "{counts:?}");
        assert!(rendered.svg.contains(r#"data-diff="changed""#));

        let moved = element_rect(&after, WALL_ID).expect("wall in after");
        let was = element_rect(&before, WALL_ID).expect("wall in before");
        assert_eq!(moved.y0 - was.y0, 210);
        let line = diff_line(&rendered.svg, WALL_ID, "changed");
        assert_eq!(rect_y(line), moved.y0);
    }

    #[test]
    fn identical_plans_have_no_differences() {
        let plan = resolve(FIXTURE_A);
        let (rendered, counts) = render_diff(&plan, &plan, &opts()).expect("diff renders");
        assert_eq!(counts, DiffCounts::default());
        assert!(!rendered.svg.contains(r#"<g id="diff">"#));
        assert!(!rendered.svg.contains("data-diff="));
    }

    #[test]
    fn removed_window_is_one_removed_rect() {
        let before = resolve(FIXTURE_A);
        let src = FIXTURE_A.replace(SOVRUM_WINDOW_LINE, "");
        assert_ne!(src, FIXTURE_A, "the window line is in fixture A");
        let after = resolve(&src);
        let (rendered, counts) = render_diff(&before, &after, &opts()).expect("diff renders");
        assert_eq!(counts.removed, 1, "{counts:?}");
        let line = diff_line(&rendered.svg, "O:Sovrum.south:1", "removed");
        assert!(line.contains(r#"fill="none""#), "{line}");
    }

    #[test]
    fn removed_parts_are_inside_the_picture() {
        let before = resolve(FIXTURE_A);
        let after = resolve(&FIXTURE_A.replace(SOVRUM_WINDOW_LINE, ""));
        let (rendered, _) = render_diff(&before, &after, &opts()).expect("diff renders");
        let rect = element_rect(&before, "O:Sovrum.south:1").expect("opening in before");
        let vp = rendered.viewport;
        let [ox, oy] = vp.origin_mm;
        let x_end = ox + (f64::from(vp.size_px[0]) * vp.mm_per_px) as i64;
        let y_end = oy + (f64::from(vp.size_px[1]) * vp.mm_per_px) as i64;
        assert!(rect.x0 >= ox && rect.x1 <= x_end, "{rect:?} vs {vp:?}");
        assert!(rect.y0 >= oy && rect.y1 <= y_end, "{rect:?} vs {vp:?}");
    }
}
