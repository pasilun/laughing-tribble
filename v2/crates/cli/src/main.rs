//! `plan`: command-line interface for Planstudio.

#![forbid(unsafe_code)]

use std::process::ExitCode;

fn main() -> ExitCode {
    println!("plan {}", env!("CARGO_PKG_VERSION"));
    ExitCode::SUCCESS
}
