//! Permit review of a resolved plan (spec §11 P3-01, §15 D35).
//!
//! [`review`] ports the v1 permit checks that the v2 model can express:
//! load-bearing walls and fire-cell boundaries that are demolished, and new
//! openings in them, plus new openings without a height. The findings are
//! advice for the permit application. They are not part of `resolve` or
//! `plan check`.

use serde_json::json;

use crate::diagnostics::{Code, Diagnostic, Severity, message};
use crate::intent::{OpeningKind, Phase};
use crate::resolved::Resolved;

/// Permit review of a resolved plan: what the application will need. Pure.
///
/// Walls come first, in id order: for each wall W030 then W031. Then openings
/// in id order: for each new opening W032, W033 and I030. Coordinates and
/// units are those of [`Resolved`] (mm, x east, y south).
pub fn review(resolved: &Resolved) -> Vec<Diagnostic> {
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
        if let Some(fire) = &wall.fire
            && wall.phase == Phase::Demolish
        {
            out.push(Diagnostic {
                code: Code::W031,
                severity: Severity::Warning,
                message: message(Code::W031, &[("id", id.clone()), ("fire", fire.clone())]),
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
            if let Some(fire) = &wall.fire
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
                            ("fire", fire.clone()),
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

    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dsl::parse;
    use crate::resolved::resolve;

    const REVIEW_1: &str = include_str!("../../../fixtures/review-1.plan");
    const FIXTURE_A: &str = include_str!("../../../fixtures/lgh154-a.plan");

    fn resolved_of(src: &str) -> Result<Resolved, Box<dyn std::error::Error>> {
        let plan = parse(src).map_err(|d| format!("fixture does not parse: {d:?}"))?;
        let (resolved, diagnostics) = resolve(&plan);
        resolved.ok_or_else(|| format!("plan should resolve: {diagnostics:?}").into())
    }

    #[test]
    fn review_1_gives_four_findings_in_order() -> Result<(), Box<dyn std::error::Error>> {
        let resolved = resolved_of(REVIEW_1)?;
        let found = review(&resolved);
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
        ];
        assert_eq!(texts, expected);
        Ok(())
    }

    #[test]
    fn review_1_refs_and_data() -> Result<(), Box<dyn std::error::Error>> {
        let resolved = resolved_of(REVIEW_1)?;
        let found = review(&resolved);
        assert_eq!(found.len(), 4);
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
        Ok(())
    }

    #[test]
    fn fixture_a_gives_empty_review() -> Result<(), Box<dyn std::error::Error>> {
        let resolved = resolved_of(FIXTURE_A)?;
        assert!(review(&resolved).is_empty());
        Ok(())
    }
}
