//! File store for plans (spec D13): `<root>/<plan_id>.plan` holds DSL text.

use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use plan_core::{Code, Diagnostic, Severity, message};

/// Plans are files `<root>/<plan_id>.plan` holding DSL text.
#[derive(Clone, Debug)]
pub struct Store {
    root: PathBuf,
}

impl Store {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    /// E021 unless plan_id matches ^[A-Za-z0-9_-]{1,64}$ (check by hand, no regex crate).
    pub fn path(&self, plan_id: &str) -> Result<PathBuf, Diagnostic> {
        if !valid_plan_id(plan_id) {
            return Err(error(Code::E021, &[("id", plan_id.to_string())], plan_id));
        }
        Ok(self.root.join(format!("{plan_id}.plan")))
    }

    /// E020 if the file is missing, E023 (action "read") on another I/O error.
    pub fn load(&self, plan_id: &str) -> Result<String, Diagnostic> {
        let path = self.path(plan_id)?;
        fs::read_to_string(&path).map_err(|e| {
            if e.kind() == ErrorKind::NotFound {
                error(Code::E020, &[("id", plan_id.to_string())], plan_id)
            } else {
                io_error("read", plan_id, &e)
            }
        })
    }

    /// Write to a temp file `<plan_id>.plan.<pid>-<n>.tmp` (unique per call, so concurrent
    /// saves of one plan never share a temp file), then rename over the file.
    /// E023 (action "save") on error.
    pub fn save(&self, plan_id: &str, text: &str) -> Result<(), Diagnostic> {
        let path = self.path(plan_id)?;
        write_atomic(&path, text.as_bytes(), "save", plan_id)
    }

    /// `<root>/exports/<plan_id>.<ext>` (spec D33). Validates the id like `path` does and
    /// creates the `exports` folder when it is missing. E023 (action "export") on failure.
    pub fn export_path(&self, plan_id: &str, ext: &str) -> Result<PathBuf, Diagnostic> {
        self.path(plan_id)?;
        let dir = self.root.join("exports");
        fs::create_dir_all(&dir).map_err(|e| io_error("export", plan_id, &e))?;
        Ok(dir.join(format!("{plan_id}.{ext}")))
    }

    /// Write export bytes to `export_path(plan_id, ext)` through a temp file in the same
    /// folder, then rename. Returns the path written. E023 (action "export") on failure.
    pub fn write_export(
        &self,
        plan_id: &str,
        ext: &str,
        bytes: &[u8],
    ) -> Result<PathBuf, Diagnostic> {
        let path = self.export_path(plan_id, ext)?;
        write_atomic(&path, bytes, "export", plan_id)?;
        Ok(path)
    }
}

/// Write `bytes` to a unique temp file next to `path`, then rename it over `path`.
fn write_atomic(path: &Path, bytes: &[u8], action: &str, plan_id: &str) -> Result<(), Diagnostic> {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    let tmp = path.with_extension(format!(
        "{}.{}-{n}.tmp",
        path.extension().and_then(|e| e.to_str()).unwrap_or(""),
        std::process::id()
    ));
    fs::write(&tmp, bytes).map_err(|e| io_error(action, plan_id, &e))?;
    fs::rename(&tmp, path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        io_error(action, plan_id, &e)
    })
}

/// True when the id is 1 to 64 ASCII letters, digits, `-` or `_`.
fn valid_plan_id(plan_id: &str) -> bool {
    (1..=64).contains(&plan_id.len())
        && plan_id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

fn io_error(action: &str, plan_id: &str, e: &std::io::Error) -> Diagnostic {
    error(
        Code::E023,
        &[
            ("action", action.to_string()),
            ("id", plan_id.to_string()),
            ("reason", e.to_string()),
        ],
        plan_id,
    )
}

fn error(code: Code, args: &[(&str, String)], plan_id: &str) -> Diagnostic {
    Diagnostic {
        code,
        severity: Severity::Error,
        message: message(code, args),
        span: None,
        refs: Vec::new(),
        data: serde_json::json!({ "plan_id": plan_id }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fresh_dir(name: &str) -> PathBuf {
        // CARGO_TARGET_TMPDIR is not set for lib unit tests, so use the OS temp dir.
        let dir = std::env::temp_dir().join("plan-server-tests").join(name);
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("create test dir");
        dir
    }

    #[test]
    fn plan_id_rules() {
        let store = Store::new("/nonexistent");
        assert!(store.path("lgh154-a").is_ok());
        assert!(store.path("A_b-9").is_ok());
        assert!(store.path(&"x".repeat(64)).is_ok());
        for bad in ["", "../etc", "a/b", "a.plan", "åäö", &"x".repeat(65)] {
            let d = store.path(bad).expect_err("bad id");
            assert_eq!(d.code, Code::E021, "{bad:?}");
        }
    }

    #[test]
    fn save_then_load_round_trip_without_tmp_file() {
        let dir = fresh_dir("store_round_trip");
        let store = Store::new(&dir);
        store
            .save("kitchen", "room Kitchen 3000 x 2000\n")
            .expect("save");
        let text = store.load("kitchen").expect("load");
        assert_eq!(text, "room Kitchen 3000 x 2000\n");
        assert!(!dir.join("kitchen.plan.tmp").exists());
        assert!(dir.join("kitchen.plan").exists());
    }

    #[test]
    fn concurrent_saves_of_one_plan_never_share_a_temp_file() {
        let dir = fresh_dir("store_concurrent_saves");
        let store = Store::new(&dir);
        let handles: Vec<_> = (0..8)
            .map(|i| {
                let store = store.clone();
                std::thread::spawn(move || {
                    for _ in 0..20 {
                        store
                            .save("p", &format!("plan \"{i}\"\n"))
                            .expect("save returns Ok");
                    }
                })
            })
            .collect();
        for h in handles {
            h.join().expect("thread join");
        }
        let text = store.load("p").expect("load");
        let written: Vec<String> = (0..8).map(|i| format!("plan \"{i}\"\n")).collect();
        assert!(
            written.contains(&text),
            "loaded text is not one written text: {text:?}"
        );
        let tmp_left = fs::read_dir(&dir)
            .expect("read dir")
            .filter_map(|e| e.ok())
            .any(|e| e.file_name().to_string_lossy().ends_with(".tmp"));
        assert!(!tmp_left, "a .tmp file was left behind");
    }

    #[test]
    fn load_missing_is_e020() {
        let dir = fresh_dir("store_missing");
        let d = Store::new(&dir).load("nope").expect_err("missing");
        assert_eq!(d.code, Code::E020);
    }
}
