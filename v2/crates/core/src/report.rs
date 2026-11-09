//! The value printed by `plan solve --json` (spec §7.7).
//!
//! Built here rather than in the CLI, so every client gets the same keys (spec
//! §15 D3). The model keys (`faces`, `areas_mm2`, `spaces`, `openings`,
//! `interior_walls`) are present only when the plan resolved, as the §7.7 comment
//! on `faces` says and as the unresolved fixtures show.
//!
//! Decisions:
//! - Diagnostic data is copied from the solver's `data` keys `axis`, `residual`
//!   and `tolerance`, renamed to `residual_mm` and `tolerance_mm` (§7.7 units).
//! - An opening's `at` is measured from the face's west end (north and south
//!   faces) or north end (east and west faces), as in the §7.7 examples.
//! - `opens_into` is written only for doors that name the room the leaf swings into.

use serde_json::{Map, Value, json};

use crate::diagnostics::{Code, Diagnostic, Severity};
use crate::intent::{OpeningKind, Side};
use crate::resolved::{Resolved, ResolvedOpening, RoomRect, WallKind};

/// The §7.7 expected-JSON value for a solve of the plan in the file `stem`.
///
/// `resolved` is `None` when an Error diagnostic stopped the solve; then only
/// `fixture`, `resolved` and `diagnostics` are present.
pub fn solve_json(stem: &str, resolved: Option<&Resolved>, diagnostics: &[Diagnostic]) -> Value {
    let mut out = Map::new();
    out.insert("fixture".to_string(), json!(stem));
    out.insert("resolved".to_string(), json!(resolved.is_some()));
    if let Some(model) = resolved {
        out.insert("faces".to_string(), faces(model));
        out.insert("areas_mm2".to_string(), areas(model));
        out.insert("spaces".to_string(), spaces(model));
        out.insert("openings".to_string(), openings(model));
        out.insert("interior_walls".to_string(), interior_walls(model));
    }
    out.insert(
        "diagnostics".to_string(),
        Value::Array(diagnostics.iter().map(diagnostic).collect()),
    );
    Value::Object(out)
}

/// `{ "<Room>": { "west", "east", "north", "south" } }` for every solved room.
fn faces(model: &Resolved) -> Value {
    Value::Object(
        model
            .rooms
            .iter()
            .map(|(name, rect)| {
                (
                    name.to_string(),
                    json!({
                        "west": rect.west,
                        "east": rect.east,
                        "north": rect.north,
                        "south": rect.south,
                    }),
                )
            })
            .collect(),
    )
}

/// `{ "<Room>": area in mm² }` for every solved room.
fn areas(model: &Resolved) -> Value {
    Value::Object(
        model
            .rooms
            .iter()
            .map(|(name, rect)| (name.to_string(), json!(area(rect))))
            .collect(),
    )
}

/// The inner area of a room in mm².
fn area(rect: &RoomRect) -> i64 {
    (rect.east - rect.west) * (rect.south - rect.north)
}

/// `[ { "rooms": [...], "area_mm2": n } ]`, in the resolved order.
fn spaces(model: &Resolved) -> Value {
    Value::Array(
        model
            .spaces
            .iter()
            .map(|space| {
                let rooms: Vec<String> = space.rooms.iter().map(ToString::to_string).collect();
                json!({ "rooms": rooms, "area_mm2": space.area })
            })
            .collect(),
    )
}

/// The openings, by id. Doors carry `hinge` when they have one.
fn openings(model: &Resolved) -> Value {
    Value::Array(
        model
            .openings
            .values()
            .map(|opening| opening_json(model, opening))
            .collect(),
    )
}

fn opening_json(model: &Resolved, opening: &ResolvedOpening) -> Value {
    let origin = model
        .rooms
        .get(&opening.face.room)
        .map_or(0, |rect| match opening.face.side {
            Side::North | Side::South => rect.west,
            Side::East | Side::West => rect.north,
        });
    let mut out = Map::new();
    out.insert("id".to_string(), json!(opening.id));
    out.insert("kind".to_string(), json!(kind_name(opening.kind)));
    out.insert("wall".to_string(), json!(opening.wall));
    out.insert("at".to_string(), json!(opening.start - origin));
    out.insert("width".to_string(), json!(opening.end - opening.start));
    if let Some(hinge) = opening.hinge {
        out.insert("hinge".to_string(), json!(side_name(hinge)));
    }
    if let Some(room) = &opening.opens_into {
        out.insert("opens_into".to_string(), json!(room.as_str()));
    }
    Value::Object(out)
}

/// The interior walls, by id, with their body extents.
fn interior_walls(model: &Resolved) -> Value {
    Value::Array(
        model
            .walls
            .values()
            .filter(|wall| wall.kind == WallKind::Interior)
            .map(|wall| {
                json!({
                    "id": wall.id,
                    "thickness": wall.thickness,
                    "x": [wall.x.0, wall.x.1],
                    "y": [wall.y.0, wall.y.1],
                })
            })
            .collect(),
    )
}

/// One diagnostic: `code`, `severity` and the data fields `axis`, `residual_mm`
/// and `tolerance_mm` when the solver gave them.
fn diagnostic(diagnostic: &Diagnostic) -> Value {
    let mut out = Map::new();
    out.insert("code".to_string(), json!(diagnostic.code.as_str()));
    out.insert(
        "severity".to_string(),
        json!(severity_name(diagnostic.severity)),
    );
    let fields = [
        ("axis", "axis"),
        ("residual", "residual_mm"),
        ("tolerance", "tolerance_mm"),
    ];
    for (from, to) in fields {
        if let Some(value) = diagnostic.data.get(from) {
            out.insert(to.to_string(), value.clone());
        }
    }
    if diagnostic.code == Code::W001 {
        let letter = out
            .get("axis")
            .and_then(Value::as_str)
            .and_then(axis_letter);
        if let Some(letter) = letter {
            out.insert("axis".to_string(), json!(letter));
        }
    }
    Value::Object(out)
}

/// The §7.7 axis letter for the display word the solver gives W001 (`x` for
/// "east–west", `y` for "north–south"). `None` for any other word.
fn axis_letter(word: &str) -> Option<&'static str> {
    match word {
        "east–west" => Some("x"),
        "north–south" => Some("y"),
        _ => None,
    }
}

fn kind_name(kind: OpeningKind) -> &'static str {
    match kind {
        OpeningKind::Door => "door",
        OpeningKind::Window => "window",
        OpeningKind::Passage => "passage",
    }
}

fn side_name(side: Side) -> &'static str {
    match side {
        Side::North => "north",
        Side::East => "east",
        Side::South => "south",
        Side::West => "west",
    }
}

fn severity_name(severity: Severity) -> &'static str {
    match severity {
        Severity::Error => "error",
        Severity::Warning => "warning",
        Severity::Info => "info",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dsl::parse;
    use crate::resolved::resolve;

    #[test]
    fn w001_axis_is_x_or_y_for_a_loose_room() {
        // C has no measurement on x, so it is loose there. The solver also
        // reports loose rooms on y, so every W001 axis is checked.
        let plan =
            parse("room A 1000 x 2000\nroom B 1000 x 2000\n  east_of A gap\nroom C 1000 x 2000\n")
                .expect("parse");
        let (resolved, diagnostics) = resolve(&plan);
        let value = solve_json("loose", resolved.as_ref(), &diagnostics);

        let w001: Vec<&Value> = value["diagnostics"]
            .as_array()
            .expect("diagnostics array")
            .iter()
            .filter(|d| d["code"] == "W001")
            .collect();
        assert!(!w001.is_empty(), "{value:#}");
        for d in &w001 {
            let axis = d["axis"].as_str().expect("axis is a string");
            assert!(axis == "x" || axis == "y", "axis was {axis:?} in {d}");
        }
        // Only C is loose on x, so exactly one W001 is on x.
        let on_x = w001.iter().filter(|d| d["axis"] == "x").count();
        assert_eq!(on_x, 1, "{value:#}");
    }
}
