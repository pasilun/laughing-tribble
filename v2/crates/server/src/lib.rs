//! Planstudio MCP server (spec §11 Phase 4, D12, D13). Tool-level failures are
//! `CallToolResult::structured_error`; protocol errors are never used for them.

mod get;
mod next_steps;
mod store;

pub use store::Store;

use plan_core::Diagnostic;
use rmcp::{
    ErrorData as McpError, ServerHandler,
    handler::server::{router::tool::ToolRouter, wrapper::Parameters},
    model::{CallToolResult, Implementation, ServerCapabilities, ServerConfig},
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
                    "next_steps": steps,
                }))
            }
            Ok(r) => {
                let steps = next_steps::next_steps(Some(&r.plan), &r.diagnostics);
                Ok(json!({
                    "plan_id": plan_id,
                    "resolved": r.resolved.is_some(),
                    "diagnostics": r.diagnostics,
                    "next_steps": steps,
                }))
            }
        }
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

pub const CHECK_DESCRIPTION: &str =
    "Check a plan. Returns every diagnostic (errors, warnings, info) and what to do next.";

pub const GET_DESCRIPTION: &str = "Read a plan: summary (default), dsl (the plan text, to edit with apply) or json (solved faces, walls, openings, diagnostics).";

#[cfg(test)]
mod tests {
    use super::*;
    use rmcp::handler::server::wrapper::Parameters;
    use std::fs;
    use std::path::PathBuf;

    const FIXTURE_A: &str = include_str!("../../../fixtures/lgh154-a.plan");
    const FIXTURE_B: &str = include_str!("../../../fixtures/lgh154-b.plan");

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

    #[test]
    fn tools_listed() {
        let names: Vec<String> = PlanServer::new(Store::new("/nonexistent"))
            .tool_router
            .list_all()
            .into_iter()
            .map(|t| t.name.to_string())
            .collect();
        assert_eq!(names, ["check", "get"]);
    }
}
