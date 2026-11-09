# Planstudio v2 (built in this folder)

Rust workspace in `v2/` (its own Cargo.toml; the rest of the repo is the v1 Next.js app, leave it alone).
Specs: `docs/v2-agent-specs.md` (read only the sections a card names), `docs/v2-week1-pro.md` (cards, pseudo-code).
Paths in the specs like `crates/…` and `fixtures/…` mean `v2/crates/…` and `v2/fixtures/…`.
Rules: `docs/v2-agent-specs.md` §3. Units: i64 mm. Coordinates: x east, y south.
One card per subagent call. Test: `cd v2 && cargo test -q 2>&1 | tail -40`.
Never edit tests, fixtures or public signatures unless the card says so.
Automated runs follow `v2/RUNNER.md`.
