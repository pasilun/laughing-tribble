//! `plan`: command-line interface for Planstudio.
//!
//! Commands (arguments are read by hand, no argument crate):
//! - `plan check <file>`: print the diagnostics, one per line; exit 1 if any is an Error.
//! - `plan solve --json <file>`: print the §7.7 solve value as pretty JSON.
//! - `plan fmt <file> [--write]`: print the canonical DSL, or rewrite the file.
//! - `plan svg <file> [--out path]`: print the SVG drawing (or write it to `path`);
//!   if the plan does not resolve, print the diagnostics and exit 1.
//! - `plan suggest <file>`: print each W001 (loose room) with its suggested
//!   measurement, one per line.
//! - `plan --version`.
//!
//! Exit status: 0 on success, 1 when the plan has an Error (or does not parse),
//! 2 for a usage or file error.

#![forbid(unsafe_code)]

use std::fs;
use std::path::Path;
use std::process::ExitCode;

use plan_core::solve::components::suggested_w001;
use plan_core::solve::edges;
use plan_core::{Diagnostic, Resolved, Severity, dsl, load, solve_json};

const USAGE: &str = "usage:
  plan check <file>
  plan suggest <file>
  plan solve --json <file>
  plan fmt <file> [--write]
  plan svg <file> [--out path]
  plan --version";

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let words: Vec<&str> = args.iter().map(String::as_str).collect();
    match run(&words) {
        Ok(code) => code,
        Err(message) => {
            eprintln!("plan: {message}");
            ExitCode::from(2)
        }
    }
}

/// Dispatch on the arguments. `Err` is a usage or file error (exit 2).
fn run(words: &[&str]) -> Result<ExitCode, String> {
    match words {
        ["check", file] => check(file),
        ["suggest", file] => suggest(file),
        ["solve", "--json", file] => solve(file),
        ["fmt", file] => fmt(file, false),
        ["fmt", file, "--write"] => fmt(file, true),
        ["svg", file] => svg(file, None),
        ["svg", file, "--out", out] => svg(file, Some(out)),
        ["--version"] => {
            println!("plan {}", env!("CARGO_PKG_VERSION"));
            Ok(ExitCode::SUCCESS)
        }
        _ => Err(format!("unknown command\n{USAGE}")),
    }
}

/// `plan check`: resolve the file and print its diagnostics. Writes nothing.
fn check(file: &str) -> Result<ExitCode, String> {
    let (_, src) = read_source(file)?;
    let (_, diagnostics) = solve_source(&src);
    for diagnostic in &diagnostics {
        println!("{}", describe(diagnostic));
    }
    Ok(exit_for(&diagnostics))
}

/// `plan suggest`: print each W001 with its suggested measurement, one per line.
/// A parse error is printed and exits 1, as in `check`.
fn suggest(file: &str) -> Result<ExitCode, String> {
    let (_, src) = read_source(file)?;
    let plan = match dsl::parse(&src) {
        Ok(plan) => plan,
        Err(diagnostic) => {
            println!("{}", describe(&diagnostic));
            return Ok(ExitCode::from(1));
        }
    };
    let (all_edges, _) = edges(&plan);
    for diagnostic in suggested_w001(&all_edges, &plan) {
        println!("{}", describe(&diagnostic));
    }
    Ok(ExitCode::SUCCESS)
}

/// `plan solve --json`: print the §7.7 value. The exit status is 0 even when the
/// plan does not resolve; the JSON says so in `resolved`.
fn solve(file: &str) -> Result<ExitCode, String> {
    let (stem, src) = read_source(file)?;
    let (resolved, diagnostics) = solve_source(&src);
    let value = solve_json(&stem, resolved.as_ref(), &diagnostics);
    // `{:#}` prints the value as pretty JSON, so serde_json need not be a direct dependency.
    println!("{value:#}");
    Ok(ExitCode::SUCCESS)
}

/// `plan fmt`: print the canonical DSL, or rewrite the file with `--write`.
fn fmt(file: &str, write: bool) -> Result<ExitCode, String> {
    let (_, src) = read_source(file)?;
    let plan = match dsl::parse(&src) {
        Ok(plan) => plan,
        Err(diagnostic) => {
            eprintln!("{}", describe(&diagnostic));
            return Ok(ExitCode::from(1));
        }
    };
    let text = dsl::print(&plan);
    if write {
        fs::write(file, text).map_err(|error| format!("cannot write {file}: {error}"))?;
    } else {
        print!("{text}");
    }
    Ok(ExitCode::SUCCESS)
}

/// `plan svg`: draw the resolved plan, to stdout or to `out`. An unresolved plan
/// prints its diagnostics and no image, and exits 1.
fn svg(file: &str, out: Option<&str>) -> Result<ExitCode, String> {
    let (_, src) = read_source(file)?;
    let (resolved, diagnostics) = solve_source(&src);
    let Some(resolved) = resolved else {
        for diagnostic in &diagnostics {
            println!("{}", describe(diagnostic));
        }
        return Ok(ExitCode::from(1));
    };
    let text = plan_render::plan_svg(&resolved);
    match out {
        Some(path) => {
            fs::write(path, text).map_err(|error| format!("cannot write {path}: {error}"))?;
        }
        None => print!("{text}"),
    }
    Ok(ExitCode::SUCCESS)
}

/// Parse and resolve DSL text. A parse error comes back as the only diagnostic.
fn solve_source(src: &str) -> (Option<Resolved>, Vec<Diagnostic>) {
    match load(src) {
        Ok(loaded) => (loaded.resolved, loaded.diagnostics),
        Err(diagnostics) => (None, diagnostics),
    }
}

/// The file's stem (used as the `fixture` key) and its text.
fn read_source(file: &str) -> Result<(String, String), String> {
    let src = fs::read_to_string(file).map_err(|error| format!("cannot read {file}: {error}"))?;
    let stem = Path::new(file)
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or("plan")
        .to_string();
    Ok((stem, src))
}

fn exit_for(diagnostics: &[Diagnostic]) -> ExitCode {
    if diagnostics.iter().any(|d| d.severity == Severity::Error) {
        ExitCode::from(1)
    } else {
        ExitCode::SUCCESS
    }
}

/// One line for a diagnostic: code, severity, message.
fn describe(diagnostic: &Diagnostic) -> String {
    format!(
        "{} {} {}",
        diagnostic.code,
        severity_word(diagnostic.severity),
        diagnostic.message
    )
}

fn severity_word(severity: Severity) -> &'static str {
    match severity {
        Severity::Error => "error",
        Severity::Warning => "warning",
        Severity::Info => "info",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURE_A: &str = include_str!("../../../fixtures/lgh154-a.plan");
    const FIXTURE_B: &str = include_str!("../../../fixtures/lgh154-b.plan");
    const FIXTURE_C: &str = include_str!("../../../fixtures/lgh154-c.plan");

    /// The `plan solve --json` text for a fixture.
    fn solve_text(src: &str, stem: &str) -> String {
        let (resolved, diagnostics) = solve_source(src);
        format!("{:#}", solve_json(stem, resolved.as_ref(), &diagnostics))
    }

    #[test]
    fn solve_json_fixture_a() {
        insta::assert_snapshot!("solve_lgh154_a", solve_text(FIXTURE_A, "lgh154-a"));
    }

    #[test]
    fn solve_json_fixture_b() {
        insta::assert_snapshot!("solve_lgh154_b", solve_text(FIXTURE_B, "lgh154-b"));
    }

    #[test]
    fn solve_json_fixture_c() {
        insta::assert_snapshot!("solve_lgh154_c", solve_text(FIXTURE_C, "lgh154-c"));
    }
}
