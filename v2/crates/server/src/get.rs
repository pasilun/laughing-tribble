//! View builders for the MCP `get` tool (spec §11 Phase 4, §15 D15, §7.7).
//!
//! `dsl` never fails on bad text: it returns the stored text plus the parse
//! diagnostic, so the model can see and fix it. `summary` and `json` return
//! the parse and name errors as `Err`, which the tool reports as a tool error.

use plan_core::api::Resolve;
use plan_core::dsl::{parse, print};
use plan_core::{Diagnostic, Severity, solve_json};
use serde_json::{Map, Value, json};

use crate::{Field, GetView};

/// The `get` result for the view `view` of plan `plan_id` with stored text `text`.
pub fn view_value(
    view: &GetView,
    plan_id: &str,
    text: &str,
    fields: &[Field],
) -> Result<Value, Vec<Diagnostic>> {
    match view {
        GetView::Summary => summary(plan_id, &plan_core::load(text)?),
        GetView::Dsl => Ok(dsl(plan_id, text)),
        GetView::Json => Ok(json_view(plan_id, &plan_core::load(text)?, fields)),
    }
}

/// `{ "plan_id", "view": "dsl", "text" }`: the canonical text of the parsed plan,
/// or the stored text unchanged plus `diagnostics` when it does not parse.
pub fn dsl(plan_id: &str, text: &str) -> Value {
    match parse(text) {
        Ok(plan) => json!({ "plan_id": plan_id, "view": "dsl", "text": print(&plan) }),
        Err(d) => json!({
            "plan_id": plan_id,
            "view": "dsl",
            "text": text,
            "diagnostics": [d],
        }),
    }
}

/// `{ "plan_id", "view": "summary", "text" }`: the fixed text format of D15.
pub fn summary(plan_id: &str, resolve: &Resolve) -> Result<Value, Vec<Diagnostic>> {
    let plan = &resolve.plan;
    let resolved = resolve.resolved.as_ref();
    let mut lines = Vec::new();
    lines.push(format!(
        "Plan \"{}\": {} rooms, {}.",
        plan.name,
        plan.rooms.len(),
        if resolved.is_some() {
            "resolved"
        } else {
            "not resolved"
        }
    ));
    for name in &plan.order {
        let rect = resolved.and_then(|r| r.rooms.get(name));
        let (w, d, area) = match rect {
            Some(rect) => {
                let w = rect.east - rect.west;
                let d = rect.south - rect.north;
                (
                    w.to_string(),
                    d.to_string(),
                    format!("{:.2}", (w * d) as f64 / 1_000_000.0),
                )
            }
            None => {
                let room = plan.rooms.get(name);
                let size = |q: Option<&plan_core::Quantity>| {
                    q.map_or_else(|| "?".to_string(), |q| q.value.to_string())
                };
                (
                    size(room.and_then(|r| r.width.as_ref())),
                    size(room.and_then(|r| r.depth.as_ref())),
                    "?".to_string(),
                )
            }
        };
        lines.push(format!("{name} {w} x {d} mm, {area} m²"));
    }
    let (walls, openings) = resolved.map_or((0, 0), |r| (r.walls.len(), r.openings.len()));
    lines.push(format!("Walls: {walls}, openings: {openings}."));
    let count = |s: Severity| {
        resolve
            .diagnostics
            .iter()
            .filter(|d| d.severity == s)
            .count()
    };
    lines.push(format!(
        "Diagnostics: errors {}, warnings {}, info {}.",
        count(Severity::Error),
        count(Severity::Warning),
        count(Severity::Info)
    ));
    Ok(json!({ "plan_id": plan_id, "view": "summary", "text": lines.join("\n") }))
}

/// `solve_json` filtered by `fields` (all groups when empty). `fixture` and
/// `resolved` are always kept.
pub fn json_view(plan_id: &str, resolve: &Resolve, fields: &[Field]) -> Value {
    let full = solve_json(plan_id, resolve.resolved.as_ref(), &resolve.diagnostics);
    let all = fields.is_empty();
    let wanted = |key: &str| all || fields.iter().any(|f| keys(f).contains(&key));
    let mut out = Map::new();
    if let Value::Object(map) = full {
        for (key, value) in map {
            if key == "fixture" || key == "resolved" || wanted(&key) {
                out.insert(key, value);
            }
        }
    }
    Value::Object(out)
}

/// The §7.7 keys that belong to a field group.
fn keys(field: &Field) -> &'static [&'static str] {
    match field {
        Field::Rooms => &["faces", "areas_mm2", "spaces", "adjusted"],
        Field::Walls => &["interior_walls"],
        Field::Openings => &["openings"],
        Field::Diagnostics => &["diagnostics"],
    }
}
