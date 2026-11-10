//! `plan-mcp --root DIR`: serves plans from DIR over stdio (spec D12, D13).

use std::path::PathBuf;

const USAGE: &str = "usage: plan-mcp --root DIR";

fn parse_root() -> Option<PathBuf> {
    let mut args = std::env::args().skip(1);
    let mut root = None;
    while let Some(arg) = args.next() {
        if arg == "--root" {
            root = Some(PathBuf::from(args.next()?));
        } else {
            return None;
        }
    }
    root
}

#[tokio::main]
async fn main() -> std::process::ExitCode {
    let Some(root) = parse_root() else {
        eprintln!("{USAGE}");
        return std::process::ExitCode::from(2);
    };
    use rmcp::ServiceExt;
    let server = plan_server::PlanServer::new(plan_server::Store::new(root));
    match server.serve(rmcp::transport::stdio()).await {
        Ok(service) => {
            let _ = service.waiting().await;
            std::process::ExitCode::SUCCESS
        }
        Err(e) => {
            eprintln!("plan-mcp: {e}");
            std::process::ExitCode::FAILURE
        }
    }
}
