//! Planstudio MCP server (spec §11 Phase 4, D12, D13). Tool-level failures are
//! `CallToolResult::structured_error`; protocol errors are never used for them.

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

    #[test]
    fn tools_listed() {
        let names: Vec<String> = PlanServer::new(Store::new("/nonexistent"))
            .tool_router
            .list_all()
            .into_iter()
            .map(|t| t.name.to_string())
            .collect();
        assert_eq!(names, ["check"]);
    }
}
