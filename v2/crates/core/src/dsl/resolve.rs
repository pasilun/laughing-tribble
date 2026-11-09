//! Name resolution (spec §7.4): every room a relation, align, measure, opening
//! or wall names must be a declared room. An unknown name gives E001, with the
//! closest declared name when it is similar enough. A duplicate declaration is
//! E002 and is caught by the parser, since a [`Plan`] cannot hold two rooms with
//! one name.

use serde_json::json;
use strsim::jaro_winkler;

use crate::diagnostics::{Code, Diagnostic, Severity, Span, message};
use crate::intent::{Plan, RoomName};

/// Smallest Jaro–Winkler score at which an unknown name gets a suggestion.
pub const SUGGEST_MIN: f64 = 0.85;

/// A room name as written in the DSL source, with where it was written.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NameRef {
    /// The room named.
    pub name: RoomName,
    /// Position of the name in the source. The line is used in the message.
    pub span: Span,
}

/// Check that every reference names a declared room.
///
/// Returns one E001 diagnostic per unknown reference, in the order of `refs`.
/// The suggestion is the declared room with the highest Jaro–Winkler score,
/// given only when that score is at least [`SUGGEST_MIN`]. Ties go to the name
/// that sorts first.
pub fn resolve_names(plan: &Plan, refs: &[NameRef]) -> Result<(), Vec<Diagnostic>> {
    let errors: Vec<Diagnostic> = refs
        .iter()
        .filter(|r| !plan.rooms.contains_key(&r.name))
        .map(|r| unknown_room(plan, r))
        .collect();
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors)
    }
}

/// The declared room closest to `name`, if it scores at least [`SUGGEST_MIN`].
fn closest<'a>(plan: &'a Plan, name: &str) -> Option<&'a RoomName> {
    // `rooms` iterates in name order, so a strictly higher score is needed to
    // replace an earlier candidate; ties keep the name that sorts first.
    let mut best: Option<(f64, &RoomName)> = None;
    for candidate in plan.rooms.keys() {
        let score = jaro_winkler(name, candidate.as_str());
        match best {
            Some((top, _)) if score <= top => {}
            _ => best = Some((score, candidate)),
        }
    }
    best.filter(|(score, _)| *score >= SUGGEST_MIN)
        .map(|(_, candidate)| candidate)
}

/// Build the E001 diagnostic for one unknown reference.
fn unknown_room(plan: &Plan, reference: &NameRef) -> Diagnostic {
    let name = reference.name.as_str();
    let line = reference.span.line;
    let suggestion = closest(plan, name);
    let mut args = vec![("name", name.to_string()), ("line", line.to_string())];
    if let Some(found) = suggestion {
        args.push(("suggestion", found.to_string()));
    }
    Diagnostic {
        code: Code::E001,
        severity: Severity::Error,
        message: message(Code::E001, &args),
        span: Some(reference.span),
        refs: vec![name.to_string()],
        data: json!({
            "name": name,
            "line": line,
            "suggestion": suggestion.map(RoomName::as_str),
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dsl::parse;

    #[test]
    fn unknown_room_gets_e001_with_suggestion() {
        // Line 9 holds the unknown name `Sovrun`, close to the declared `Sovrum`.
        let src = "room Sovrum 1100 x 2000\nroom Hall 1100 x 2000\n\n\n\n\n\n\nHall east_of Sovrun gap 90\n";
        let d = parse(src).expect_err("expected E001");
        assert_eq!(d.code, Code::E001);
        assert_eq!(
            format!("{} {}", d.code, d.message),
            r#"E001 Unknown room "Sovrun" (line 9). Did you mean "Sovrum"?"#
        );
        assert_eq!(d.span, Some(Span { line: 9, col: 14 }));
        assert_eq!(d.refs, vec!["Sovrun".to_string()]);
        assert_eq!(d.data["suggestion"], "Sovrum");
    }

    #[test]
    fn unknown_room_without_close_match_has_no_suggestion() {
        let d = parse("room Hall 1100 x 2000\nHall east_of Zzzzzzz gap 90\n")
            .expect_err("expected E001");
        assert_eq!(d.code, Code::E001);
        assert_eq!(d.message, r#"Unknown room "Zzzzzzz" (line 2)."#);
        assert!(d.data["suggestion"].is_null());
    }

    #[test]
    fn known_room_resolves() {
        let src = "room Sovrum 1100 x 2000\nroom Hall 1100 x 2000\nHall east_of Sovrum gap 90\n";
        assert!(parse(src).is_ok());
    }

    #[test]
    fn score_below_threshold_has_no_suggestion() {
        // "Kok" against "Kök": Jaro–Winkler 0.80, below 0.85.
        let d = parse("room Kök 1100 x 2000\nroom Hall 1100 x 2000\nHall east_of Kok gap 90\n")
            .expect_err("expected E001");
        assert_eq!(d.code, Code::E001);
        assert_eq!(d.message, r#"Unknown room "Kok" (line 3)."#);
        assert!(d.data["suggestion"].is_null());
    }
}
