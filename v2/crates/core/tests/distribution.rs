//! Distribution of within-tolerance cycles (spec §6.2 steps 5–7, §7.7, §8 W004,
//! §15 D6), checked through the public entry points.

use serde_json::Value;

use plan_core::{load, solve_json};

const DIST_1: &str = include_str!("../../../fixtures/dist-1.plan");
const DIST_1_EXPECTED: &str = include_str!("../../../fixtures/dist-1.expected.json");
const FIXTURE_A: &str = include_str!("../../../fixtures/lgh154-a.plan");
const FIXTURE_A_EXPECTED: &str = include_str!("../../../fixtures/lgh154-a.expected.json");
const FIXTURE_B: &str = include_str!("../../../fixtures/lgh154-b.plan");
const FIXTURE_C: &str = include_str!("../../../fixtures/lgh154-c.plan");

/// The sorted diagnostic codes of a solve, as JSON strings.
fn codes(value: &Value) -> Vec<String> {
    let mut out: Vec<String> = value["diagnostics"]
        .as_array()
        .expect("diagnostics array")
        .iter()
        .map(|d| d["code"].as_str().expect("code string").to_string())
        .collect();
    out.sort();
    out
}

#[test]
fn dist_1_matches_expected() {
    let r = load(DIST_1).expect("dist-1 loads");
    let value = solve_json("dist-1", r.resolved.as_ref(), &r.diagnostics);
    let expected: Value = serde_json::from_str(DIST_1_EXPECTED).expect("expected JSON parses");

    assert_eq!(value["faces"], expected["faces"], "{value:#}");
    assert_eq!(value["adjusted"], expected["adjusted"], "{value:#}");

    let mut want: Vec<String> = expected["diagnostics"]
        .as_array()
        .expect("expected diagnostics array")
        .iter()
        .map(|d| d["code"].as_str().expect("code string").to_string())
        .collect();
    want.sort();
    assert_eq!(codes(&value), want, "{value:#}");
}

#[test]
fn dist_1_w004_text() {
    let r = load(DIST_1).expect("dist-1 loads");
    let w004 = r
        .diagnostics
        .iter()
        .find(|d| d.code == plan_core::Code::W004)
        .expect("dist-1 has a W004");
    assert_eq!(
        w004.message,
        "Adjusted to fit within tolerance: measure B.east to A.east 520→500."
    );
}

#[test]
fn fixture_a_unchanged() {
    let r = load(FIXTURE_A).expect("fixture A loads");
    let value = solve_json("lgh154-a", r.resolved.as_ref(), &r.diagnostics);
    let expected: Value = serde_json::from_str(FIXTURE_A_EXPECTED).expect("expected JSON parses");

    assert_eq!(value["faces"], expected["faces"], "{value:#}");
    assert_eq!(value["areas_mm2"], expected["areas_mm2"], "{value:#}");
    let mut want: Vec<String> = expected["diagnostics"]
        .as_array()
        .expect("expected diagnostics array")
        .iter()
        .map(|d| d["code"].as_str().expect("code string").to_string())
        .collect();
    want.sort();
    assert_eq!(codes(&value), want, "{value:#}");
    assert!(value.get("adjusted").is_none(), "{value:#}");
    assert!(!codes(&value).iter().any(|c| c == "W004"), "{value:#}");
}

#[test]
fn fixture_b_c_not_distributed() {
    for (name, text) in [("lgh154-b", FIXTURE_B), ("lgh154-c", FIXTURE_C)] {
        let r = load(text).expect("fixture loads");
        let value = solve_json(name, r.resolved.as_ref(), &r.diagnostics);
        let e003 = codes(&value).iter().filter(|c| *c == "E003").count();
        assert_eq!(e003, 1, "{name}: {value:#}");
        assert!(
            !codes(&value).iter().any(|c| c == "W004"),
            "{name}: {value:#}"
        );
        assert!(value.get("adjusted").is_none(), "{name}: {value:#}");
    }
}
