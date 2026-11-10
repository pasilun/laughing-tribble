//! End to end over stdio: spawn `plan-mcp --root DIR` and talk JSON-RPC to it (spec D12, D13).

use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use serde_json::{Value, json};

const FIXTURES: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../fixtures");

fn fixture(name: &str) -> PathBuf {
    Path::new(FIXTURES).join(name)
}

#[test]
fn stdio_session() {
    let root = PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join("stdio-session");
    let _ = fs::remove_dir_all(&root);
    fs::create_dir_all(&root).expect("create root");
    for name in ["lgh154-a.plan", "lgh154-b.plan"] {
        fs::copy(fixture(name), root.join(name)).expect("copy fixture");
    }

    let mut child = Command::new(env!("CARGO_BIN_EXE_plan-mcp"))
        .args(["--root"])
        .arg(&root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .expect("spawn plan-mcp");

    let requests = [
        json!({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
            "protocolVersion": "2025-06-18",
            "capabilities": {},
            "clientInfo": {"name": "test", "version": "0"}}}),
        json!({"jsonrpc": "2.0", "method": "notifications/initialized"}),
        json!({"jsonrpc": "2.0", "id": 2, "method": "tools/list"}),
        json!({"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {
            "name": "check", "arguments": {"plan_id": "lgh154-b"}}}),
        json!({"jsonrpc": "2.0", "id": 4, "method": "tools/call", "params": {
            "name": "render", "arguments": {"plan_id": "lgh154-a", "max_tokens": 800}}}),
    ];
    {
        let mut stdin = child.stdin.take().expect("stdin");
        for request in &requests {
            writeln!(stdin, "{request}").expect("write request");
        }
        // Dropping stdin sends EOF.
    }

    // Read stdout on a thread so that a hung child cannot block the timeout below.
    let mut stdout = child.stdout.take().expect("stdout");
    let reader = thread::spawn(move || {
        let mut text = String::new();
        stdout.read_to_string(&mut text).expect("read stdout");
        text
    });

    let start = Instant::now();
    let status = loop {
        if let Some(status) = child.try_wait().expect("try_wait") {
            break status;
        }
        if start.elapsed() > Duration::from_secs(20) {
            let _ = child.kill();
            let _ = child.wait();
            panic!("plan-mcp did not exit within 20 s");
        }
        thread::sleep(Duration::from_millis(100));
    };
    let text = reader.join().expect("reader thread");

    assert_eq!(status.code(), Some(0), "exit status");

    let mut by_id: std::collections::HashMap<u64, Value> = std::collections::HashMap::new();
    for line in text.lines().filter(|l| !l.trim().is_empty()) {
        let v: Value = serde_json::from_str(line).expect("stdout line is JSON");
        let id = v["id"].as_u64().expect("response has numeric id");
        by_id.insert(id, v);
    }
    let response = |id: u64| {
        by_id
            .get(&id)
            .unwrap_or_else(|| panic!("no response for id {id}: {text}"))
    };

    // id 1: initialize
    let init = &response(1)["result"];
    assert_eq!(init["serverInfo"]["name"], "planstudio");
    assert!(
        init["instructions"].as_str().is_some_and(|s| !s.is_empty()),
        "{init}"
    );
    assert!(init["capabilities"]["tools"].is_object(), "{init}");

    // id 2: tools/list
    let tools = response(2)["result"]["tools"]
        .as_array()
        .expect("tools array");
    let mut names: Vec<&str> = tools
        .iter()
        .map(|t| t["name"].as_str().expect("tool name"))
        .collect();
    names.sort();
    assert_eq!(names, ["apply", "check", "get", "render"]);
    for tool in tools {
        let name = tool["name"].as_str().expect("tool name");
        let required = tool["inputSchema"]["required"]
            .as_array()
            .unwrap_or_else(|| panic!("{name} has no required list"));
        assert!(
            required.iter().any(|r| r == "plan_id"),
            "{name} requires plan_id: {tool}"
        );
        if name == "apply" {
            assert!(
                tool["annotations"]["readOnlyHint"] != true,
                "apply must not be read only: {tool}"
            );
        } else {
            assert_eq!(
                tool["annotations"]["readOnlyHint"], true,
                "{name} must be read only: {tool}"
            );
        }
    }

    // id 3: check on the unresolved fixture
    let check = &response(3)["result"];
    assert_eq!(check["isError"], false, "{check}");
    let sc = &check["structuredContent"];
    assert_eq!(sc["diagnostics"][0]["code"], "E003", "{check}");
    let first_step = sc["next_steps"][0].as_str().expect("next_steps[0] string");
    assert!(
        first_step.starts_with("Conflict on the north–south axis: 50 mm."),
        "{first_step}"
    );

    // id 4: render on the resolved fixture
    let render = &response(4)["result"];
    assert_eq!(render["content"][0]["type"], "image", "{render}");
    assert_eq!(render["content"][0]["mimeType"], "image/png", "{render}");
    let tokens = render["structuredContent"]["tokens"]
        .as_u64()
        .expect("tokens number");
    assert!(tokens <= 800, "tokens {tokens} over budget");
}

#[test]
fn usage_without_root() {
    let status = Command::new(env!("CARGO_BIN_EXE_plan-mcp"))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .expect("run plan-mcp");
    assert_eq!(status.code(), Some(2));
}
