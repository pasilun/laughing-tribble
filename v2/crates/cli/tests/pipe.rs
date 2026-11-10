//! A closed stdout pipe ends `plan` quietly, without a panic (spec §12, W3-11).

use std::io::Read;
use std::process::{Command, Stdio};

#[test]
fn closed_pipe_does_not_panic() {
    let mut child = Command::new(env!("CARGO_BIN_EXE_plan"))
        .args(["solve", "--json", "../../fixtures/lgh154-a.plan"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("run plan");
    // Close the read end at once, as `| head` does.
    drop(child.stdout.take());
    let mut stderr = String::new();
    if let Some(mut pipe) = child.stderr.take() {
        pipe.read_to_string(&mut stderr).expect("read stderr");
    }
    child.wait().expect("wait for plan");
    assert!(!stderr.contains("panicked"), "stderr: {stderr}");
}
