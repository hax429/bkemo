//! OTA bundle resolver (Phase 8 — see MOBILE_CLIENT_DESIGN.md §3 / IOS.md §2.2).
//!
//! Resolves a request path to a file inside the *active* extracted frontend
//! bundle living under the app-data dir:
//!
//! ```text
//! <AppData>/bundle-state.json      { "active": "1.8.8" }
//! <AppData>/bundles/1.8.7/...      previous (kept as rollback)
//! <AppData>/bundles/1.8.8/...      active
//! ```
//!
//! `resolve()` returns `None` when there is no active bundle or the file is
//! missing — the caller (the `bundle://` URI scheme handler in `lib.rs`) then
//! falls back to the baked-in baseline shipped inside the binary. Pure +
//! cross-platform so a desktop `cargo test` exercises it.

use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BundleState {
    pub active: String,
}

/// `<AppData>/bundles`
pub fn bundles_dir<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("bundles"))
}

/// `<AppData>/bundle-state.json`
pub fn state_path<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("bundle-state.json"))
}

/// The currently-active bundle version, if `bundle-state.json` names one.
pub fn read_active<R: Runtime>(app: &AppHandle<R>) -> Option<String> {
    let path = state_path(app)?;
    let raw = std::fs::read_to_string(path).ok()?;
    let state: BundleState = serde_json::from_str(&raw).ok()?;
    let v = state.active.trim();
    if v.is_empty() { None } else { Some(v.to_string()) }
}

/// Atomically point `bundle-state.json` at `version` (temp file + rename).
pub fn write_active<R: Runtime>(app: &AppHandle<R>, version: &str) -> std::io::Result<()> {
    let path = state_path(app)
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "no app data dir"))?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension("json.tmp");
    let body = serde_json::to_vec(&BundleState { active: version.to_string() })?;
    std::fs::write(&tmp, body)?;
    std::fs::rename(&tmp, &path)
}

/// Normalize a request path into a bundle-relative file path:
/// strip the leading `/`, drop any `?query`/`#fragment`, and map an empty
/// path (root) to `index.html`.
pub fn normalize(req_path: &str) -> String {
    let no_query = req_path
        .split(['?', '#'])
        .next()
        .unwrap_or(req_path);
    let trimmed = no_query.trim_start_matches('/');
    if trimmed.is_empty() {
        "index.html".to_string()
    } else {
        trimmed.to_string()
    }
}

/// Best-effort `Content-Type` for a path's extension.
pub fn mime_for(path: &str) -> &'static str {
    let ext = Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    match ext.as_str() {
        "html" | "htm" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" => "application/json; charset=utf-8",
        "wasm" => "application/wasm",
        "map" => "application/json; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "ico" => "image/x-icon",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        "txt" => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

/// Read `req_path` out of the active bundle. Returns the bytes + content-type,
/// or `None` if there is no active bundle or the file does not exist (caller
/// falls back to the baked-in baseline). Guards against `..` path traversal by
/// requiring the resolved file to stay inside the bundle dir.
pub fn resolve<R: Runtime>(app: &AppHandle<R>, req_path: &str) -> Option<(Vec<u8>, &'static str)> {
    let active = read_active(app)?;
    let bundle_dir = bundles_dir(app)?.join(&active);
    let rel = normalize(req_path);
    let file = bundle_dir.join(&rel);

    // Path-traversal guard: the canonical file must live under the bundle dir.
    let canon_base = bundle_dir.canonicalize().ok()?;
    let canon_file = file.canonicalize().ok()?;
    if !canon_file.starts_with(&canon_base) {
        return None;
    }

    let bytes = std::fs::read(&canon_file).ok()?;
    Some((bytes, mime_for(&rel)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_maps_root_to_index() {
        assert_eq!(normalize("/"), "index.html");
        assert_eq!(normalize(""), "index.html");
    }

    #[test]
    fn normalize_strips_leading_slash_and_query() {
        assert_eq!(normalize("/assets/index-abc.js"), "assets/index-abc.js");
        assert_eq!(normalize("/assets/x.css?v=2"), "assets/x.css");
        assert_eq!(normalize("/index.html#frag"), "index.html");
    }

    #[test]
    fn mime_for_known_extensions() {
        assert_eq!(mime_for("index.html"), "text/html; charset=utf-8");
        assert_eq!(mime_for("a/b.js"), "text/javascript; charset=utf-8");
        assert_eq!(mime_for("a/b.css"), "text/css; charset=utf-8");
        assert_eq!(mime_for("x.wasm"), "application/wasm");
        assert_eq!(mime_for("logo.png"), "image/png");
        assert_eq!(mime_for("font.woff2"), "font/woff2");
        assert_eq!(mime_for("noext"), "application/octet-stream");
    }
}
