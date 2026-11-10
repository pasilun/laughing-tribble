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
    /// E011: unknown element id in a render region (spec §8, D10).
    #[serde(rename = "E011")]
    E011,
    /// E012: render failed (spec §8).
    #[serde(rename = "E012")]
    E012,
    /// E013: door hinge not along its face (spec §9.3, D19).
    #[serde(rename = "E013")]
    E013,
    /// E014: a size is below 1 mm (spec §8, D26).
    #[serde(rename = "E014")]
    E014,
    /// E015: a placement relation relates a room to itself (spec §8, D26).
    #[serde(rename = "E015")]
    E015,
    /// E016: two openings overlap in one wall (spec §8, D26).
    #[serde(rename = "E016")]
    E016,
    /// E017: a door opens into a room that is not at its wall (spec §8, D26).
    #[serde(rename = "E017")]
    E017,
    /// E018: the plan does not fit the sheet at any offered scale (spec §8, D31).
    #[serde(rename = "E018")]
    E018,
    /// E019: a fixture or stub runs outside its room (spec §8, D44).
    #[serde(rename = "E019")]
    E019,
    /// E020: unknown plan (MCP).
    #[serde(rename = "E020")]
    E020,
    /// E021: invalid plan id (MCP).
    #[serde(rename = "E021")]
    E021,
    /// E022: render view not available yet (MCP, D17).
    #[serde(rename = "E022")]
    E022,
    /// E023: plan file read or write failed (MCP).
    #[serde(rename = "E023")]
    E023,
    /// W001: under-constrained (spec §6.4 wording; depth-unknown variant when `unknown_depth` is given).
    #[serde(rename = "W001")]
    W001,
    /// W003: facade step of 1 to 100 mm.
    #[serde(rename = "W003")]
    W003,
    /// W004: values adjusted to close a cycle.
    #[serde(rename = "W004")]
    W004,
    /// W005: wall thinner than 70 mm or thicker than 600 mm.
    #[serde(rename = "W005")]
    W005,
    /// W020: a reference measure differs from the drawn distance (spec §15 D25).
    #[serde(rename = "W020")]
    W020,
    /// W030: a load-bearing wall is demolished (spec §8, D35).
    #[serde(rename = "W030")]
    W030,
    /// W031: a fire-cell boundary is demolished (spec §8, D35).
    #[serde(rename = "W031")]
    W031,
    /// W032: a new opening sits in a load-bearing wall (spec §8, D35).
    #[serde(rename = "W032")]
    W032,
    /// W033: a new opening sits in a fire-cell boundary (spec §8, D35).
    #[serde(rename = "W033")]
    W033,
    /// W034: kitchen fixtures demolished with no capped connection marked (spec §8, D48).
    #[serde(rename = "W034")]
    W034,
    /// I010: wall thickness derived, not stated.
    #[serde(rename = "I010")]
    I010,
    /// I020: measurement suggested for a size or gap that is only estimated, assumed or drawn.
    #[serde(rename = "I020")]
    I020,
    /// I030: a new opening has no height (spec §8, D35).
    #[serde(rename = "I030")]
    I030,
    /// I031: a title block key is missing or blank (spec §8, D41).
    #[serde(rename = "I031")]
    I031,
    /// I032: ventilation changes; flows must be re-balanced (spec §8, D48).
    #[serde(rename = "I032")]
    I032,
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
            Code::E011 => "E011",
            Code::E012 => "E012",
            Code::E013 => "E013",
            Code::E014 => "E014",
            Code::E015 => "E015",
            Code::E016 => "E016",
            Code::E017 => "E017",
            Code::E018 => "E018",
            Code::E019 => "E019",
            Code::E020 => "E020",
            Code::E021 => "E021",
            Code::E022 => "E022",
            Code::E023 => "E023",
            Code::W001 => "W001",
            Code::W003 => "W003",
            Code::W004 => "W004",
            Code::W005 => "W005",
            Code::W020 => "W020",
            Code::W030 => "W030",
            Code::W031 => "W031",
            Code::W032 => "W032",
            Code::W033 => "W033",
            Code::W034 => "W034",
            Code::I010 => "I010",
            Code::I020 => "I020",
            Code::I030 => "I030",
            Code::I031 => "I031",
            Code::I032 => "I032",
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
        Code::E011 => {
            let base = fill(r#"Unknown element "{id}"."#, args);
            let suggested = match lookup(args, "suggestion") {
                Some(s) => format!("{base} Did you mean \"{s}\"?"),
                None => base,
            };
            format!("{suggested} Use a room name, or a wall or opening id from get.")
        }
        Code::E012 => fill("Render failed: {reason}.", args),
        Code::E013 => fill(r#"Hinge "{found}" on {face} must be {a} or {b}."#, args),
        Code::E014 => fill("{what} is {value} mm; it must be at least 1 mm.", args),
        Code::E015 => fill(
            r#""{subject} {relation} {of}" relates a room to itself."#,
            args,
        ),
        Code::E016 => fill(
            "Openings {a} and {b} overlap by {d} mm on wall {wall}.",
            args,
        ),
        Code::E017 => fill(
            r#"Door on {face} cannot open into "{room}"; use {options}."#,
            args,
        ),
        Code::E018 => {
            let base = fill("Plan does not fit on {paper} at 1:{scale}.", args);
            // The larger scale is only suggested when the caller gives one (same as E001).
            match lookup(args, "fit") {
                Some(fit) => format!("{base} Use 1:{fit}."),
                None => base,
            }
        }
        Code::E019 => fill("{what} on {face} at {at} runs outside {room}.", args),
        Code::E020 => fill(r#"Unknown plan "{id}". Create it with apply."#, args),
        Code::E021 => fill(
            r#"Invalid plan_id "{id}": use 1 to 64 letters, digits, "-" or "_"."#,
            args,
        ),
        Code::E022 => fill(
            r#"View "{view}" is not available yet; use "plan" or "labels"."#,
            args,
        ),
        Code::E023 => fill(r#"Could not {action} plan "{id}": {reason}."#, args),
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
        Code::W005 => fill(
            "Wall {id} is {t} mm thick; check the measurements around it.",
            args,
        ),
        Code::W020 => fill(
            "Reference measure {from}→{to}: drawn {drawn}, measured {value} ({diff} mm).",
            args,
        ),
        Code::W030 => fill(
            "Wall {id} is load-bearing and is demolished; this needs a structural engineer's drawings and calculation.",
            args,
        ),
        Code::W031 => fill(
            "Wall {id} is a fire-cell boundary ({fire}) and is demolished; a fire protection description is required.",
            args,
        ),
        Code::W032 => fill(
            "{kind} {id} is new and sits in load-bearing wall {wall}; this needs a structural engineer's statement.",
            args,
        ),
        Code::W033 => fill(
            "{kind} {id} is new and sits in fire-cell boundary {wall} ({fire}); a fire protection description is required.",
            args,
        ),
        Code::W034 => fill(
            r#"Kitchen fixtures are demolished but no capped connection is marked; add a "plug" fixture where the pipes are capped."#,
            args,
        ),
        Code::I010 => fill(
            "Wall {id} is {t} mm, derived from the room positions.",
            args,
        ),
        Code::I020 => fill(
            "{what} {value} mm has source {source} (±{tol} mm); measure {from} to {to} with the laser.",
            args,
        ),
        Code::I030 => fill(
            r#"{kind} {id} is new and has no height; add "height <mm>" if the engineer needs it."#,
            args,
        ),
        Code::I031 => fill(r#"Title block has no {key}; add: title {key} "…""#, args),
        Code::I032 => fill(
            "Ventilation changes: the flows must be re-balanced against the latest OVK and a new OVK made.",
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
    fn e011_with_suggestion() {
        let text = message(Code::E011, &[arg("id", "Hal"), arg("suggestion", "Hall")]);
        assert_eq!(
            text,
            r#"Unknown element "Hal". Did you mean "Hall"? Use a room name, or a wall or opening id from get."#
        );
    }

    #[test]
    fn e011_without_suggestion_omits_sentence() {
        let text = message(Code::E011, &[arg("id", "Zzz")]);
        assert_eq!(
            text,
            r#"Unknown element "Zzz". Use a room name, or a wall or opening id from get."#
        );
    }

    #[test]
    fn e012_wording() {
        let text = message(Code::E012, &[arg("reason", "bad svg")]);
        assert_eq!(text, "Render failed: bad svg.");
    }

    #[test]
    fn e013_exact_wording_north_face() {
        let text = message(
            Code::E013,
            &[
                arg("found", "south"),
                arg("face", "WC.north"),
                arg("a", "west"),
                arg("b", "east"),
            ],
        );
        assert_eq!(text, r#"Hinge "south" on WC.north must be west or east."#);
    }

    #[test]
    fn e013_exact_wording_west_face() {
        let text = message(
            Code::E013,
            &[
                arg("found", "east"),
                arg("face", "WC.west"),
                arg("a", "north"),
                arg("b", "south"),
            ],
        );
        assert_eq!(text, r#"Hinge "east" on WC.west must be north or south."#);
    }

    #[test]
    fn e020_exact_wording() {
        let text = message(Code::E020, &[arg("id", "nope")]);
        assert_eq!(text, r#"Unknown plan "nope". Create it with apply."#);
    }

    #[test]
    fn e021_exact_wording() {
        let text = message(Code::E021, &[arg("id", "../etc")]);
        assert_eq!(
            text,
            r#"Invalid plan_id "../etc": use 1 to 64 letters, digits, "-" or "_"."#
        );
    }

    #[test]
    fn e022_exact_wording() {
        let text = message(Code::E022, &[arg("view", "conflicts")]);
        assert_eq!(
            text,
            r#"View "conflicts" is not available yet; use "plan" or "labels"."#
        );
    }

    #[test]
    fn e023_exact_wording() {
        let text = message(
            Code::E023,
            &[
                arg("action", "read"),
                arg("id", "lgh154-a"),
                arg("reason", "permission denied"),
            ],
        );
        assert_eq!(
            text,
            r#"Could not read plan "lgh154-a": permission denied."#
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
    fn i020_exact_wording() {
        let text = message(
            Code::I020,
            &[
                arg("what", "Gap Hall east_of Garderob"),
                arg("value", "121"),
                arg("source", "drawing"),
                arg("tol", "30"),
                arg("from", "Garderob.west"),
                arg("to", "Hall.east"),
            ],
        );
        assert_eq!(
            text,
            "Gap Hall east_of Garderob 121 mm has source drawing (±30 mm); measure Garderob.west to Hall.east with the laser."
        );
    }

    #[test]
    fn e014_exact_wording() {
        let text = message(
            Code::E014,
            &[arg("what", "Room A width"), arg("value", "0")],
        );
        assert_eq!(text, "Room A width is 0 mm; it must be at least 1 mm.");
    }

    #[test]
    fn e015_exact_wording() {
        let text = message(
            Code::E015,
            &[
                arg("subject", "Hall"),
                arg("relation", "east of"),
                arg("of", "Hall"),
            ],
        );
        assert_eq!(text, r#""Hall east of Hall" relates a room to itself."#);
    }

    #[test]
    fn e016_exact_wording() {
        let text = message(
            Code::E016,
            &[
                arg("a", "D1"),
                arg("b", "W2"),
                arg("d", "150"),
                arg("wall", "north"),
            ],
        );
        assert_eq!(text, "Openings D1 and W2 overlap by 150 mm on wall north.");
    }

    #[test]
    fn e017_exact_wording() {
        let text = message(
            Code::E017,
            &[
                arg("face", "north"),
                arg("room", "Hall"),
                arg("options", "a wall to the Hall or a different hinge side"),
            ],
        );
        assert_eq!(
            text,
            r#"Door on north cannot open into "Hall"; use a wall to the Hall or a different hinge side."#
        );
    }

    #[test]
    fn e018_with_fit_appends_suggestion() {
        let text = message(
            Code::E018,
            &[arg("paper", "A4"), arg("scale", "20"), arg("fit", "50")],
        );
        assert_eq!(text, "Plan does not fit on A4 at 1:20. Use 1:50.");
    }

    #[test]
    fn e018_without_fit_omits_sentence() {
        let text = message(Code::E018, &[arg("paper", "A4"), arg("scale", "20")]);
        assert_eq!(text, "Plan does not fit on A4 at 1:20.");
    }

    #[test]
    fn w005_exact_wording() {
        let text = message(Code::W005, &[arg("id", "W3"), arg("t", "45")]);
        assert_eq!(
            text,
            "Wall W3 is 45 mm thick; check the measurements around it."
        );
    }

    #[test]
    fn w020_exact_wording() {
        let text = message(
            Code::W020,
            &[
                arg("from", "B.east"),
                arg("to", "A.east"),
                arg("drawn", "500"),
                arg("value", "520"),
                arg("diff", "20"),
            ],
        );
        assert_eq!(
            text,
            "Reference measure B.east→A.east: drawn 500, measured 520 (20 mm)."
        );
    }

    #[test]
    fn w030_exact_wording() {
        let text = message(Code::W030, &[arg("id", "W2")]);
        assert_eq!(
            text,
            "Wall W2 is load-bearing and is demolished; this needs a structural engineer's drawings and calculation."
        );
    }

    #[test]
    fn w031_exact_wording() {
        let text = message(Code::W031, &[arg("id", "W2"), arg("fire", "EI 60")]);
        assert_eq!(
            text,
            "Wall W2 is a fire-cell boundary (EI 60) and is demolished; a fire protection description is required."
        );
    }

    #[test]
    fn w032_exact_wording() {
        let text = message(
            Code::W032,
            &[arg("kind", "Opening"), arg("id", "O1"), arg("wall", "W2")],
        );
        assert_eq!(
            text,
            "Opening O1 is new and sits in load-bearing wall W2; this needs a structural engineer's statement."
        );
    }

    #[test]
    fn w033_exact_wording() {
        let text = message(
            Code::W033,
            &[
                arg("kind", "Door"),
                arg("id", "D1"),
                arg("wall", "W5"),
                arg("fire", "EI 30"),
            ],
        );
        assert_eq!(
            text,
            "Door D1 is new and sits in fire-cell boundary W5 (EI 30); a fire protection description is required."
        );
    }

    #[test]
    fn i030_exact_wording() {
        let text = message(Code::I030, &[arg("kind", "Window"), arg("id", "F1")]);
        assert_eq!(
            text,
            r#"Window F1 is new and has no height; add "height <mm>" if the engineer needs it."#
        );
    }

    #[test]
    fn e019_exact_wording() {
        let text = message(
            Code::E019,
            &[
                arg("what", "Fixture stove"),
                arg("face", "Kok1.north"),
                arg("at", "2000"),
                arg("room", "Kok1"),
            ],
        );
        assert_eq!(
            text,
            "Fixture stove on Kok1.north at 2000 runs outside Kok1."
        );
    }

    #[test]
    fn w034_exact_wording() {
        let text = message(Code::W034, &[]);
        assert_eq!(
            text,
            r#"Kitchen fixtures are demolished but no capped connection is marked; add a "plug" fixture where the pipes are capped."#
        );
    }

    #[test]
    fn i032_exact_wording() {
        let text = message(Code::I032, &[]);
        assert_eq!(
            text,
            "Ventilation changes: the flows must be re-balanced against the latest OVK and a new OVK made."
        );
    }

    #[test]
    fn w030_code_string_and_serde() {
        assert_eq!(Code::W030.as_str(), "W030");
        assert_eq!(
            serde_json::to_string(&Code::W030).expect("serialize code"),
            r#""W030""#
        );
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
        assert_eq!(Code::I020.to_string(), "I020");
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
