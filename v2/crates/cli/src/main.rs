//! `plan`: command-line interface for Planstudio.
//!
//! Commands (arguments are read by hand, no argument crate):
//! - `plan check <file>`: print the diagnostics, one per line; exit 1 if any is an Error.
//! - `plan review <file>`: print the permit review (W030–W033, I030, I031), one per line,
//!   or `Nothing to report.`; exit 1 if the plan does not load.
//! - `plan solve --json <file>`: print the §7.7 solve value as pretty JSON.
//! - `plan fmt <file> [--write]`: print the canonical DSL, or rewrite the file.
//! - `plan svg <file> [--out path]`: print the SVG drawing (or write it to `path`);
//!   if the plan does not resolve, print the diagnostics and exit 1.
//! - `plan suggest <file>`: print each W001 (loose room) with its suggested
//!   measurement, one per line.
//! - `plan png <file> -o <out.png> [--view plan|labels] [--max-tokens N]
//!   [--region ID | --rect x,y,w,h] [--diff BEFORE]`: write the PNG and print its viewport
//!   as JSON (with `--diff`, the plan view of the file with the differences from BEFORE
//!   drawn on top, and a `diff` object of counts).
//! - `plan pdf <file> -o <out.pdf> [--paper a4|a3] [--scale N] [--title TEXT] [--date TEXT] [--lang en|sv] [--no-dims] [--phase all|before|after]`:
//!   write the sheet as a PDF and print its paper, scale and byte count as JSON.
//!   `--phase before|after` draws the building before or after the works (spec §15 D43).
//! - `plan --version`.
//!
//! Exit status: 0 on success, 1 when the plan has an Error (or does not parse),
//! 2 for a usage or file error.

#![forbid(unsafe_code)]

use std::fs;
use std::path::Path;
use std::process::ExitCode;

use plan_core::solve::components::suggested_w001;
use plan_core::solve::{edges, unmeasured};
use plan_core::{Diagnostic, Resolved, Severity, dsl, load, solve_json};
use plan_render::phase::sheet_title;
use plan_render::viewport::DEFAULT_TOKENS;
use plan_render::{Lang, Paper, PhaseView, Region, RenderOptions, SheetOptions, View, phase_view};

const USAGE: &str = "usage:
  plan check <file>
  plan review <file>
  plan suggest <file>
  plan solve --json <file>
  plan fmt <file> [--write]
  plan svg <file> [--out path]
  plan png <file> -o <out.png> [--view plan|labels] [--max-tokens N] [--region ID | --rect x,y,w,h] [--diff BEFORE]
  plan pdf <file> -o <out.pdf> [--paper a4|a3] [--scale N] [--title TEXT] [--date TEXT] [--lang en|sv] [--no-dims] [--phase all|before|after]
  plan --version";

/// Usage line of `plan png`, printed on its own to stderr (exit 2).
const PNG_USAGE: &str = "usage: plan png FILE -o OUT.png [--view plan|labels] [--max-tokens N] [--region ID | --rect x,y,w,h] [--diff BEFORE]";

/// Usage line of `plan pdf`, printed on its own to stderr (exit 2).
const PDF_USAGE: &str = "usage: plan pdf FILE -o OUT.pdf [--paper a4|a3] [--scale N] [--title TEXT] [--date TEXT] [--lang en|sv] [--no-dims] [--phase all|before|after]";

/// Write a line to stdout. A closed pipe ends the program quietly with exit 0.
fn out(text: &str) {
    use std::io::Write;
    let mut stdout = std::io::stdout().lock();
    match writeln!(stdout, "{text}") {
        Err(e) if e.kind() == std::io::ErrorKind::BrokenPipe => std::process::exit(0),
        _ => {}
    }
}

/// Write text to stdout without a newline. A closed pipe ends the program quietly with exit 0.
fn out_text(text: &str) {
    use std::io::Write;
    let mut stdout = std::io::stdout().lock();
    match write!(stdout, "{text}") {
        Err(e) if e.kind() == std::io::ErrorKind::BrokenPipe => std::process::exit(0),
        _ => {}
    }
}

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
        ["review", file] => review(file),
        ["suggest", file] => suggest(file),
        ["solve", "--json", file] => solve(file),
        ["fmt", file] => fmt(file, false),
        ["fmt", file, "--write"] => fmt(file, true),
        ["svg", file] => svg(file, None),
        ["svg", file, "--out", out] => svg(file, Some(out)),
        ["png", rest @ ..] => png_command(rest),
        ["pdf", rest @ ..] => pdf_command(rest),
        ["--version"] => {
            out(&format!("plan {}", env!("CARGO_PKG_VERSION")));
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
        out(&describe(diagnostic));
    }
    Ok(exit_for(&diagnostics))
}

/// `plan review`: print the permit review of the plan, one finding per line, or
/// `Nothing to report.`. A plan that does not load prints its diagnostics as `check`
/// does and exits 1. Findings are advice, so they do not change the exit status.
fn review(file: &str) -> Result<ExitCode, String> {
    let (_, src) = read_source(file)?;
    let (text, code) = review_report(&src);
    out_text(&text);
    Ok(ExitCode::from(code))
}

/// The text `plan review` prints for `src`, and its exit status (0 or 1).
fn review_report(src: &str) -> (String, u8) {
    let loaded = match load(src) {
        Ok(loaded) => loaded,
        Err(diagnostics) => return (diagnostics_text(&diagnostics), 1),
    };
    let Some(resolved) = &loaded.resolved else {
        return (diagnostics_text(&loaded.diagnostics), 1);
    };
    if loaded
        .diagnostics
        .iter()
        .any(|diagnostic| diagnostic.severity == Severity::Error)
    {
        return (diagnostics_text(&loaded.diagnostics), 1);
    }
    let findings = plan_core::review(&loaded.plan, resolved);
    if findings.is_empty() {
        return ("Nothing to report.\n".to_string(), 0);
    }
    (diagnostics_text(&findings), 0)
}

/// Each diagnostic as `check` prints it, one per line, each ending in a newline.
fn diagnostics_text(diagnostics: &[Diagnostic]) -> String {
    diagnostics
        .iter()
        .map(|diagnostic| format!("{}\n", describe(diagnostic)))
        .collect()
}

/// `plan suggest`: print the numbered list of suggested measurements (every W001,
/// then every I020), or `No suggestions.`. A plan that does not load prints its
/// diagnostics as `check` does and exits 1.
fn suggest(file: &str) -> Result<ExitCode, String> {
    let (_, src) = read_source(file)?;
    let (text, code) = suggest_report(&src);
    out_text(&text);
    Ok(ExitCode::from(code))
}

/// The text `plan suggest` prints for `src`, and its exit status (0 or 1).
fn suggest_report(src: &str) -> (String, u8) {
    let loaded = match load(src) {
        Ok(loaded) => loaded,
        Err(diagnostics) => {
            let text: String = diagnostics
                .iter()
                .map(|diagnostic| format!("{}\n", describe(diagnostic)))
                .collect();
            return (text, 1);
        }
    };
    let plan = &loaded.plan;
    let (all_edges, _) = edges(plan);
    let mut list = suggested_w001(&all_edges, plan);
    list.extend(unmeasured(plan));
    if list.is_empty() {
        return ("No suggestions.\n".to_string(), 0);
    }
    let text: String = list
        .iter()
        .enumerate()
        .map(|(index, diagnostic)| {
            format!(
                "{}. {} {}\n",
                index + 1,
                diagnostic.code,
                diagnostic.message
            )
        })
        .collect();
    (text, 0)
}

/// `plan solve --json`: print the §7.7 value. The exit status is 0 even when the
/// plan does not resolve; the JSON says so in `resolved`.
fn solve(file: &str) -> Result<ExitCode, String> {
    let (stem, src) = read_source(file)?;
    let (resolved, diagnostics) = solve_source(&src);
    let value = solve_json(&stem, resolved.as_ref(), &diagnostics);
    // `{:#}` prints the value as pretty JSON, so serde_json need not be a direct dependency.
    out(&format!("{value:#}"));
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
        out_text(&text);
    }
    Ok(ExitCode::SUCCESS)
}

/// `plan svg`: draw the resolved plan, to stdout or to `dest`. An unresolved plan
/// prints its diagnostics and no image, and exits 1.
fn svg(file: &str, dest: Option<&str>) -> Result<ExitCode, String> {
    let (_, src) = read_source(file)?;
    let (resolved, diagnostics) = solve_source(&src);
    let Some(resolved) = resolved else {
        for diagnostic in &diagnostics {
            out(&describe(diagnostic));
        }
        return Ok(ExitCode::from(1));
    };
    let text = plan_render::plan_svg(&resolved);
    match dest {
        Some(path) => {
            fs::write(path, text).map_err(|error| format!("cannot write {path}: {error}"))?;
        }
        None => out_text(&text),
    }
    Ok(ExitCode::SUCCESS)
}

/// The arguments of `plan png`: the file, the output path and the render options.
struct PngArgs<'a> {
    file: &'a str,
    out: &'a str,
    view: View,
    max_tokens: u32,
    region: Option<Region>,
    diff: Option<&'a str>,
}

/// Parse `FILE -o OUT [--view V] [--max-tokens N] [--region ID | --rect x,y,w,h] [--diff BEFORE]`.
/// `None` is a usage error: a missing file or `-o`, an unknown option, a bad
/// value, or both `--region` and `--rect`.
fn png_args<'a>(words: &[&'a str]) -> Option<PngArgs<'a>> {
    let (&file, rest) = words.split_first()?;
    let mut out = None;
    let mut view = View::Labels;
    let mut max_tokens = DEFAULT_TOKENS;
    let mut region = None;
    let mut rect = None;
    let mut diff = None;
    for pair in rest.chunks(2) {
        let [flag, value] = pair else {
            return None;
        };
        match *flag {
            "-o" => out = Some(*value),
            "--view" => {
                view = match *value {
                    "plan" => View::Plan,
                    "labels" => View::Labels,
                    _ => return None,
                }
            }
            "--max-tokens" => max_tokens = value.parse().ok()?,
            "--region" => region = Some(Region::Id((*value).to_string())),
            "--rect" => rect = Some(Region::RectMm(parse_rect(value)?)),
            "--diff" => diff = Some(*value),
            _ => return None,
        }
    }
    if region.is_some() && rect.is_some() {
        return None;
    }
    Some(PngArgs {
        file,
        out: out?,
        view,
        max_tokens,
        region: region.or(rect),
        diff,
    })
}

/// `x,y,w,h` in integer mm.
fn parse_rect(text: &str) -> Option<[i64; 4]> {
    let mut parts = text.split(',').map(|part| part.parse::<i64>().ok());
    let rect = [
        parts.next()??,
        parts.next()??,
        parts.next()??,
        parts.next()??,
    ];
    parts.next().is_none().then_some(rect)
}

/// Resolve the file of `plan png`. Its Error diagnostics are printed when it does
/// not resolve, and `None` is returned.
fn png_resolve(file: &str) -> Result<Option<Resolved>, String> {
    let (_, src) = read_source(file)?;
    let (resolved, diagnostics) = solve_source(&src);
    if resolved.is_none() {
        for diagnostic in diagnostics
            .iter()
            .filter(|diagnostic| diagnostic.severity == Severity::Error)
        {
            out(&describe(diagnostic));
        }
    }
    Ok(resolved)
}

/// `plan png`: render the plan to `-o`, and print the viewport as one line of JSON.
/// A plan that does not resolve prints its Error diagnostics and exits 1; so does a
/// render that fails (an unknown region id). With `--diff BEFORE` the plan view is
/// drawn with the differences from BEFORE, and the JSON gains a `diff` object.
fn png_command(words: &[&str]) -> Result<ExitCode, String> {
    let Some(args) = png_args(words) else {
        eprintln!("{PNG_USAGE}");
        return Ok(ExitCode::from(2));
    };
    let Some(resolved) = png_resolve(args.file)? else {
        return Ok(ExitCode::from(1));
    };
    let before = match args.diff {
        Some(file) => match png_resolve(file)? {
            Some(before) => Some(before),
            None => return Ok(ExitCode::from(1)),
        },
        None => None,
    };
    let options = RenderOptions {
        view: if before.is_some() {
            View::Plan
        } else {
            args.view
        },
        region: args.region,
        max_tokens: args.max_tokens,
    };
    let rendered = match before {
        Some(before) => plan_render::render_diff(&before, &resolved, &options)
            .map(|(rendered, counts)| (rendered, Some(counts))),
        None => plan_render::render(&resolved, &options).map(|rendered| (rendered, None)),
    };
    let (rendered, counts) = match rendered {
        Ok(pair) => pair,
        Err(diagnostic) => {
            out(&describe(&diagnostic));
            return Ok(ExitCode::from(1));
        }
    };
    let bytes = match plan_render::png(&rendered) {
        Ok(bytes) => bytes,
        Err(diagnostic) => {
            out(&describe(&diagnostic));
            return Ok(ExitCode::from(1));
        }
    };
    fs::write(args.out, bytes).map_err(|error| format!("cannot write {}: {error}", args.out))?;
    // The viewport's own JSON (fields in struct order), with `diff` appended.
    let mut line = serde_json::to_string(&rendered.viewport).map_err(|error| error.to_string())?;
    if let Some(counts) = counts {
        let diff = serde_json::to_string(&counts).map_err(|error| error.to_string())?;
        line.pop();
        line.push_str(&format!(r#","diff":{diff}}}"#));
    }
    out(&line);
    Ok(ExitCode::SUCCESS)
}

/// The arguments of `plan pdf`: the file, the output path and the sheet options.
struct PdfArgs<'a> {
    file: &'a str,
    out: &'a str,
    paper: Paper,
    scale: Option<u32>,
    title: Option<&'a str>,
    date: Option<&'a str>,
    lang: Lang,
    dims: bool,
    view: PhaseView,
}

/// Parse `FILE -o OUT [--paper a4|a3] [--scale N] [--title TEXT] [--date TEXT] [--lang en|sv] [--no-dims] [--phase all|before|after]`.
/// `None` is a usage error: a missing file or `-o`, an unknown option, a missing
/// value, an unknown paper, language or phase, or a scale that is not a positive integer.
fn pdf_args<'a>(words: &[&'a str]) -> Option<PdfArgs<'a>> {
    let (&file, rest) = words.split_first()?;
    let mut out = None;
    let mut paper = Paper::A3;
    let mut scale = None;
    let mut title = None;
    let mut date = None;
    let mut lang = Lang::En;
    let mut dims = true;
    let mut view = PhaseView::All;
    let mut rest = rest;
    while let Some((&flag, after)) = rest.split_first() {
        if flag == "--no-dims" {
            dims = false;
            rest = after;
            continue;
        }
        let (&value, after) = after.split_first()?;
        rest = after;
        match flag {
            "-o" => out = Some(value),
            "--paper" => {
                paper = match value {
                    "a4" => Paper::A4,
                    "a3" => Paper::A3,
                    _ => return None,
                }
            }
            "--scale" => {
                scale = Some(value.parse::<u32>().ok().filter(|n| *n > 0)?);
            }
            "--title" => title = Some(value),
            "--date" => date = Some(value),
            "--lang" => {
                lang = match value {
                    "en" => Lang::En,
                    "sv" => Lang::Sv,
                    _ => return None,
                }
            }
            "--phase" => {
                view = match value {
                    "all" => PhaseView::All,
                    "before" => PhaseView::Before,
                    "after" => PhaseView::After,
                    _ => return None,
                }
            }
            _ => return None,
        }
    }
    Some(PdfArgs {
        file,
        out: out?,
        paper,
        scale,
        title,
        date,
        lang,
        dims,
        view,
    })
}

/// Print every diagnostic as `check` does, and return exit status 1.
fn print_unresolved(diagnostics: &[Diagnostic]) -> ExitCode {
    for diagnostic in diagnostics {
        out(&describe(diagnostic));
    }
    ExitCode::from(1)
}

/// `plan pdf`: draw the plan on a sheet and write it as a PDF to `-o`. Prints
/// `{"paper":"a3","scale":25,"bytes":N}`. A plan that does not resolve prints its
/// diagnostics and exits 1; so does a sheet or PDF diagnostic (E018, E012), and
/// then nothing is written.
fn pdf_command(words: &[&str]) -> Result<ExitCode, String> {
    let Some(args) = pdf_args(words) else {
        eprintln!("{PDF_USAGE}");
        return Ok(ExitCode::from(2));
    };
    let (_, src) = read_source(args.file)?;
    let loaded = match load(&src) {
        Ok(loaded) => loaded,
        Err(diagnostics) => return Ok(print_unresolved(&diagnostics)),
    };
    let Some(resolved) = &loaded.resolved else {
        return Ok(print_unresolved(&loaded.diagnostics));
    };
    let resolved = phase_view(resolved, args.view);
    let opts = SheetOptions {
        paper: args.paper,
        scale: args.scale,
        title: sheet_title(
            &args
                .title
                .map_or_else(|| loaded.plan.name.clone(), str::to_string),
            args.view,
            args.lang,
        ),
        date: args.date.map(str::to_string),
        lang: args.lang,
        block: loaded.plan.title.clone(),
        dims: args.dims,
    };
    let sheet = match plan_render::sheet(&resolved, &opts) {
        Ok(sheet) => sheet,
        Err(diagnostic) => {
            out(&describe(&diagnostic));
            return Ok(ExitCode::from(1));
        }
    };
    let bytes = match plan_render::pdf(&sheet) {
        Ok(bytes) => bytes,
        Err(diagnostic) => {
            out(&describe(&diagnostic));
            return Ok(ExitCode::from(1));
        }
    };
    fs::write(args.out, &bytes).map_err(|error| format!("cannot write {}: {error}", args.out))?;
    out(&format!(
        "{{\"paper\":\"{}\",\"scale\":{},\"bytes\":{}}}",
        sheet.paper.name().to_ascii_lowercase(),
        sheet.scale,
        bytes.len()
    ));
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

    /// Test plan 1 of W2-09: a loose room with two laser rooms.
    const LOOSE_ROOM: &str = "room Hall 1000 x 2000 source laser
room Förråd 800 x 2000 source laser
  align north Hall
";

    #[test]
    fn suggest_fixture_a() {
        insta::assert_snapshot!("suggest_fixture_a", suggest_report(FIXTURE_A).0);
    }

    #[test]
    fn suggest_loose_room() {
        insta::assert_snapshot!("suggest_loose_room", suggest_report(LOOSE_ROOM).0);
    }

    #[test]
    fn suggest_unparseable_plan_exits_1() {
        assert_eq!(suggest_report("room A 3000 * 2000").1, 1);
    }

    const REVIEW_1: &str = include_str!("../../../fixtures/review-1.plan");

    #[test]
    fn review_review_1() {
        insta::assert_snapshot!("review_review_1", review_report(REVIEW_1).0);
    }

    #[test]
    fn review_fixture_a_lists_the_title_block() {
        let title = |key: &str| {
            format!("I031 info Title block has no {key}; add: title {key} \"\u{2026}\"\n")
        };
        let expected = [
            title("property"),
            title("drawing"),
            title("applicant"),
            title("date"),
        ]
        .concat();
        assert_eq!(review_report(FIXTURE_A), (expected, 0));
    }

    #[test]
    fn pdf_phase_flag_parses() {
        let args = pdf_args(&["plan.plan", "-o", "x.pdf", "--phase", "after"]).expect("parses");
        assert_eq!(args.view, PhaseView::After);
        let args = pdf_args(&["plan.plan", "-o", "x.pdf"]).expect("parses");
        assert_eq!(args.view, PhaseView::All);
        assert!(pdf_args(&["plan.plan", "-o", "x.pdf", "--phase", "sideways"]).is_none());
    }

    #[test]
    fn pdf_phase_after_writes_a_pdf_and_exits_0() {
        let out_path =
            std::env::temp_dir().join(format!("plan-cli-phase-after-{}.pdf", std::process::id()));
        let out_str = out_path.to_string_lossy().to_string();
        let fixture = concat!(env!("CARGO_MANIFEST_DIR"), "/../../fixtures/review-1.plan");
        let code =
            pdf_command(&[fixture, "-o", out_str.as_str(), "--phase", "after"]).expect("runs");
        assert_eq!(code, ExitCode::SUCCESS);
        let bytes = fs::read(&out_path).expect("pdf written");
        assert!(bytes.starts_with(b"%PDF-"));
        let _ = fs::remove_file(&out_path);
    }

    #[test]
    fn pdf_phase_sideways_exits_2() {
        let code = pdf_command(&["plan.plan", "-o", "x.pdf", "--phase", "sideways"]).expect("runs");
        assert_eq!(code, ExitCode::from(2));
    }

    #[test]
    fn sheet_title_before_sv_ends_with_fore() {
        let title = sheet_title("Lgh 154", PhaseView::Before, Lang::Sv);
        assert!(title.ends_with(" – före"), "{title}");
    }

    #[test]
    fn review_fixture_b_prints_e003_and_exits_1() {
        let (text, code) = review_report(FIXTURE_B);
        assert_eq!(code, 1);
        assert!(
            text.starts_with("E003 error Conflict on the north–south axis"),
            "{text}"
        );
    }
}
