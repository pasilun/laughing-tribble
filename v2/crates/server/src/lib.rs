//! Planstudio MCP server (spec §11 Phase 4, D12, D13). Tool-level failures are
//! `CallToolResult::structured_error`; protocol errors are never used for them.

mod get;
mod next_steps;
mod store;

pub use store::Store;

use base64::Engine;
use plan_core::{Code, Diagnostic, Severity, message};
use plan_render::phase::sheet_title;
use plan_render::{
    Lang as SheetLang, Paper as SheetPaper, PhaseView, Region, RenderOptions, SheetOptions,
    View as PlanView, phase_view,
};
use rmcp::{
    ErrorData as McpError, ServerHandler,
    handler::server::{router::tool::ToolRouter, wrapper::Parameters},
    model::{CallToolResult, ContentBlock, Implementation, ServerCapabilities, ServerConfig},
    tool, tool_handler, tool_router,
};
use serde_json::json;

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct CheckArgs {
    /// The plan: a file name under the server's root, without `.plan`.
    pub plan_id: String,
}

#[derive(Debug, Default, serde::Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum GetView {
    #[default]
    Summary,
    Dsl,
    Json,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum Field {
    Rooms,
    Walls,
    Openings,
    Diagnostics,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct GetArgs {
    /// The plan: a file name under the server's root, without `.plan`.
    pub plan_id: String,
    /// summary (default): short text; dsl: the plan text; json: solved geometry.
    #[serde(default)]
    pub view: GetView,
    /// json view only: which parts to return; all when left out or empty.
    #[serde(default)]
    pub fields: Vec<Field>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct ApplyArgs {
    /// The plan: a file name under the server's root, without `.plan`. A new id creates the plan.
    pub plan_id: String,
    /// DSL statements to add or replace; a line starting with "- " removes the matching statement.
    pub patch: String,
    /// Compute everything and change nothing.
    #[serde(default)]
    pub dry_run: bool,
}

#[derive(Debug, Default, serde::Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum RenderView {
    Plan,
    #[default]
    Labels,
    Conflicts,
    Missing,
    Diff,
    Overlay,
}

impl RenderView {
    /// The view's name as the client writes it, for example `"conflicts"`.
    fn name(&self) -> &'static str {
        match self {
            RenderView::Plan => "plan",
            RenderView::Labels => "labels",
            RenderView::Conflicts => "conflicts",
            RenderView::Missing => "missing",
            RenderView::Diff => "diff",
            RenderView::Overlay => "overlay",
        }
    }
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
#[serde(untagged)]
pub enum RegionArg {
    /// Crop around one element: a room name, or a wall or opening id.
    Id { id: String },
    /// Crop to [x, y, w, h] in mm (x east, y south).
    Rect { rect_mm: [i64; 4] },
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct RenderArgs {
    /// The plan: a file name under the server's root, without `.plan`.
    pub plan_id: String,
    /// labels (default): every room, wall and opening labelled with its id; plan: room names only.
    #[serde(default)]
    pub view: RenderView,
    /// Optional crop. Leave out for the whole plan.
    #[serde(default)]
    pub region: Option<RegionArg>,
    /// Image token budget, at most 4784. Default 1600.
    #[serde(default = "default_tokens")]
    pub max_tokens: u32,
}

fn default_tokens() -> u32 {
    plan_render::viewport::DEFAULT_TOKENS
}

#[derive(Debug, Default, serde::Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum ExportFormat {
    #[default]
    Pdf,
}

#[derive(Debug, Default, serde::Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum ExportLang {
    #[default]
    En,
    Sv,
}

#[derive(Debug, Default, serde::Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum ExportPaper {
    A4,
    #[default]
    A3,
}

/// Which state of the works the sheet draws (spec §15 D43).
#[derive(Debug, Default, serde::Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum ExportPhase {
    /// The plan as it is.
    #[default]
    All,
    /// The building today: new walls and openings left out.
    Before,
    /// The finished building: demolished walls and openings left out.
    After,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct ExportArgs {
    /// The plan: a file name under the server's root, without `.plan`.
    pub plan_id: String,
    /// The file format. Only "pdf" for now; the default.
    #[serde(default)]
    pub format: ExportFormat,
    /// a3 (default) or a4; the sheet is always landscape.
    #[serde(default)]
    pub paper: ExportPaper,
    /// Scale denominator n of 1:n. Leave out for the first standard scale that fits.
    #[serde(default)]
    #[schemars(range(min = 1))]
    pub scale: Option<u32>,
    /// Text printed at the right of the title strip, for example "2026-11-10".
    #[serde(default)]
    pub date: Option<String>,
    /// The language of the printed words: "en" (default) or "sv".
    #[serde(default)]
    pub lang: ExportLang,
    /// Draw the dimension chains on the north and west sides (default true).
    /// Set false to leave them out and reserve no paper for them.
    #[serde(default = "default_dims")]
    pub dims: bool,
    /// "all" (default), "before" (the building today, new things left out) or
    /// "after" (the finished building, demolished things left out). The file is
    /// `<plan_id>.pdf`, `<plan_id>-before.pdf` or `<plan_id>-after.pdf`.
    #[serde(default)]
    pub phase: ExportPhase,
}

/// The default of `ExportArgs::dims`: the chains are drawn.
fn default_dims() -> bool {
    true
}

#[derive(Debug, Clone)]
pub struct PlanServer {
    store: Store,
    tool_router: ToolRouter<Self>,
}

#[tool_router(router = tool_router)]
impl PlanServer {
    pub fn new(store: Store) -> Self {
        Self {
            store,
            tool_router: Self::tool_router(),
        }
    }

    #[tool(name = "check", description = CHECK_DESCRIPTION, annotations(read_only_hint = true))]
    pub async fn check(
        &self,
        Parameters(args): Parameters<CheckArgs>,
    ) -> Result<CallToolResult, McpError> {
        Ok(tool_result(self.check_value(&args.plan_id)))
    }

    #[tool(name = "get", description = GET_DESCRIPTION, annotations(read_only_hint = true))]
    pub async fn get(
        &self,
        Parameters(args): Parameters<GetArgs>,
    ) -> Result<CallToolResult, McpError> {
        Ok(tool_result(self.get_value(&args)))
    }

    #[tool(name = "apply", description = APPLY_DESCRIPTION, annotations(read_only_hint = false, destructive_hint = true, idempotent_hint = true))]
    pub async fn apply(
        &self,
        Parameters(args): Parameters<ApplyArgs>,
    ) -> Result<CallToolResult, McpError> {
        Ok(tool_result(self.apply_value(&args)))
    }

    #[tool(name = "render", description = RENDER_DESCRIPTION, annotations(read_only_hint = true))]
    pub async fn render(
        &self,
        Parameters(args): Parameters<RenderArgs>,
    ) -> Result<CallToolResult, McpError> {
        Ok(self
            .render_value(&args)
            .unwrap_or_else(|ds| CallToolResult::structured_error(json!({ "diagnostics": ds }))))
    }

    #[tool(name = "export", description = EXPORT_DESCRIPTION, annotations(read_only_hint = false, idempotent_hint = true))]
    pub async fn export(
        &self,
        Parameters(args): Parameters<ExportArgs>,
    ) -> Result<CallToolResult, McpError> {
        Ok(tool_result(self.export_value(&args)))
    }

    /// Tool errors (`Err`) are E020 and E021 (unknown or bad id), the plan errors of
    /// `load` (E006, E001, E002, E003 and so on, when the plan does not resolve),
    /// E018 (the plan does not fit the sheet) and E012 (PDF failed), E023 (write failed).
    fn export_value(&self, args: &ExportArgs) -> Result<serde_json::Value, Vec<Diagnostic>> {
        let ext = match args.format {
            ExportFormat::Pdf => "pdf",
        };
        let text = self.store.load(&args.plan_id).map_err(|d| vec![d])?;
        let loaded = plan_core::load(&text)?;
        let Some(resolved) = loaded.resolved else {
            return Err(loaded
                .diagnostics
                .into_iter()
                .filter(|d| matches!(d.severity, Severity::Error))
                .collect());
        };

        let paper = match args.paper {
            ExportPaper::A4 => SheetPaper::A4,
            ExportPaper::A3 => SheetPaper::A3,
        };
        let (view, file_stem) = match args.phase {
            ExportPhase::All => (PhaseView::All, args.plan_id.clone()),
            ExportPhase::Before => (PhaseView::Before, format!("{}-before", args.plan_id)),
            ExportPhase::After => (PhaseView::After, format!("{}-after", args.plan_id)),
        };
        let lang = match args.lang {
            ExportLang::En => SheetLang::En,
            ExportLang::Sv => SheetLang::Sv,
        };
        let resolved = phase_view(&resolved, view);
        let opts = SheetOptions {
            paper,
            scale: args.scale,
            title: sheet_title(&loaded.plan.name, view, lang),
            date: args.date.clone(),
            lang,
            block: loaded.plan.title.clone(),
            dims: args.dims,
        };
        let sheet = plan_render::sheet(&resolved, &opts).map_err(|d| vec![d])?;
        let bytes = plan_render::pdf(&sheet).map_err(|d| vec![d])?;
        let path = self
            .store
            .write_export(&file_stem, ext, &bytes)
            .map_err(|d| vec![d])?;

        Ok(json!({
            "path": path.to_string_lossy(),
            "paper": sheet.paper.name().to_lowercase(),
            "scale": sheet.scale,
            "bytes": bytes.len(),
        }))
    }

    /// Tool errors (`Err`) are E022 (view not yet drawn), the plan errors of
    /// `check` (E020, E021, E006, E003 and so on, when the plan does not resolve)
    /// and render errors (E011, E012).
    fn render_value(&self, args: &RenderArgs) -> Result<CallToolResult, Vec<Diagnostic>> {
        let view = match args.view {
            RenderView::Plan => PlanView::Plan,
            RenderView::Labels => PlanView::Labels,
            _ => return Err(vec![e022(&args.view)]),
        };
        let text = self.store.load(&args.plan_id).map_err(|d| vec![d])?;
        let loaded = plan_core::load(&text)?;
        let Some(resolved) = loaded.resolved else {
            let errors = loaded
                .diagnostics
                .into_iter()
                .filter(|d| matches!(d.severity, Severity::Error))
                .collect();
            return Err(errors);
        };

        let opts = RenderOptions {
            view,
            region: args.region.as_ref().map(|r| match r {
                RegionArg::Id { id } => Region::Id(id.clone()),
                RegionArg::Rect { rect_mm } => Region::RectMm(*rect_mm),
            }),
            max_tokens: args.max_tokens,
        };
        let rendered = plan_render::render(&resolved, &opts).map_err(|d| vec![d])?;
        let bytes = plan_render::png(&rendered).map_err(|d| vec![d])?;

        let vp = rendered.viewport;
        let labels: Vec<serde_json::Value> = rendered
            .labels
            .iter()
            .map(|l| json!({ "id": l.id, "center_px": l.center_px }))
            .collect();
        let meta = json!({
            "plan_id": args.plan_id,
            "view": args.view.name(),
            "mm_per_px": vp.mm_per_px,
            "origin_mm": vp.origin_mm,
            "size_px": vp.size_px,
            "tokens": vp.tokens,
            "labels": labels,
        });
        let data = base64::engine::general_purpose::STANDARD.encode(&bytes);
        let mut result = CallToolResult::success(vec![
            ContentBlock::image(data, "image/png"),
            ContentBlock::text(meta.to_string()),
        ]);
        result.structured_content = Some(meta);
        Ok(result)
    }

    /// Tool errors (`Err`) are E021, E023 and E006 (a stored file that does not parse).
    /// A patch that does not apply is `Ok` with `ok: false`.
    fn apply_value(&self, args: &ApplyArgs) -> Result<serde_json::Value, Vec<Diagnostic>> {
        let plan_id = args.plan_id.as_str();
        self.store.path(plan_id).map_err(|d| vec![d])?;
        let text = match self.store.load(plan_id) {
            Ok(text) => text,
            Err(d) if d.code == Code::E020 => format!("plan \"{plan_id}\"\n"),
            Err(d) => return Err(vec![d]),
        };
        let plan = plan_core::dsl::parse(&text).map_err(|d| vec![d])?;
        let result = plan_core::apply(&plan, &args.patch, args.dry_run);

        let mut saved = false;
        if let Some(new_plan) = result.plan.as_ref().filter(|_| result.ok && !args.dry_run) {
            self.store
                .save(plan_id, &plan_core::dsl::print(new_plan))
                .map_err(|d| vec![d])?;
            saved = true;
        }

        let n = result.diff.len();
        let errors = result
            .diagnostics
            .iter()
            .filter(|d| matches!(d.severity, Severity::Error))
            .count();
        let summary = if !result.ok {
            format!("Not applied: {errors} error(s). The plan is unchanged.")
        } else if args.dry_run {
            format!("Dry run: {n} change(s) would be applied; nothing saved.")
        } else {
            format!("Applied {n} change(s); saved.")
        };
        Ok(json!({
            "plan_id": plan_id,
            "ok": result.ok,
            "dry_run": args.dry_run,
            "saved": saved,
            "diff": result.diff,
            "diagnostics": result.diagnostics,
            "summary": summary,
        }))
    }

    fn get_value(&self, args: &GetArgs) -> Result<serde_json::Value, Vec<Diagnostic>> {
        let text = self.store.load(&args.plan_id).map_err(|d| vec![d])?;
        get::view_value(&args.view, &args.plan_id, &text, &args.fields)
    }

    fn check_value(&self, plan_id: &str) -> Result<serde_json::Value, Vec<Diagnostic>> {
        let text = self.store.load(plan_id).map_err(|d| vec![d])?;
        match plan_core::load(&text) {
            // A plan with parse errors is still checkable.
            Err(ds) => {
                let steps = next_steps::next_steps(None, &ds);
                Ok(json!({
                    "plan_id": plan_id,
                    "resolved": false,
                    "diagnostics": ds,
                    "review": [],
                    "next_steps": steps,
                }))
            }
            Ok(r) => {
                // The permit review needs a resolved plan (D35); otherwise it is empty.
                let review = r
                    .resolved
                    .as_ref()
                    .map(|resolved| plan_core::review(&r.plan, resolved))
                    .unwrap_or_default();
                // I031 adds no step (W3-23), so the steps ignore it.
                let step_review: Vec<Diagnostic> = review
                    .iter()
                    .filter(|d| d.code != Code::I031)
                    .cloned()
                    .collect();
                let steps =
                    next_steps::next_steps_with_review(Some(&r.plan), &r.diagnostics, &step_review);
                Ok(json!({
                    "plan_id": plan_id,
                    "resolved": r.resolved.is_some(),
                    "diagnostics": r.diagnostics,
                    "review": review,
                    "next_steps": steps,
                }))
            }
        }
    }
}

/// E022 for a view that is accepted by the schema but not drawn yet (D17).
fn e022(view: &RenderView) -> Diagnostic {
    let name = view.name();
    Diagnostic {
        code: Code::E022,
        severity: Severity::Error,
        message: message(Code::E022, &[("view", name.to_string())]),
        span: None,
        refs: Vec::new(),
        data: json!({ "view": name }),
    }
}

fn tool_result(v: Result<serde_json::Value, Vec<Diagnostic>>) -> CallToolResult {
    match v {
        Ok(v) => CallToolResult::structured(v),
        Err(ds) => CallToolResult::structured_error(json!({ "diagnostics": ds })),
    }
}

#[tool_handler(router = self.tool_router)]
impl ServerHandler for PlanServer {
    fn get_info(&self) -> ServerConfig {
        let mut info = ServerConfig::new(ServerCapabilities::builder().enable_tools().build());
        info.server_info = Implementation::new("planstudio", env!("CARGO_PKG_VERSION"));
        info.instructions = Some(INSTRUCTIONS.to_string());
        info
    }
}

pub const INSTRUCTIONS: &str = "Planstudio keeps floor plans as text (a small DSL of rooms, relations, measurements and openings). Every number comes from the kernel or a laser reading, never from pixels. Working order: check, then get (view dsl) to read the plan, then apply a DSL patch (dry_run first if unsure), then check again. Use render only when you need to see the layout; refer to elements by the ids printed on the render.";

pub const CHECK_DESCRIPTION: &str = "Check a plan. Returns every diagnostic (errors, warnings, info) and what to do next. \"review\" lists what a permit application will need (load-bearing or fire-rated walls that are demolished or opened).";

pub const GET_DESCRIPTION: &str = "Read a plan: summary (default), dsl (the plan text, to edit with apply) or json (solved faces, walls, openings, diagnostics).";

pub const RENDER_DESCRIPTION: &str = "Draw a plan as a PNG sized for you, with ids on every element. Use it to judge the layout, not to measure: numbers come from get and check. Crop with region (an id or a mm rectangle) to see detail.";

pub const EXPORT_DESCRIPTION: &str = "Write a print-ready PDF sheet of the plan (A4 or A3, standard scale, title strip). Returns the file path, paper and scale. The plan must be free of errors; run check first.";

pub const APPLY_DESCRIPTION: &str = "Change a plan with a DSL patch. All or nothing: if any error results, nothing changes. Statements replace the statement with the same key (room by name, relation by subject, kind and room, measure by its faces, opening by face and position). Use dry_run to preview.";

#[cfg(test)]
mod tests {
    use super::*;
    use rmcp::handler::server::wrapper::Parameters;
    use std::fs;
    use std::path::PathBuf;

    const FIXTURE_A: &str = include_str!("../../../fixtures/lgh154-a.plan");
    const FIXTURE_B: &str = include_str!("../../../fixtures/lgh154-b.plan");
    const REVIEW_1: &str = include_str!("../../../fixtures/review-1.plan");

    /// A fresh directory holding the given plans as `<id>.plan`.
    fn fixture_root(name: &str, plans: &[(&str, &str)]) -> PathBuf {
        // CARGO_TARGET_TMPDIR is not set for lib unit tests, so use the OS temp dir.
        let dir = std::env::temp_dir().join("plan-server-tests").join(name);
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("create test dir");
        for (id, text) in plans {
            fs::write(dir.join(format!("{id}.plan")), text).expect("write fixture");
        }
        dir
    }

    fn server(name: &str) -> PlanServer {
        let root = fixture_root(name, &[("lgh154-a", FIXTURE_A), ("lgh154-b", FIXTURE_B)]);
        PlanServer::new(Store::new(root))
    }

    fn check_args(plan_id: &str) -> Parameters<CheckArgs> {
        Parameters(CheckArgs {
            plan_id: plan_id.into(),
        })
    }

    fn codes(structured: &serde_json::Value) -> Vec<String> {
        structured["diagnostics"]
            .as_array()
            .expect("diagnostics array")
            .iter()
            .map(|d| d["code"].as_str().expect("code string").to_string())
            .collect()
    }

    #[tokio::test]
    async fn check_fixture_a() {
        let result = server("check_a")
            .check(check_args("lgh154-a"))
            .await
            .expect("protocol ok");
        assert_eq!(result.is_error, Some(false));
        let s = result.structured_content.expect("structured content");
        assert_eq!(s["resolved"], true);
        let mut got = codes(&s);
        got.sort();
        assert_eq!(got, ["I010", "I010", "W003"]);
    }

    #[tokio::test]
    async fn check_fixture_b() {
        let result = server("check_b")
            .check(check_args("lgh154-b"))
            .await
            .expect("protocol ok");
        let s = result.structured_content.expect("structured content");
        assert_eq!(s["resolved"], false);
        assert_eq!(codes(&s), ["E003"]);
    }

    #[tokio::test]
    async fn check_fixture_a_next_steps() {
        let result = server("check_a_steps")
            .check(check_args("lgh154-a"))
            .await
            .expect("protocol ok");
        let s = result.structured_content.expect("structured content");
        let steps: Vec<&str> = s["next_steps"]
            .as_array()
            .expect("next_steps array")
            .iter()
            .map(|v| v.as_str().expect("step string"))
            .collect();
        assert_eq!(steps.len(), 4, "{steps:?}");
        assert!(steps[0].starts_with("Ask the user: Facade not straight:"));
        assert!(steps[1].starts_with("Optional: Gap Hall east_of Garderob 121 mm"));
    }

    /// A server whose store also holds `review-1` (permit review findings).
    fn review_server(name: &str) -> PlanServer {
        let root = fixture_root(
            name,
            &[
                ("lgh154-a", FIXTURE_A),
                ("lgh154-b", FIXTURE_B),
                ("review-1", REVIEW_1),
            ],
        );
        PlanServer::new(Store::new(root))
    }

    /// The codes of the `review` entries in a check result, in order.
    fn review_codes(s: &serde_json::Value) -> Vec<&str> {
        s["review"]
            .as_array()
            .expect("review array")
            .iter()
            .map(|d| d["code"].as_str().expect("code string"))
            .collect()
    }

    fn structured_steps(s: &serde_json::Value) -> Vec<String> {
        s["next_steps"]
            .as_array()
            .expect("next_steps array")
            .iter()
            .map(|v| v.as_str().expect("step string").to_string())
            .collect()
    }

    #[tokio::test]
    async fn check_review_1_review_and_steps() {
        let result = review_server("check_review_1")
            .check(check_args("review-1"))
            .await
            .expect("protocol ok");
        assert_eq!(result.is_error, Some(false));
        let s = result.structured_content.expect("structured content");
        assert_eq!(
            review_codes(&s),
            [
                "W030", "W031", "W032", "I030", "I031", "I031", "I031", "I031"
            ]
        );
        let tell: Vec<String> = structured_steps(&s)
            .into_iter()
            .filter(|step| step.starts_with("Tell the user: "))
            .collect();
        assert_eq!(tell.len(), 3, "{tell:?}");
    }

    #[tokio::test]
    async fn check_fixture_a_review_is_empty() {
        let result = server("check_a_review")
            .check(check_args("lgh154-a"))
            .await
            .expect("protocol ok");
        let s = result.structured_content.expect("structured content");
        // Only the title block is missing (I031, D41); the steps do not change.
        assert_eq!(review_codes(&s), ["I031", "I031", "I031", "I031"]);
        assert_eq!(structured_steps(&s).len(), 4);
    }

    #[tokio::test]
    async fn check_fixture_b_review_is_empty() {
        let result = server("check_b_review")
            .check(check_args("lgh154-b"))
            .await
            .expect("protocol ok");
        let s = result.structured_content.expect("structured content");
        assert_eq!(s["review"], json!([]));
    }

    #[tokio::test]
    async fn check_unknown_plan() {
        let result = server("check_unknown")
            .check(check_args("nope"))
            .await
            .expect("protocol ok");
        assert_eq!(result.is_error, Some(true));
        let s = result.structured_content.expect("structured content");
        assert_eq!(s["diagnostics"][0]["code"], "E020");
    }

    #[tokio::test]
    async fn check_bad_id() {
        let result = server("check_bad_id")
            .check(check_args("../etc"))
            .await
            .expect("protocol ok");
        assert_eq!(result.is_error, Some(true));
        let s = result.structured_content.expect("structured content");
        assert_eq!(s["diagnostics"][0]["code"], "E021");
    }

    fn get_args(plan_id: &str, view: GetView, fields: Vec<Field>) -> Parameters<GetArgs> {
        Parameters(GetArgs {
            plan_id: plan_id.into(),
            view,
            fields,
        })
    }

    fn summary_lines(s: &serde_json::Value) -> Vec<String> {
        s["text"]
            .as_str()
            .expect("text string")
            .split('\n')
            .map(str::to_string)
            .collect()
    }

    #[tokio::test]
    async fn get_summary_fixture_a() {
        let result = server("get_sum_a")
            .get(get_args("lgh154-a", GetView::Summary, vec![]))
            .await
            .expect("protocol ok");
        assert_eq!(result.is_error, Some(false));
        let s = result.structured_content.expect("structured content");
        assert_eq!(s["view"], "summary");
        let lines = summary_lines(&s);
        assert_eq!(
            lines[0],
            r#"Plan "Gnejsen lgh 154, existing (laser 2026-11-07)": 5 rooms, resolved."#
        );
        assert_eq!(
            lines[1..6],
            [
                "Garderob 1860 x 2360 mm, 4.39 m²",
                "Sovrum 1860 x 2090 mm, 3.89 m²",
                "Hall 1100 x 1113 mm, 1.22 m²",
                "WC 2370 x 990 mm, 2.35 m²",
                "Vardagsrum 3560 x 3480 mm, 12.39 m²",
            ]
        );
        assert!(lines[6].ends_with("openings: 4."), "{}", lines[6]);
        assert_eq!(lines[7], "Diagnostics: errors 0, warnings 1, info 2.");
        assert_eq!(lines.len(), 8);
    }

    #[tokio::test]
    async fn get_summary_fixture_b() {
        let result = server("get_sum_b")
            .get(get_args("lgh154-b", GetView::Summary, vec![]))
            .await
            .expect("protocol ok");
        assert_eq!(result.is_error, Some(false));
        let s = result.structured_content.expect("structured content");
        let lines = summary_lines(&s);
        assert!(lines[0].ends_with("not resolved."), "{}", lines[0]);
        assert!(
            lines.iter().any(|l| l == "Hall 1100 x ? mm, ? m²"),
            "{lines:?}"
        );
    }

    #[tokio::test]
    async fn get_summary_parse_error_is_tool_error() {
        let root = fixture_root("get_sum_bad", &[("bad", "room A 3000 * 2000\n")]);
        let result = PlanServer::new(Store::new(root))
            .get(get_args("bad", GetView::Summary, vec![]))
            .await
            .expect("protocol ok");
        assert_eq!(result.is_error, Some(true));
        let s = result.structured_content.expect("structured content");
        assert_eq!(codes(&s), ["E006"]);
    }

    #[tokio::test]
    async fn get_dsl_fixture_a_is_canonical_print() {
        let result = server("get_dsl_a")
            .get(get_args("lgh154-a", GetView::Dsl, vec![]))
            .await
            .expect("protocol ok");
        assert_eq!(result.is_error, Some(false));
        let s = result.structured_content.expect("structured content");
        assert_eq!(s["view"], "dsl");
        let expected = plan_core::dsl::print(&plan_core::dsl::parse(FIXTURE_A).expect("parse"));
        assert_eq!(s["text"], expected.as_str());
        assert!(s.get("diagnostics").is_none());
    }

    #[tokio::test]
    async fn get_dsl_unparsable_returns_stored_text() {
        let stored = "room A 3000 * 2000\n";
        let root = fixture_root("get_dsl_bad", &[("bad", stored)]);
        let result = PlanServer::new(Store::new(root))
            .get(get_args("bad", GetView::Dsl, vec![]))
            .await
            .expect("protocol ok");
        assert_eq!(result.is_error, Some(false));
        let s = result.structured_content.expect("structured content");
        assert_eq!(s["text"], stored);
        assert_eq!(codes(&s), ["E006"]);
    }

    #[tokio::test]
    async fn get_json_fields_openings_only() {
        let result = server("get_json_open")
            .get(get_args("lgh154-a", GetView::Json, vec![Field::Openings]))
            .await
            .expect("protocol ok");
        let s = result.structured_content.expect("structured content");
        let mut keys: Vec<&str> = s
            .as_object()
            .expect("object")
            .keys()
            .map(String::as_str)
            .collect();
        keys.sort();
        assert_eq!(keys, ["fixture", "openings", "resolved"]);
    }

    #[tokio::test]
    async fn get_json_all_fields_when_empty() {
        let result = server("get_json_all")
            .get(get_args("lgh154-a", GetView::Json, vec![]))
            .await
            .expect("protocol ok");
        let s = result.structured_content.expect("structured content");
        assert_eq!(s["resolved"], true);
        assert!(s["faces"].is_object());
        assert!(s["interior_walls"].is_array());
        assert!(s["diagnostics"].is_array());
    }

    #[tokio::test]
    async fn get_unknown_plan_is_tool_error() {
        let result = server("get_unknown")
            .get(get_args("nope", GetView::Json, vec![]))
            .await
            .expect("protocol ok");
        assert_eq!(result.is_error, Some(true));
        let s = result.structured_content.expect("structured content");
        assert_eq!(s["diagnostics"][0]["code"], "E020");
    }

    fn apply_args(plan_id: &str, patch: &str, dry_run: bool) -> Parameters<ApplyArgs> {
        Parameters(ApplyArgs {
            plan_id: plan_id.into(),
            patch: patch.into(),
            dry_run,
        })
    }

    const CONFLICT_PATCH: &str = "measure Garderob.north to Sovrum.south = 4490 source laser";
    const WINDOW_PATCH: &str = "window Garderob.north at 300 width 800 source laser";

    #[tokio::test]
    async fn apply_conflict_leaves_file() {
        let root = fixture_root("apply_conflict", &[("a", FIXTURE_A)]);
        let before = fs::read(root.join("a.plan")).expect("read");
        let result = PlanServer::new(Store::new(&root))
            .apply(apply_args("a", CONFLICT_PATCH, false))
            .await
            .expect("protocol ok");
        assert_eq!(result.is_error, Some(false));
        let s = result.structured_content.expect("structured content");
        assert_eq!(s["ok"], false);
        assert_eq!(s["saved"], false);
        assert!(codes(&s).contains(&"E003".to_string()), "{s}");
        assert_eq!(fs::read(root.join("a.plan")).expect("read"), before);
    }

    #[tokio::test]
    async fn apply_dry_run() {
        let root = fixture_root("apply_dry", &[("a", FIXTURE_A)]);
        let before = fs::read(root.join("a.plan")).expect("read");
        let result = PlanServer::new(Store::new(&root))
            .apply(apply_args("a", WINDOW_PATCH, true))
            .await
            .expect("protocol ok");
        let s = result.structured_content.expect("structured content");
        assert_eq!(s["ok"], true);
        assert_eq!(s["saved"], false);
        assert!(
            s["summary"]
                .as_str()
                .expect("summary")
                .starts_with("Dry run:")
        );
        assert_eq!(fs::read(root.join("a.plan")).expect("read"), before);
    }

    #[tokio::test]
    async fn apply_saves() {
        let root = fixture_root("apply_saves", &[("a", FIXTURE_A)]);
        let result = PlanServer::new(Store::new(&root))
            .apply(apply_args("a", WINDOW_PATCH, false))
            .await
            .expect("protocol ok");
        let s = result.structured_content.expect("structured content");
        assert_eq!(s["ok"], true);
        assert_eq!(s["saved"], true);

        let text = fs::read_to_string(root.join("a.plan")).expect("read");
        let plan = plan_core::dsl::parse(&text).expect("saved file parses");
        assert_eq!(plan.openings.len(), 5);
        assert_eq!(
            text,
            plan_core::dsl::print(&plan),
            "saved text is canonical"
        );
    }

    #[tokio::test]
    async fn apply_creates_plan() {
        let root = fixture_root("apply_creates", &[]);
        let patch = "room A 3000 x 2000 source laser";
        let result = PlanServer::new(Store::new(&root))
            .apply(apply_args("new1", patch, false))
            .await
            .expect("protocol ok");
        let s = result.structured_content.expect("structured content");
        assert_eq!(s["ok"], true, "{s}");
        assert!(root.join("new1.plan").exists());

        let view = PlanServer::new(Store::new(&root))
            .get(get_args("new1", GetView::Dsl, vec![]))
            .await
            .expect("protocol ok");
        let v = view.structured_content.expect("structured content");
        assert!(
            v["text"]
                .as_str()
                .expect("text")
                .contains("room A 3000 x 2000 source laser"),
            "{v}"
        );
    }

    #[tokio::test]
    async fn apply_bad_id() {
        let root = fixture_root("apply_bad_id", &[("a", FIXTURE_A)]);
        let result = PlanServer::new(Store::new(&root))
            .apply(apply_args("a/b", WINDOW_PATCH, false))
            .await
            .expect("protocol ok");
        assert_eq!(result.is_error, Some(true));
        let s = result.structured_content.expect("structured content");
        assert_eq!(s["diagnostics"][0]["code"], "E021");
    }

    fn render_args(
        plan_id: &str,
        view: RenderView,
        region: Option<RegionArg>,
    ) -> Parameters<RenderArgs> {
        Parameters(RenderArgs {
            plan_id: plan_id.into(),
            view,
            region,
            max_tokens: default_tokens(),
        })
    }

    #[tokio::test]
    async fn render_fixture_a() {
        use base64::Engine;
        let result = server("render_a")
            .render(render_args("lgh154-a", RenderView::Labels, None))
            .await
            .expect("protocol ok");
        assert_eq!(result.is_error, Some(false));
        let image = match &result.content[0] {
            ContentBlock::Image(image) => image,
            other => panic!("expected an image block, got {other:?}"),
        };
        assert_eq!(image.mime_type, "image/png");
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(&image.data)
            .expect("base64 image");
        assert!(bytes.starts_with(b"\x89PNG"));
        let s = result.structured_content.expect("structured content");
        assert!(s["tokens"].as_u64().expect("tokens") <= 1600, "{s}");
        let be_u32 = |at: usize| {
            u32::from_be_bytes([bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]])
        };
        assert_eq!(s["size_px"][0], be_u32(16));
        assert_eq!(s["size_px"][1], be_u32(20));
    }

    #[tokio::test]
    async fn render_crop_hall() {
        let result = server("render_hall")
            .render(render_args(
                "lgh154-a",
                RenderView::Labels,
                Some(RegionArg::Id { id: "Hall".into() }),
            ))
            .await
            .expect("protocol ok");
        assert_eq!(result.is_error, Some(false));
        let s = result.structured_content.expect("structured content");
        assert_eq!(s["mm_per_px"], 2.5);
        assert_eq!(s["origin_mm"], json!([1381, -600]));
    }

    #[tokio::test]
    async fn render_unknown_id() {
        let result = server("render_unknown")
            .render(render_args(
                "lgh154-a",
                RenderView::Labels,
                Some(RegionArg::Id { id: "Hal".into() }),
            ))
            .await
            .expect("protocol ok");
        assert_eq!(result.is_error, Some(true));
        let s = result.structured_content.expect("structured content");
        assert_eq!(codes(&s), ["E011"]);
        let text = s["diagnostics"][0]["message"].as_str().expect("message");
        assert!(text.contains(r#"Did you mean "Hall"?"#), "{text}");
    }

    #[tokio::test]
    async fn render_view_later() {
        let result = server("render_later")
            .render(render_args("lgh154-a", RenderView::Conflicts, None))
            .await
            .expect("protocol ok");
        assert_eq!(result.is_error, Some(true));
        let s = result.structured_content.expect("structured content");
        assert_eq!(codes(&s), ["E022"]);
        assert_eq!(
            s["diagnostics"][0]["message"],
            r#"View "conflicts" is not available yet; use "plan" or "labels"."#
        );
    }

    #[tokio::test]
    async fn render_unresolved() {
        let result = server("render_unresolved")
            .render(render_args("lgh154-b", RenderView::Labels, None))
            .await
            .expect("protocol ok");
        assert_eq!(result.is_error, Some(true));
        let s = result.structured_content.expect("structured content");
        assert!(codes(&s).contains(&"E003".to_string()), "{s}");
    }

    #[test]
    fn region_arg_parses() {
        let args: RenderArgs =
            serde_json::from_value(json!({"plan_id": "a", "region": {"rect_mm": [0, 0, 10, 10]}}))
                .expect("parses");
        assert!(matches!(
            args.region,
            Some(RegionArg::Rect {
                rect_mm: [0, 0, 10, 10]
            })
        ));
    }

    #[test]
    fn tools_listed() {
        let names: Vec<String> = PlanServer::new(Store::new("/nonexistent"))
            .tool_router
            .list_all()
            .into_iter()
            .map(|t| t.name.to_string())
            .collect();
        assert_eq!(names, ["apply", "check", "export", "get", "render"]);
    }

    fn export_args(
        plan_id: &str,
        paper: ExportPaper,
        scale: Option<u32>,
    ) -> Parameters<ExportArgs> {
        Parameters(ExportArgs {
            plan_id: plan_id.into(),
            format: ExportFormat::Pdf,
            paper,
            scale,
            date: None,
            lang: ExportLang::En,
            dims: true,
            phase: ExportPhase::All,
        })
    }

    #[tokio::test]
    async fn export_before_and_after_use_suffixed_names() {
        let root = fixture_root("export_phase", &[("review-1", REVIEW_1)]);
        for (phase, name) in [
            (ExportPhase::Before, "review-1-before.pdf"),
            (ExportPhase::After, "review-1-after.pdf"),
        ] {
            let mut args = export_args("review-1", ExportPaper::A3, None).0;
            args.phase = phase;
            let result = PlanServer::new(Store::new(&root))
                .export(Parameters(args))
                .await
                .expect("protocol ok");
            assert_eq!(result.is_error, Some(false));
            let s = result.structured_content.expect("structured content");
            let path = PathBuf::from(s["path"].as_str().expect("path string"));
            assert!(path.ends_with(name), "{path:?}");
            assert!(fs::read(&path).expect("pdf written").starts_with(b"%PDF-"));
        }
    }

    #[tokio::test]
    async fn export_bad_phase_is_a_parse_error() {
        let parsed: Result<ExportArgs, _> =
            serde_json::from_value(json!({"plan_id": "x", "phase": "sideways"}));
        assert!(parsed.is_err());
    }

    #[tokio::test]
    async fn export_fixture_a() {
        let root = fixture_root("export_a", &[("lgh154-a", FIXTURE_A)]);
        let result = PlanServer::new(Store::new(&root))
            .export(export_args("lgh154-a", ExportPaper::A3, None))
            .await
            .expect("protocol ok");
        assert_eq!(result.is_error, Some(false));
        let s = result.structured_content.expect("structured content");
        assert_eq!(s["paper"], "a3");
        assert_eq!(s["scale"], 25);
        let path = PathBuf::from(s["path"].as_str().expect("path string"));
        assert!(path.starts_with(root.join("exports")), "{path:?}");
        let bytes = fs::read(&path).expect("pdf written");
        assert!(bytes.starts_with(b"%PDF-"));
        assert_eq!(s["bytes"], json!(bytes.len()));
    }

    #[tokio::test]
    async fn export_a4_scale_20_is_e018() {
        let root = fixture_root("export_e018", &[("lgh154-a", FIXTURE_A)]);
        let result = PlanServer::new(Store::new(&root))
            .export(export_args("lgh154-a", ExportPaper::A4, Some(20)))
            .await
            .expect("protocol ok");
        assert_eq!(result.is_error, Some(true));
        let s = result.structured_content.expect("structured content");
        assert_eq!(codes(&s), ["E018"]);
        assert!(!root.join("exports").join("lgh154-a.pdf").exists());
    }

    #[tokio::test]
    async fn export_without_format_is_pdf() {
        let root = fixture_root("export_no_format", &[("lgh154-a", FIXTURE_A)]);
        let args: ExportArgs = serde_json::from_value(json!({"plan_id": "lgh154-a"}))
            .expect("format and lang are optional");
        let result = PlanServer::new(Store::new(&root))
            .export(Parameters(args))
            .await
            .expect("protocol ok");
        assert_eq!(result.is_error, Some(false));
        let s = result.structured_content.expect("structured content");
        let path = PathBuf::from(s["path"].as_str().expect("path string"));
        assert!(path.ends_with("lgh154-a.pdf"), "{path:?}");
        assert!(fs::read(&path).expect("pdf written").starts_with(b"%PDF-"));
    }

    #[tokio::test]
    async fn export_unknown_plan_is_e020() {
        let root = fixture_root("export_unknown", &[]);
        let result = PlanServer::new(Store::new(&root))
            .export(export_args("nope", ExportPaper::A3, None))
            .await
            .expect("protocol ok");
        assert_eq!(result.is_error, Some(true));
        let s = result.structured_content.expect("structured content");
        assert_eq!(codes(&s), ["E020"]);
    }
}
