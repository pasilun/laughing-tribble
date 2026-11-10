//! Acceptance plan apt-1: two flats, a stairwell, a kitchen stub and a balcony
//! (spec §15 D44–D47). The expected numbers are worked out by hand from the
//! plan text, x east, y south, all in mm.

use plan_core::{Code, RectMm, Severity, element_rect, load, review};

const APT_1: &str = include_str!("../../../fixtures/apt-1.plan");

fn rect(x0: i64, y0: i64, x1: i64, y1: i64) -> RectMm {
    RectMm { x0, y0, x1, y1 }
}

#[test]
fn apt1_resolves_without_error_or_w001() {
    let r = load(APT_1).expect("apt-1 loads");
    assert!(r.resolved.is_some(), "{:?}", r.diagnostics);
    assert!(
        !r.diagnostics
            .iter()
            .any(|d| d.severity == Severity::Error || d.code == Code::W001),
        "{:?}",
        r.diagnostics
    );
}

#[test]
fn apt1_room_faces() {
    let r = load(APT_1).expect("apt-1 loads");
    let model = r.resolved.as_ref().expect("apt-1 resolves");
    assert_eq!(element_rect(model, "Rum1"), Some(rect(0, 0, 3600, 4000)));
    assert_eq!(element_rect(model, "Kok1"), Some(rect(3700, 0, 6100, 4000)));
    assert_eq!(
        element_rect(model, "Trapphus"),
        Some(rect(6400, 0, 9000, 4000))
    );
    assert_eq!(
        element_rect(model, "Rum2"),
        Some(rect(9300, 0, 12900, 4000))
    );
    assert_eq!(
        element_rect(model, "Matvra"),
        Some(rect(3700, 4000, 6100, 5500))
    );
}

#[test]
fn apt1_apartments() {
    let r = load(APT_1).expect("apt-1 loads");
    let model = r.resolved.as_ref().expect("apt-1 resolves");
    assert_eq!(model.apartments.get("1"), Some(&27_600_000));
    assert_eq!(model.apartments.get("2"), Some(&14_400_000));
}

#[test]
fn apt1_separating_walls() {
    let r = load(APT_1).expect("apt-1 loads");
    let model = r.resolved.as_ref().expect("apt-1 resolves");
    let mut separating: Vec<&str> = model
        .walls
        .values()
        .filter(|w| w.separating)
        .map(|w| w.id.as_str())
        .collect();
    separating.sort_unstable();
    assert_eq!(
        separating,
        ["W:Kok1.east|Trapphus.west", "W:Rum2.west|Trapphus.east"]
    );
    let first = model
        .walls
        .get("W:Kok1.east|Trapphus.west")
        .expect("wall exists");
    assert!(first.bearing);
}

#[test]
fn apt1_fixtures_and_stub() {
    let r = load(APT_1).expect("apt-1 loads");
    let model = r.resolved.as_ref().expect("apt-1 resolves");
    assert_eq!(
        element_rect(model, "F:Kok1.north:1"),
        Some(rect(3900, 0, 4500, 600))
    );
    assert_eq!(
        element_rect(model, "F:Kok1.north:2"),
        Some(rect(4600, 0, 5200, 600))
    );
    assert_eq!(
        element_rect(model, "F:Rum1.south:1"),
        Some(rect(800, 4400, 2800, 5700))
    );
    assert_eq!(
        element_rect(model, "S:Kok1.west:1"),
        Some(rect(3700, 2000, 4300, 2100))
    );
}

#[test]
fn apt1_room_parts() {
    let r = load(APT_1).expect("apt-1 loads");
    let model = r.resolved.as_ref().expect("apt-1 resolves");
    let parts: Vec<(String, String)> = model
        .room_parts
        .iter()
        .map(|(part, parent)| (part.to_string(), parent.to_string()))
        .collect();
    assert_eq!(parts, [("Matvra".to_string(), "Kok1".to_string())]);
}

#[test]
fn apt1_review_is_clean() {
    let r = load(APT_1).expect("apt-1 loads");
    let model = r.resolved.as_ref().expect("apt-1 resolves");
    let findings = review(&r.plan, model);
    assert!(findings.is_empty(), "{findings:?}");
}
