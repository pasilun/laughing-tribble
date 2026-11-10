//! Permit review of a resolved plan (spec §11 P3-01, §15 D35).
//!
//! [`review`] ports the v1 permit checks that the v2 model can express:
//! load-bearing walls and fire-cell boundaries that are demolished, and new
//! openings in them, plus new openings without a height. It also checks the
//! title block for the keys a permit drawing needs (§15 D41, I031). The
//! findings are advice for the permit application. They are not part of
//! `resolve` or `plan check`.

use serde_json::json;

use crate::diagnostics::{Code, Diagnostic, Severity, message};
use crate::intent::{FixtureKind, OpeningKind, Phase, Plan};
use crate::resolved::{Resolved, Wall};

/// The title block keys a permit drawing needs, in the order they are checked (§15 D41).
const REQUIRED_TITLE_KEYS: [&str; 4] = ["property", "drawing", "applicant", "date"];

/// Permit review of a resolved plan: what the application will need. Pure.
///
/// Walls come first, in id order: for each wall W030 then W031. Then openings
/// in id order: for each new opening W032, W033 and I030. Then W034 once if a
/// kitchen, sink or stove fixture is demolished and no plug fixture exists, and
/// I032 once if an exhaust fixture is new or demolished. Last, for each of
/// `property`, `drawing`, `applicant`, `date` that is missing from the title
/// block or only white space, I031. Coordinates and units are those of
/// [`Resolved`] (mm, x east, y south).
pub fn review(plan: &Plan, resolved: &Resolved) -> Vec<Diagnostic> {
    let mut out = Vec::new();

    for (id, wall) in &resolved.walls {
        if wall.bearing && wall.phase == Phase::Demolish {
            out.push(Diagnostic {
                code: Code::W030,
                severity: Severity::Warning,
                message: message(Code::W030, &[("id", id.clone())]),
                span: None,
                refs: vec![id.clone()],
                data: json!({ "wall": id }),
            });
        }
        if let Some(fire) = fire_text(wall)
            && wall.phase == Phase::Demolish
        {
            out.push(Diagnostic {
                code: Code::W031,
                severity: Severity::Warning,
                message: message(
                    Code::W031,
                    &[("id", id.clone()), ("fire", fire.to_string())],
                ),
                span: None,
                refs: vec![id.clone()],
                data: json!({ "wall": id, "fire": fire }),
            });
        }
    }

    for (id, opening) in &resolved.openings {
        if opening.phase != Phase::New {
            continue;
        }
        let kind = match opening.kind {
            OpeningKind::Door => "Door",
            OpeningKind::Window => "Window",
            OpeningKind::Passage => "Passage",
        };
        if let Some(wall) = resolved.walls.get(&opening.wall) {
            let wall_id = &opening.wall;
            if wall.bearing && wall.phase != Phase::Demolish {
                out.push(Diagnostic {
                    code: Code::W032,
                    severity: Severity::Warning,
                    message: message(
                        Code::W032,
                        &[
                            ("kind", kind.to_string()),
                            ("id", id.clone()),
                            ("wall", wall_id.clone()),
                        ],
                    ),
                    span: None,
                    refs: vec![id.clone(), wall_id.clone()],
                    data: json!({ "opening": id, "wall": wall_id }),
                });
            }
            if let Some(fire) = fire_text(wall)
                && wall.phase != Phase::Demolish
            {
                out.push(Diagnostic {
                    code: Code::W033,
                    severity: Severity::Warning,
                    message: message(
                        Code::W033,
                        &[
                            ("kind", kind.to_string()),
                            ("id", id.clone()),
                            ("wall", wall_id.clone()),
                            ("fire", fire.to_string()),
                        ],
                    ),
                    span: None,
                    refs: vec![id.clone(), wall_id.clone()],
                    data: json!({ "opening": id, "wall": wall_id, "fire": fire }),
                });
            }
        }
        if opening.height.is_none() {
            out.push(Diagnostic {
                code: Code::I030,
                severity: Severity::Info,
                message: message(
                    Code::I030,
                    &[("kind", kind.to_string()), ("id", id.clone())],
                ),
                span: None,
                refs: vec![id.clone()],
                data: json!({ "opening": id }),
            });
        }
    }

    let wet_demolished: Vec<String> = resolved
        .fixtures
        .values()
        .filter(|f| {
            matches!(
                f.kind,
                FixtureKind::Kitchen | FixtureKind::Sink | FixtureKind::Stove
            ) && f.phase == Phase::Demolish
        })
        .map(|f| f.id.clone())
        .collect();
    let has_plug = resolved
        .fixtures
        .values()
        .any(|f| f.kind == FixtureKind::Plug);
    if !wet_demolished.is_empty() && !has_plug {
        out.push(Diagnostic {
            code: Code::W034,
            severity: Severity::Warning,
            message: message(Code::W034, &[]),
            span: None,
            refs: wet_demolished.clone(),
            data: json!({ "fixtures": wet_demolished }),
        });
    }

    let ventilation: Vec<String> = resolved
        .fixtures
        .values()
        .filter(|f| {
            f.kind == FixtureKind::Exhaust && matches!(f.phase, Phase::New | Phase::Demolish)
        })
        .map(|f| f.id.clone())
        .collect();
    if !ventilation.is_empty() {
        out.push(Diagnostic {
            code: Code::I032,
            severity: Severity::Info,
            message: message(Code::I032, &[]),
            span: None,
            refs: ventilation.clone(),
            data: json!({ "fixtures": ventilation }),
        });
    }

    for key in REQUIRED_TITLE_KEYS {
        if plan
            .title
            .get(key)
            .is_none_or(|text| text.trim().is_empty())
        {
            out.push(Diagnostic {
                code: Code::I031,
                severity: Severity::Info,
                message: message(Code::I031, &[("key", key.to_string())]),
                span: None,
                refs: Vec::new(),
                data: json!({ "key": key }),
            });
        }
    }

    out
}

/// The fire text that W031 and W033 use for a wall: its own `fire` text, else
/// `apartment boundary` for a separating wall (§15 D47), else none.
fn fire_text(wall: &Wall) -> Option<&str> {
    match &wall.fire {
        Some(fire) => Some(fire.as_str()),
        None if wall.separating => Some("apartment boundary"),
        None => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dsl::parse;
    use crate::resolved::resolve;

    const REVIEW_1: &str = include_str!("../../../fixtures/review-1.plan");
    const FIXTURE_A: &str = include_str!("../../../fixtures/lgh154-a.plan");

    /// The title lines that complete the block (§15 D41).
    const TITLE_LINES: &str = "title property \"Stockholm Gnejsen 6\"\n\
        title drawing \"A-01\"\n\
        title applicant \"Brf Gnejsen\"\n\
        title date \"2026-11-10\"\n";

    /// `review-1` with the title lines added after the defaults.
    fn review_1_with_title() -> String {
        REVIEW_1.replace(
            "default_outer_wall 300\n",
            &format!("default_outer_wall 300\n{TITLE_LINES}"),
        )
    }

    fn plan_and_resolved_of(src: &str) -> Result<(Plan, Resolved), Box<dyn std::error::Error>> {
        let plan = parse(src).map_err(|d| format!("fixture does not parse: {d:?}"))?;
        let (resolved, diagnostics) = resolve(&plan);
        let resolved = resolved.ok_or_else(|| format!("plan should resolve: {diagnostics:?}"))?;
        Ok((plan, resolved))
    }

    /// The I031 finding for `key`, as the review gives it.
    fn i031(key: &str) -> Diagnostic {
        Diagnostic {
            code: Code::I031,
            severity: Severity::Info,
            message: format!("Title block has no {key}; add: title {key} \"\u{2026}\""),
            span: None,
            refs: Vec::new(),
            data: json!({ "key": key }),
        }
    }

    #[test]
    fn review_1_gives_four_findings_in_order() -> Result<(), Box<dyn std::error::Error>> {
        let (plan, resolved) = plan_and_resolved_of(REVIEW_1)?;
        let found = review(&plan, &resolved);
        let texts: Vec<(Code, String)> =
            found.iter().map(|d| (d.code, d.message.clone())).collect();
        let expected = vec![
            (
                Code::W030,
                "Wall W:A.east|B.west is load-bearing and is demolished; this needs a structural engineer's drawings and calculation.".to_string(),
            ),
            (
                Code::W031,
                "Wall W:A.east|B.west is a fire-cell boundary (EI60) and is demolished; a fire protection description is required.".to_string(),
            ),
            (
                Code::W032,
                "Door O:A.north:1 is new and sits in load-bearing wall W:A.north:outer; this needs a structural engineer's statement.".to_string(),
            ),
            (
                Code::I030,
                "Door O:A.north:1 is new and has no height; add \"height <mm>\" if the engineer needs it.".to_string(),
            ),
            (
                Code::I031,
                "Title block has no property; add: title property \"\u{2026}\"".to_string(),
            ),
            (
                Code::I031,
                "Title block has no drawing; add: title drawing \"\u{2026}\"".to_string(),
            ),
            (
                Code::I031,
                "Title block has no applicant; add: title applicant \"\u{2026}\"".to_string(),
            ),
            (
                Code::I031,
                "Title block has no date; add: title date \"\u{2026}\"".to_string(),
            ),
        ];
        assert_eq!(texts, expected);
        Ok(())
    }

    #[test]
    fn review_1_with_title_gives_only_the_four_findings() -> Result<(), Box<dyn std::error::Error>>
    {
        let (plan, resolved) = plan_and_resolved_of(&review_1_with_title())?;
        let codes: Vec<Code> = review(&plan, &resolved).iter().map(|d| d.code).collect();
        assert_eq!(codes, [Code::W030, Code::W031, Code::W032, Code::I030]);
        Ok(())
    }

    #[test]
    fn blank_title_key_counts_as_missing() -> Result<(), Box<dyn std::error::Error>> {
        let src = review_1_with_title().replace("title date \"2026-11-10\"", "title date \"   \"");
        let (plan, resolved) = plan_and_resolved_of(&src)?;
        let found = review(&plan, &resolved);
        assert_eq!(found.len(), 5);
        assert_eq!(found[4], i031("date"));
        Ok(())
    }

    #[test]
    fn review_1_refs_and_data() -> Result<(), Box<dyn std::error::Error>> {
        let (plan, resolved) = plan_and_resolved_of(REVIEW_1)?;
        let found = review(&plan, &resolved);
        assert_eq!(found.len(), 8);
        assert_eq!(found[0].refs, vec!["W:A.east|B.west"]);
        assert_eq!(found[0].data["wall"], "W:A.east|B.west");
        assert_eq!(found[1].data["fire"], "EI60");
        assert_eq!(found[2].refs, vec!["O:A.north:1", "W:A.north:outer"]);
        assert_eq!(found[2].data["opening"], "O:A.north:1");
        assert_eq!(found[2].data["wall"], "W:A.north:outer");
        assert_eq!(found[3].refs, vec!["O:A.north:1"]);
        assert_eq!(found[3].data, json!({ "opening": "O:A.north:1" }));
        assert!(found.iter().all(|d| d.span.is_none()));
        assert_eq!(found[3].severity, Severity::Info);
        assert_eq!(found[4], i031("property"));
        assert_eq!(found[7], i031("date"));
        Ok(())
    }

    #[test]
    fn fixture_a_gives_only_the_title_findings() -> Result<(), Box<dyn std::error::Error>> {
        let (plan, resolved) = plan_and_resolved_of(FIXTURE_A)?;
        let found = review(&plan, &resolved);
        let keys = ["property", "drawing", "applicant", "date"];
        assert_eq!(found, keys.map(i031));
        Ok(())
    }

    /// A kitchen `Kok` with the given fixture lines and the full title block.
    fn kok_with_title(fixtures: &str) -> String {
        format!("plan \"Kok\"\nroom Kok 2400 x 4000 source laser\n{fixtures}\n{TITLE_LINES}")
    }

    #[test]
    fn w034_demolished_sink_without_plug() -> Result<(), Box<dyn std::error::Error>> {
        let src = kok_with_title("fixture sink Kok.north at 900 demolish");
        let (plan, resolved) = plan_and_resolved_of(&src)?;
        let found = review(&plan, &resolved);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].code, Code::W034);
        assert_eq!(found[0].severity, Severity::Warning);
        assert_eq!(
            found[0].message,
            r#"Kitchen fixtures are demolished but no capped connection is marked; add a "plug" fixture where the pipes are capped."#
        );
        assert_eq!(found[0].refs, vec!["F:Kok.north:1"]);
        assert_eq!(found[0].data, json!({ "fixtures": ["F:Kok.north:1"] }));
        Ok(())
    }

    #[test]
    fn w034_none_with_plug() -> Result<(), Box<dyn std::error::Error>> {
        let src = kok_with_title(
            "fixture sink Kok.north at 900 demolish\nfixture plug Kok.north at 1000",
        );
        let (plan, resolved) = plan_and_resolved_of(&src)?;
        assert!(review(&plan, &resolved).is_empty());
        Ok(())
    }

    #[test]
    fn i032_new_exhaust() -> Result<(), Box<dyn std::error::Error>> {
        let src = kok_with_title("fixture exhaust Kok.north at 0 new");
        let (plan, resolved) = plan_and_resolved_of(&src)?;
        let found = review(&plan, &resolved);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].code, Code::I032);
        assert_eq!(found[0].severity, Severity::Info);
        assert_eq!(found[0].refs, vec!["F:Kok.north:1"]);
        assert_eq!(found[0].data, json!({ "fixtures": ["F:Kok.north:1"] }));
        Ok(())
    }

    #[test]
    fn existing_stove_gives_no_finding() -> Result<(), Box<dyn std::error::Error>> {
        let src = kok_with_title("fixture stove Kok.north at 200");
        let (plan, resolved) = plan_and_resolved_of(&src)?;
        assert!(review(&plan, &resolved).is_empty());
        Ok(())
    }

    /// §15 D47: two flats; the wall between them is a fire-cell boundary
    /// with the text `apartment boundary`, so a new door in it is W033.
    #[test]
    fn new_door_in_apartment_boundary_gives_w033() -> Result<(), Box<dyn std::error::Error>> {
        let src = "plan \"p\"
default_wall 90
default_outer_wall 300

room A 3000 x 2000 source laser apartment \"1\"
room B 2000 x 2000 source laser apartment \"2\"
  east_of A gap 90
  align north A
door A.east at 300 width 900 hinge north opens B new
";
        let (plan, resolved) = plan_and_resolved_of(src)?;
        let found = review(&plan, &resolved);
        let w033: Vec<&Diagnostic> = found.iter().filter(|d| d.code == Code::W033).collect();
        assert_eq!(w033.len(), 1, "{found:?}");
        assert!(
            w033[0].message.contains("(apartment boundary)"),
            "{}",
            w033[0].message
        );
        assert_eq!(w033[0].data["fire"], "apartment boundary");
        Ok(())
    }
}
