//! `plan png` end to end (spec §11 P2-03, P2-04, §15 D9).

use std::path::PathBuf;
use std::process::{Command, Output};

fn fixture(name: &str) -> String {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../fixtures")
        .join(name)
        .display()
        .to_string()
}

fn out_path(name: &str) -> String {
    PathBuf::from(env!("CARGO_TARGET_TMPDIR"))
        .join(name)
        .display()
        .to_string()
}

fn plan(args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_plan"))
        .args(args)
        .output()
        .expect("run plan")
}

fn code(output: &Output) -> i32 {
    output.status.code().expect("exit code")
}

#[test]
fn default_options_write_png_and_viewport() {
    let out = out_path("png-default.png");
    let output = plan(&["png", &fixture("lgh154-a.plan"), "-o", &out]);
    assert_eq!(code(&output), 0);
    let bytes = std::fs::read(&out).expect("png written");
    assert!(bytes.starts_with(b"\x89PNG"));
    let value: serde_json::Value = serde_json::from_slice(&output.stdout).expect("stdout is JSON");
    assert!(value["tokens"].as_u64().expect("tokens") <= 1600);
}

#[test]
fn region_hall_prints_exact_viewport() {
    let out = out_path("png-hall.png");
    let output = plan(&[
        "png",
        &fixture("lgh154-a.plan"),
        "-o",
        &out,
        "--region",
        "Hall",
        "--max-tokens",
        "1600",
    ]);
    assert_eq!(code(&output), 0);
    assert_eq!(
        String::from_utf8(output.stdout).expect("utf8").trim_end(),
        r#"{"origin_mm":[1381,-600],"mm_per_px":2.5,"size_px":[920,926],"tokens":1122}"#
    );
}

#[test]
fn plan_that_does_not_resolve_exits_1() {
    let out = out_path("png-b.png");
    let output = plan(&["png", &fixture("lgh154-b.plan"), "-o", &out]);
    assert_eq!(code(&output), 1);
}

#[test]
fn diff_writes_png_and_counts() {
    let before = out_path("png-diff-before.plan");
    let after = out_path("png-diff-after.plan");
    let source = std::fs::read_to_string(fixture("lgh154-a.plan")).expect("fixture A");
    std::fs::write(&before, &source).expect("write before");
    let changed = source.replace(
        "room WC 2370 x 990 source laser",
        "room WC 2370 x 1200 source laser",
    );
    std::fs::write(&after, changed).expect("write after");

    let out = out_path("png-diff.png");
    let output = plan(&["png", &after, "-o", &out, "--diff", &before]);
    assert_eq!(code(&output), 0);
    let bytes = std::fs::read(&out).expect("png written");
    assert!(bytes.starts_with(b"\x89PNG"));
    let value: serde_json::Value = serde_json::from_slice(&output.stdout).expect("stdout is JSON");
    let diff = value["diff"].as_object().expect("diff object");
    assert!(diff["changed"].as_u64().expect("changed") > 0);
    assert!(value["tokens"].as_u64().expect("tokens") <= 1600);
}

#[test]
fn region_and_rect_together_exit_2() {
    let out = out_path("png-both.png");
    let output = plan(&[
        "png",
        &fixture("lgh154-a.plan"),
        "-o",
        &out,
        "--region",
        "Hall",
        "--rect",
        "0,0,1,1",
    ]);
    assert_eq!(code(&output), 2);
}

#[test]
fn conflicts_view_draws_the_marks() {
    let out = out_path("png-conflicts.png");
    let output = plan(&[
        "png",
        &fixture("lgh154-b.plan"),
        "-o",
        &out,
        "--view",
        "conflicts",
    ]);
    assert_eq!(code(&output), 0);
    let bytes = std::fs::read(&out).expect("png written");
    assert!(bytes.starts_with(b"\x89PNG"));
    let value: serde_json::Value = serde_json::from_slice(&output.stdout).expect("stdout is JSON");
    assert_eq!(value["marks"].as_u64(), Some(1));
}

#[test]
fn labels_view_of_a_conflicting_plan_exits_1_with_e003() {
    let out = out_path("png-b-labels.png");
    let output = plan(&[
        "png",
        &fixture("lgh154-b.plan"),
        "-o",
        &out,
        "--view",
        "labels",
    ]);
    assert_eq!(code(&output), 1);
    let stdout = String::from_utf8(output.stdout).expect("utf8");
    assert!(stdout.contains("E003"), "{stdout}");
}
