//! The `next_steps` of the MCP `check` result (spec §11 Phase 4, D14).
//!
//! Steps come in this order: each error, each W001 (the laser shot), each W003
//! (ask the user), each other warning, then up to three I020 suggestions when
//! there is no error. At most [`MAX_STEPS`] steps. Info diagnostics are not
//! listed.

use plan_core::solve::components::suggested_w001;
use plan_core::solve::{edges, unmeasured};
use plan_core::{Code, Diagnostic, Plan, Severity};

/// The most steps one `check` returns.
const MAX_STEPS: usize = 10;

/// How many I020 suggestions are offered when the plan has no error.
const OPTIONAL_STEPS: usize = 3;

/// The step given when there is nothing else to do.
const NOTHING_TO_DO: &str = "Nothing to do: the plan resolves with no errors or warnings.";

/// The next steps for a checked plan. `plan` is `None` when the text did not
/// parse or a name was unknown, so there is no plan to suggest measurements for.
pub fn next_steps(plan: Option<&Plan>, diagnostics: &[Diagnostic]) -> Vec<String> {
    let mut steps = Vec::new();
    let has_error = diagnostics.iter().any(|d| d.severity == Severity::Error);

    // 1. Errors.
    for d in diagnostics.iter().filter(|d| d.severity == Severity::Error) {
        let line = first_line(&d.message);
        let text = if d.code == Code::E003 {
            format!("{line} Ask the user which value to trust, then fix it with apply.")
        } else {
            format!("Fix: {line}")
        };
        push(&mut steps, text);
    }

    // 2. W001, with the measurement from `data` or, when `resolve` left it
    // out, from the suggestion for the same axis and room (the `plan suggest` path).
    let needs_suggestion = diagnostics
        .iter()
        .any(|d| d.code == Code::W001 && route(d, &[]).is_none());
    let suggested = match plan {
        Some(plan) if needs_suggestion => suggested_w001(&edges(plan).0, plan),
        _ => Vec::new(),
    };
    for d in diagnostics.iter().filter(|d| d.code == Code::W001) {
        let text = match route(d, &suggested) {
            Some((from, to)) => format!(
                "Ask the user to measure {from} to {to} with the laser, then apply \"measure {from} to {to} = <mm> source laser\"."
            ),
            None => format!("Check: {}", d.message),
        };
        push(&mut steps, text);
    }

    // 3. W003.
    for d in diagnostics
        .iter()
        .filter(|d| d.code == Code::W003 && d.severity == Severity::Warning)
    {
        push(&mut steps, format!("Ask the user: {}", d.message));
    }

    // 4. Other warnings.
    for d in diagnostics
        .iter()
        .filter(|d| d.severity == Severity::Warning && !matches!(d.code, Code::W001 | Code::W003))
    {
        push(&mut steps, format!("Check: {}", d.message));
    }

    // 5. Optional measurements, only when nothing is an error.
    if let (Some(plan), false) = (plan, has_error) {
        for d in unmeasured(plan).iter().take(OPTIONAL_STEPS) {
            push(&mut steps, format!("Optional: {}", d.message));
        }
    }

    // 6. Nothing to say.
    if steps.is_empty() {
        steps.push(NOTHING_TO_DO.to_string());
    }
    steps
}

/// Add `text` unless the list already holds [`MAX_STEPS`] entries.
fn push(steps: &mut Vec<String>, text: String) {
    if steps.len() < MAX_STEPS {
        steps.push(text);
    }
}

/// The first line of a (possibly multi-line) message.
fn first_line(message: &str) -> &str {
    message.lines().next().unwrap_or("")
}

/// The `(from, to)` faces of a W001. `data` gives them directly when present;
/// otherwise the suggestion with the same axis and room supplies them.
fn route(d: &Diagnostic, suggested: &[Diagnostic]) -> Option<(String, String)> {
    if let Some(pair) = faces(&d.data) {
        return Some(pair);
    }
    let axis = text(&d.data, "axis")?;
    let room = text(&d.data, "room")?;
    suggested
        .iter()
        .find(|s| text(&s.data, "axis") == Some(axis) && text(&s.data, "room") == Some(room))
        .and_then(|s| faces(&s.data))
}

/// The `from` and `to` strings of a W001 `data` object.
fn faces(data: &serde_json::Value) -> Option<(String, String)> {
    Some((
        text(data, "from")?.to_string(),
        text(data, "to")?.to_string(),
    ))
}

/// A string field of a `data` object.
fn text<'a>(data: &'a serde_json::Value, key: &str) -> Option<&'a str> {
    data.get(key)?.as_str()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const FIXTURE_A: &str = include_str!("../../../fixtures/lgh154-a.plan");
    const FIXTURE_B: &str = include_str!("../../../fixtures/lgh154-b.plan");

    /// Test plan 1 of W2-09: a loose room with two laser rooms.
    const LOOSE_ROOM: &str = "room Hall 1000 x 2000 source laser
room Förråd 800 x 2000 source laser
  align north Hall
";

    /// Check `src` the way the server does: a parse error gives no plan.
    fn steps_for(src: &str) -> Vec<String> {
        match plan_core::load(src) {
            Ok(r) => next_steps(Some(&r.plan), &r.diagnostics),
            Err(ds) => next_steps(None, &ds),
        }
    }

    fn warning(code: Code, message: &str) -> Diagnostic {
        Diagnostic {
            code,
            severity: Severity::Warning,
            message: message.to_string(),
            span: None,
            refs: Vec::new(),
            data: json!({}),
        }
    }

    #[test]
    fn fixture_a_steps() {
        assert_eq!(
            steps_for(FIXTURE_A),
            [
                "Ask the user: Facade not straight: Sovrum.south 4540 vs Vardagsrum.south 4593 (53 mm). Add \"align south Sovrum Vardagsrum\" if it is straight.",
                "Optional: Gap Hall east_of Garderob 121 mm has source drawing (±30 mm); measure Garderob.west to Hall.east with the laser.",
                "Optional: Gap Vardagsrum south_of WC 123 mm has source drawing (±30 mm); measure WC.north to Vardagsrum.south with the laser.",
                "Optional: Hall width 1100 mm has source assumed (±10 mm); measure Hall.west to Hall.east with the laser.",
            ]
        );
    }

    #[test]
    fn fixture_b_steps() {
        assert_eq!(
            steps_for(FIXTURE_B),
            [
                "Conflict on the north–south axis: 50 mm. Ask the user which value to trust, then fix it with apply."
            ]
        );
    }

    #[test]
    fn loose_room_w001_uses_the_suggested_shot() {
        let steps = steps_for(LOOSE_ROOM);
        assert_eq!(
            steps[0],
            "Ask the user to measure Hall.east to Förråd.west with the laser, then apply \"measure Hall.east to Förråd.west = <mm> source laser\"."
        );
    }

    #[test]
    fn parse_error_is_a_fix_step() {
        let steps = steps_for("room A 3000 * 2000");
        assert_eq!(steps.len(), 1, "{steps:?}");
        assert!(steps[0].starts_with("Fix: Line 1, column 13:"), "{steps:?}");
    }

    #[test]
    fn twelve_warnings_give_ten_steps() {
        let diagnostics: Vec<Diagnostic> = (0..12)
            .map(|i| warning(Code::W004, &format!("warning {i}")))
            .collect();
        let steps = next_steps(None, &diagnostics);
        assert_eq!(steps.len(), 10);
        assert_eq!(steps[0], "Check: warning 0");
        assert_eq!(steps[9], "Check: warning 9");
    }

    #[test]
    fn empty_plan_says_nothing_to_do() {
        let r = plan_core::load("").expect("empty plan loads");
        assert_eq!(next_steps(Some(&r.plan), &r.diagnostics), [NOTHING_TO_DO]);
    }

    #[test]
    fn info_is_not_listed() {
        let info = Diagnostic {
            severity: Severity::Info,
            ..warning(
                Code::I010,
                "Wall W2 is 120 mm, derived from the room positions.",
            )
        };
        assert_eq!(next_steps(None, &[info]), [NOTHING_TO_DO]);
    }

    #[test]
    fn w001_without_a_route_falls_back_to_check() {
        let w001 = warning(Code::W001, "Not tied east–west: Kitchen.");
        assert_eq!(
            next_steps(None, &[w001]),
            ["Check: Not tied east–west: Kitchen."]
        );
    }
}
