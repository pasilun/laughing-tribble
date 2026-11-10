//! Core entry points for clients (spec §5.3, §10, §15 D3): the MCP server, the
//! renderer and the CLI all parse, check names and resolve the same way, so
//! that work lives here.

use serde::Serialize;

use crate::diagnostics::Diagnostic;
use crate::dsl::parse;
use crate::intent::Plan;
use crate::resolved::{Resolved, resolve};

/// A plan and what the kernel made of it. Lengths in mm, x east, y south.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Resolve {
    pub plan: Plan,
    /// `None` when any Error diagnostic exists (§6.2 step 7).
    pub resolved: Option<Resolved>,
    /// All diagnostics from name resolution, solving and building, in the order the steps ran.
    pub diagnostics: Vec<Diagnostic>,
}

/// Resolve a plan that is already parsed. Never fails; errors are diagnostics.
pub fn resolve_plan(plan: &Plan) -> Resolve {
    let (resolved, diagnostics) = resolve(plan);
    Resolve {
        plan: plan.clone(),
        resolved,
        diagnostics,
    }
}

/// Parse DSL text, check names, and resolve. A parse error or name error
/// (E006, E001, E002) returns `Err` with those diagnostics and nothing else.
///
/// The name check (E001, and E002 for a duplicate room) is part of [`parse`]
/// (§7.4), so it is not repeated here.
pub fn load(src: &str) -> Result<Resolve, Vec<Diagnostic>> {
    let plan = parse(src).map_err(|diagnostic| vec![diagnostic])?;
    Ok(resolve_plan(&plan))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::diagnostics::Code;
    use crate::report::solve_json;
    use serde_json::Value;

    const FIXTURE_A: &str = include_str!("../../../fixtures/lgh154-a.plan");
    const FIXTURE_B: &str = include_str!("../../../fixtures/lgh154-b.plan");
    const EXPECTED_A: &str = include_str!("../../../fixtures/lgh154-a.expected.json");

    #[test]
    fn load_fixture_a() {
        let r = load(FIXTURE_A).expect("fixture A loads");
        assert!(r.resolved.is_some(), "{:?}", r.diagnostics);
        let value = solve_json("lgh154-a", r.resolved.as_ref(), &r.diagnostics);
        let expected: Value = serde_json::from_str(EXPECTED_A).expect("expected JSON parses");
        // The §7.7 comparer is not reachable from core tests, so compare the
        // geometry objects exactly.
        assert_eq!(value["faces"], expected["faces"], "{value:#}");
        assert_eq!(value["areas_mm2"], expected["areas_mm2"], "{value:#}");
    }

    #[test]
    fn load_fixture_b() {
        let r = load(FIXTURE_B).expect("fixture B loads");
        assert!(r.resolved.is_none());
        assert_eq!(r.diagnostics.len(), 1, "{:?}", r.diagnostics);
        assert_eq!(r.diagnostics[0].code, Code::E003);
    }

    #[test]
    fn load_parse_error() {
        let ds = load("room A 3000 * 2000\n").expect_err("parse error");
        assert_eq!(ds.len(), 1);
        assert_eq!(ds[0].code, Code::E006);
    }

    #[test]
    fn load_unknown_room() {
        let ds = load("room Sovrum 1 x 1\nroom B 1 x 1\n  east_of Sovrun gap\n")
            .expect_err("unknown room");
        assert_eq!(ds.len(), 1);
        assert_eq!(ds[0].code, Code::E001);
    }
}
