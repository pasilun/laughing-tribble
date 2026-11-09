#!/usr/bin/env bash
# CI gate for the Planstudio v2 workspace.
set -euo pipefail

cd "$(dirname "$0")"

cargo fmt --check
cargo clippy -q -- -D warnings
cargo test -q
