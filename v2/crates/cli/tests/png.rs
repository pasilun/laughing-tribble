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
