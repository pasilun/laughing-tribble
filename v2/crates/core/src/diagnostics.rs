//! Diagnostics: codes, severities and English messages (spec §8).
//!
//! Messages are built from templates. Each `{name}` placeholder is filled
//! from the `args` pairs passed to [`message`]. A placeholder with no matching
//! argument is left visible as `{name}` so the gap shows up in the output.

use serde::{Deserialize, Serialize};

/// A position in the DSL source. Used when a diagnostic points at source text.
///
/// Minimal definition for now. The lexer card (W1-05) may extend it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Span {
    /// DSL line number.
    pub line: u32,
    /// DSL column number.
    pub col: u32,
}

/// One finding about a plan, returned to the user or an MCP client.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Diagnostic {
    /// Stable code, for example `E001`.
    pub code: Code,
    /// How serious the finding is.
    pub severity: Severity,
    /// English text from [`message`], using compass terms.
    pub message: String,
    /// DSL line and column when the finding has a source position.
    pub span: Option<Span>,
    /// Semantic ids involved (rooms, faces, walls).
    pub refs: Vec<String>,
    /// Structured detail for MCP clients (any JSON value).
    pub data: serde_json::Value,
}

/// Diagnostic severity.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum Severity {
    /// The plan cannot be used as it stands.
    Error,
    /// The plan can be used, but something looks wrong.
    Warning,
    /// Information only.
    Info,
}

/// Diagnostic code. Serialized and displayed as its string form, e.g. `"E001"`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum Code {
    /// E001: unknown room.
    #[serde(rename = "E001")]
    E001,
    /// E002: duplicate room.
    #[serde(rename = "E002")]
    E002,
    /// E003: measurement conflict on an axis (spec §6.3 wording, multi-line).
    #[serde(rename = "E003")]
    E003,
    /// E004: opening outside its face.
    #[serde(rename = "E004")]
    E004,
    /// E005: rooms overlap after solving.
    #[serde(rename = "E005")]
    E005,
    /// E006: parse error.
    #[serde(rename = "E006")]
    E006,
    /// E007: opening on an open side.
    #[serde(rename = "E007")]
    E007,
    /// E010: measure between non-parallel faces.
    #[serde(rename = "E010")]
    E010,
    /// W001: under-constrained (spec §6.4 wording; depth-unknown variant when `unknown_depth` is given).
    #[serde(rename = "W001")]
    W001,
    /// W003: facade step of 1 to 100 mm.
    #[serde(rename = "W003")]
    W003,
    /// W004: values adjusted to close a cycle.
    #[serde(rename = "W004")]
    W004,
    /// I010: wall thickness derived, not stated.
    #[serde(rename = "I010")]
    I010,
}

impl Code {
    /// The code as a string, for example `"E001"`.
    pub fn as_str(self) -> &'static str {
        match self {
            Code::E001 => "E001",
            Code::E002 => "E002",
            Code::E003 => "E003",
            Code::E004 => "E004",
            Code::E005 => "E005",
            Code::E006 => "E006",
            Code::E007 => "E007",
            Code::E010 => "E010",
            Code::W001 => "W001",
            Code::W003 => "W003",
            Code::W004 => "W004",
            Code::I010 => "I010",
        }
    }
}

impl std::fmt::Display for Code {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Build the English message for `code` from named arguments.
///
/// `args` pairs each placeholder name with its text. Values are inserted as
/// given; the caller formats numbers and lists. A placeholder with no matching
/// argument stays visible as `{name}`. This function never panics.
///
/// Optional parts: E001 appends ` Did you mean "…"?` only when a
/// `suggestion` argument is present.
pub fn message(code: Code, args: &[(&str, String)]) -> String {
    match code {
        Code::E001 => {
            let base = fill(r#"Unknown room "{name}" (line {line})."#, args);
            match lookup(args, "suggestion") {
                Some(s) => format!("{base} Did you mean \"{s}\"?"),
                None => base,
            }
        }
        Code::E002 => fill(
            r#"Room "{name}" is declared twice (lines {a} and {b})."#,
            args,
        ),
        Code::E003 => {
            let base = fill(
                "Conflict on the {axis} axis: {residual} mm.\n  {chain_a} = {implied}\n  {chain_b} = {measured}\n  Allowed difference: {tolerance} mm.\n  Fix one of: mark a measurement as reference, correct a value",
                args,
            );
            // The wall suggestion is only offered when the caller gives a wall (week-one §5.2).
            match (lookup(args, "wall_from"), lookup(args, "wall_to")) {
                (Some(from), Some(to)) => {
                    format!("{base}, or change the wall ({from} → {to} would fit).")
                }
                _ => format!("{base}."),
            }
        }
        Code::E004 => fill(
            "{kind} on {face} at {at} width {width} runs past the face ({length} mm long).",
            args,
        ),
        Code::E005 => fill("{a} and {b} overlap by {dx} × {dy} mm.", args),
        Code::E006 => fill(
            "Line {line}, column {col}: expected {expected}, found {found}.",
            args,
        ),
        Code::E007 => fill(
            r#"{face} has no wall ("open"); a {kind} needs a wall."#,
            args,
        ),
        Code::E010 => fill(
            "{from} and {to} are not parallel; measure between two north/south or two east/west faces.",
            args,
        ),
        Code::W001 => {
            if lookup(args, "unknown_depth").is_some() {
                fill(
                    "{room} depth unknown; measure {room}.north to {room}.south",
                    args,
                )
            } else if lookup(args, "unknown_width").is_some() {
                fill(
                    "{room} width unknown; measure {room}.west to {room}.east",
                    args,
                )
            } else {
                fill(
                    r#"Not tied {axis}: {room}. Measure from {from} to {to}, or add "{room} {relation} {of} gap {gap}"."#,
                    args,
                )
            }
        }
        Code::W003 => fill(
            r#"Facade not straight: {a} {ya} vs {b} {yb} ({d} mm). Add "align {side} {ra} {rb}" if it is straight."#,
            args,
        ),
        Code::W004 => fill("Adjusted to fit within tolerance: {list}.", args),
        Code::I010 => fill(
            "Wall {id} is {t} mm, derived from the room positions.",
            args,
        ),
    }
}

/// Look up the value of a named argument.
fn lookup<'a>(args: &'a [(&str, String)], name: &str) -> Option<&'a str> {
    args.iter()
        .find(|(key, _)| *key == name)
        .map(|(_, value)| value.as_str())
}

/// Replace each `{name}` in `template` with its argument, in one pass.
/// Unknown names and unmatched braces are copied through unchanged.
fn fill(template: &str, args: &[(&str, String)]) -> String {
    let mut out = String::with_capacity(template.len());
    let mut rest = template;
    while let Some(start) = rest.find('{') {
        out.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        let Some(end) = after.find('}') else {
            out.push_str(&rest[start..]);
            return out;
        };
        let name = &after[..end];
        match lookup(args, name) {
            Some(value) => out.push_str(value),
            None => {
                out.push('{');
                out.push_str(name);
                out.push('}');
            }
        }
        rest = &after[end + 1..];
    }
    out.push_str(rest);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn arg(key: &'static str, value: &str) -> (&'static str, String) {
        (key, value.to_string())
    }

    #[test]
    fn e001_with_suggestion() {
        let text = message(
            Code::E001,
            &[
                arg("name", "Hall"),
                arg("line", "3"),
                arg("suggestion", "Hallway"),
            ],
        );
        assert_eq!(
            text,
            r#"Unknown room "Hall" (line 3). Did you mean "Hallway"?"#
        );
    }

    #[test]
    fn e001_without_suggestion_omits_sentence() {
        let text = message(Code::E001, &[arg("name", "Hall"), arg("line", "3")]);
        assert_eq!(text, r#"Unknown room "Hall" (line 3)."#);
    }

    #[test]
    fn e002_exact_wording() {
        let text = message(
            Code::E002,
            &[arg("name", "Kitchen"), arg("a", "2"), arg("b", "9")],
        );
        assert_eq!(text, r#"Room "Kitchen" is declared twice (lines 2 and 9)."#);
    }

    fn e003_args() -> Vec<(&'static str, String)> {
        vec![
            arg("axis", "north–south"),
            arg("residual", "120"),
            arg(
                "chain_a",
                "Garderob depth 2360 (laser) + wall 90 (assumed) + Sovrum depth 2090 (laser)",
            ),
            arg("implied", "4540"),
            arg("chain_b", "measure Garderob.north → Sovrum.south"),
            arg("measured", "4660 (laser)"),
            arg("tolerance", "10"),
            arg("wall_from", "90"),
            arg("wall_to", "40"),
        ]
    }

    #[test]
    fn e003_exact_multiline_wording() {
        let text = message(Code::E003, &e003_args());
        assert_eq!(
            text,
            "Conflict on the north–south axis: 120 mm.\n  Garderob depth 2360 (laser) + wall 90 (assumed) + Sovrum depth 2090 (laser) = 4540\n  measure Garderob.north → Sovrum.south = 4660 (laser)\n  Allowed difference: 10 mm.\n  Fix one of: mark a measurement as reference, correct a value, or change the wall (90 → 40 would fit)."
        );
    }

    #[test]
    fn e003_east_west_tape_wording() {
        let text = message(
            Code::E003,
            &[
                arg("axis", "east–west"),
                arg("residual", "20"),
                arg(
                    "chain_a",
                    "Kitchen width 3000 (laser) + wall 90 (assumed) + Hall width 2000 (tape)",
                ),
                arg("implied", "5090"),
                arg("chain_b", "measure Kitchen.west → Hall.east"),
                arg("measured", "5110 (tape)"),
                arg("tolerance", "10"),
                arg("wall_from", "90"),
                arg("wall_to", "40"),
            ],
        );
        assert_eq!(
            text,
            "Conflict on the east–west axis: 20 mm.\n  Kitchen width 3000 (laser) + wall 90 (assumed) + Hall width 2000 (tape) = 5090\n  measure Kitchen.west → Hall.east = 5110 (tape)\n  Allowed difference: 10 mm.\n  Fix one of: mark a measurement as reference, correct a value, or change the wall (90 → 40 would fit)."
        );
    }

    #[test]
    fn e003_missing_args_stay_visible() {
        let text = message(Code::E003, &[arg("residual", "120")]);
        assert!(
            text.starts_with("Conflict on the {axis} axis: 120 mm.\n  {chain_a} = {implied}\n")
        );
    }

    #[test]
    fn e004_exact_wording() {
        let text = message(
            Code::E004,
            &[
                arg("kind", "Door"),
                arg("face", "north"),
                arg("at", "2400"),
                arg("width", "900"),
                arg("length", "3000"),
            ],
        );
        assert_eq!(
            text,
            "Door on north at 2400 width 900 runs past the face (3000 mm long)."
        );
    }

    #[test]
    fn e005_exact_wording() {
        let text = message(
            Code::E005,
            &[
                arg("a", "Kitchen"),
                arg("b", "Hall"),
                arg("dx", "40"),
                arg("dy", "12"),
            ],
        );
        assert_eq!(text, "Kitchen and Hall overlap by 40 × 12 mm.");
    }

    #[test]
    fn e006_exact_wording() {
        let text = message(
            Code::E006,
            &[
                arg("line", "4"),
                arg("col", "7"),
                arg("expected", "room name"),
                arg("found", "number"),
            ],
        );
        assert_eq!(text, "Line 4, column 7: expected room name, found number.");
    }

    #[test]
    fn e007_exact_wording() {
        let text = message(Code::E007, &[arg("face", "north"), arg("kind", "window")]);
        assert_eq!(
            text,
            r#"north has no wall ("open"); a window needs a wall."#
        );
    }

    #[test]
    fn e010_exact_wording() {
        let text = message(
            Code::E010,
            &[arg("from", "Kitchen north"), arg("to", "Hall east")],
        );
        assert_eq!(
            text,
            "Kitchen north and Hall east are not parallel; measure between two north/south or two east/west faces."
        );
    }

    #[test]
    fn w001_exact_wording() {
        let text = message(
            Code::W001,
            &[
                arg("axis", "north–south"),
                arg("room", "Kitchen"),
                arg("from", "Kitchen north"),
                arg("to", "Kitchen south"),
                arg("relation", "east of"),
                arg("of", "Hall"),
                arg("gap", "90"),
            ],
        );
        assert_eq!(
            text,
            r#"Not tied north–south: Kitchen. Measure from Kitchen north to Kitchen south, or add "Kitchen east of Hall gap 90"."#
        );
    }

    #[test]
    fn w001_depth_unknown_variant() {
        let text = message(
            Code::W001,
            &[arg("room", "Kitchen"), arg("unknown_depth", "true")],
        );
        assert_eq!(
            text,
            "Kitchen depth unknown; measure Kitchen.north to Kitchen.south"
        );
    }

    #[test]
    fn w001_width_unknown_wording() {
        let text = message(Code::W001, &[arg("room", "Hall"), arg("unknown_width", "")]);
        assert_eq!(text, "Hall width unknown; measure Hall.west to Hall.east");
    }

    #[test]
    fn w003_exact_wording() {
        let text = message(
            Code::W003,
            &[
                arg("a", "Kitchen"),
                arg("ya", "0"),
                arg("b", "Hall"),
                arg("yb", "40"),
                arg("d", "40"),
                arg("side", "north"),
                arg("ra", "Kitchen"),
                arg("rb", "Hall"),
            ],
        );
        assert_eq!(
            text,
            r#"Facade not straight: Kitchen 0 vs Hall 40 (40 mm). Add "align north Kitchen Hall" if it is straight."#
        );
    }

    #[test]
    fn w004_exact_wording() {
        let text = message(Code::W004, &[arg("list", "kitchen.width 3000→3010")]);
        assert_eq!(
            text,
            "Adjusted to fit within tolerance: kitchen.width 3000→3010."
        );
    }

    #[test]
    fn i010_exact_wording() {
        let text = message(Code::I010, &[arg("id", "W2"), arg("t", "120")]);
        assert_eq!(text, "Wall W2 is 120 mm, derived from the room positions.");
    }

    #[test]
    fn missing_args_stay_visible_and_do_not_panic() {
        let text = message(Code::E002, &[arg("a", "2")]);
        assert_eq!(
            text,
            r#"Room "{name}" is declared twice (lines 2 and {b})."#
        );
    }

    #[test]
    fn unmatched_brace_is_copied_through() {
        assert_eq!(fill("open {name", &[arg("name", "x")]), "open {name");
    }

    #[test]
    fn code_display_is_code_string() {
        assert_eq!(Code::E001.to_string(), "E001");
        assert_eq!(Code::W004.to_string(), "W004");
        assert_eq!(Code::I010.to_string(), "I010");
        assert_eq!(format!("{}", Code::E010), "E010");
    }

    #[test]
    fn code_serializes_as_code_string() {
        let json = serde_json::to_string(&Code::E006).expect("serialize code");
        assert_eq!(json, r#""E006""#);
    }

    #[test]
    fn diagnostic_serde_round_trip() {
        let diagnostic = Diagnostic {
            code: Code::E005,
            severity: Severity::Error,
            message: message(
                Code::E005,
                &[
                    arg("a", "Kitchen"),
                    arg("b", "Hall"),
                    arg("dx", "40"),
                    arg("dy", "12"),
                ],
            ),
            span: Some(Span { line: 5, col: 2 }),
            refs: vec!["kitchen".to_string(), "hall".to_string()],
            data: serde_json::json!({ "dx": 40, "dy": 12 }),
        };
        let json = serde_json::to_string(&diagnostic).expect("serialize diagnostic");
        let back: Diagnostic = serde_json::from_str(&json).expect("deserialize diagnostic");
        assert_eq!(back, diagnostic);
    }
}
