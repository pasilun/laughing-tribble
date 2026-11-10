//! `plan pdf` end to end (spec §11 P2-05, §15 D31, D32).

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

fn stdout(output: &Output) -> String {
    String::from_utf8(output.stdout.clone()).expect("utf8")
}

#[test]
fn default_options_write_a3_pdf_and_summary() {
    let out = out_path("pdf-default.pdf");
    let _ = std::fs::remove_file(&out);
    let output = plan(&["pdf", &fixture("lgh154-a.plan"), "-o", &out]);
    assert_eq!(code(&output), 0);
    let bytes = std::fs::read(&out).expect("pdf written");
    assert!(bytes.starts_with(b"%PDF-"));
    let value: serde_json::Value = serde_json::from_slice(&output.stdout).expect("stdout is JSON");
    assert_eq!(value["paper"], "a3");
    assert_eq!(value["scale"], 25);
    assert_eq!(value["bytes"].as_u64().expect("bytes"), bytes.len() as u64);
}

#[test]
fn paper_a4_uses_scale_50() {
    let out = out_path("pdf-a4.pdf");
    let _ = std::fs::remove_file(&out);
    let output = plan(&[
        "pdf",
        &fixture("lgh154-a.plan"),
        "-o",
        &out,
        "--paper",
        "a4",
    ]);
    assert_eq!(code(&output), 0);
    let value: serde_json::Value = serde_json::from_slice(&output.stdout).expect("stdout is JSON");
    assert_eq!(value["paper"], "a4");
    assert_eq!(value["scale"], 50);
    assert!(std::path::Path::new(&out).exists());
}

#[test]
fn scale_that_does_not_fit_exits_1_and_writes_nothing() {
    let out = out_path("pdf-a4-20.pdf");
    let _ = std::fs::remove_file(&out);
    let output = plan(&[
        "pdf",
        &fixture("lgh154-a.plan"),
        "-o",
        &out,
        "--paper",
        "a4",
        "--scale",
        "20",
    ]);
    assert_eq!(code(&output), 1);
    let text = stdout(&output);
    assert!(text.contains("E018"), "stdout: {text}");
    assert!(text.contains("Use 1:50."), "stdout: {text}");
    assert!(!std::path::Path::new(&out).exists());
}

#[test]
fn unknown_paper_exits_2() {
    let out = out_path("pdf-a2.pdf");
    let output = plan(&[
        "pdf",
        &fixture("lgh154-a.plan"),
        "-o",
        &out,
        "--paper",
        "a2",
    ]);
    assert_eq!(code(&output), 2);
}

#[test]
fn plan_that_does_not_resolve_exits_1_and_writes_nothing() {
    let out = out_path("pdf-b.pdf");
    let _ = std::fs::remove_file(&out);
    let output = plan(&["pdf", &fixture("lgh154-b.plan"), "-o", &out]);
    assert_eq!(code(&output), 1);
    assert!(stdout(&output).contains("E003"));
    assert!(!std::path::Path::new(&out).exists());
}
