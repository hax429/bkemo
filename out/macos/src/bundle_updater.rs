//! OTA bundle updater (Phase 8 — see MOBILE_CLIENT_DESIGN.md §3 / IOS.md §2.2).
//!
//! Spawned once at startup on mobile. Fetches the server manifest and, if a
//! newer frontend bundle is available, downloads it, verifies its SHA-256,
//! extracts it under `<AppData>/bundles/<version>/`, and atomically flips
//! `bundle-state.json` to point at it. The new bundle is served on the *next*
//! launch (no hot-swap — locked decision). The previous bundle is kept as a
//! rollback. All work happens off the UI thread; failures are logged and
//! non-fatal (the app keeps running on the current/baseline frontend).

use std::io::Cursor;
use std::path::Path;

use serde::Deserialize;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Runtime};

use crate::bundle_resolver::{bundles_dir, read_active, write_active};

/// Server base URL. Mirrors `blinkoEndpoint.ts`'s `DEFAULT_TAURI_ENDPOINT`.
/// Overridable at build time via `BKEMO_ENDPOINT`.
const DEFAULT_ENDPOINT: &str = "https://bk.hax429.me";

fn endpoint() -> &'static str {
    option_env!("BKEMO_ENDPOINT").unwrap_or(DEFAULT_ENDPOINT)
}

#[derive(Debug, Deserialize)]
struct Manifest {
    version: String,
    sha256: String,
    /// e.g. `/app-bundle/bundle-1.8.7.zip`
    url: String,
    #[serde(rename = "minNativeVersion", default)]
    min_native_version: String,
}

/// Lowercase hex SHA-256 of `bytes`.
fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hasher
        .finalize()
        .iter()
        .map(|b| format!("{:02x}", b))
        .collect()
}

/// `true` when semver-ish `a` is strictly less than `b` (numeric component
/// compare; missing/non-numeric components count as 0).
fn version_lt(a: &str, b: &str) -> bool {
    let parse = |s: &str| -> Vec<u64> {
        s.split('.')
            .map(|p| p.trim().parse::<u64>().unwrap_or(0))
            .collect()
    };
    let (va, vb) = (parse(a), parse(b));
    let n = va.len().max(vb.len());
    for i in 0..n {
        let x = va.get(i).copied().unwrap_or(0);
        let y = vb.get(i).copied().unwrap_or(0);
        if x != y {
            return x < y;
        }
    }
    false
}

/// Spawn the background update check. Safe to call once in `setup()`.
pub fn spawn_update_check<R: Runtime>(app: AppHandle<R>) {
    tauri::async_runtime::spawn(async move {
        if let Err(e) = run(&app).await {
            log_warn(&format!("update check failed: {e}"));
        }
    });
}

async fn run<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let base = endpoint();
    let client = reqwest::Client::builder()
        .build()
        .map_err(|e| format!("client: {e}"))?;

    // 1. Manifest.
    let manifest_url = format!("{base}/app-bundle/manifest.json");
    let manifest_txt = client
        .get(&manifest_url)
        .send()
        .await
        .map_err(|e| format!("fetch manifest: {e}"))?
        .text()
        .await
        .map_err(|e| format!("read manifest: {e}"))?;
    let manifest: Manifest =
        serde_json::from_str(&manifest_txt).map_err(|e| format!("parse manifest: {e}"))?;

    // 2. min-native gate — warn but keep going (app stays usable).
    let native = env!("CARGO_PKG_VERSION");
    if !manifest.min_native_version.is_empty() && version_lt(native, &manifest.min_native_version) {
        log_warn(&format!(
            "bundle {} needs native >= {} (have {}) — frontend may misbehave",
            manifest.version, manifest.min_native_version, native
        ));
        let _ = app.emit("bundle://min-native", manifest.min_native_version.clone());
    }

    let dir = bundles_dir(app).ok_or("no app data dir")?;
    let target = dir.join(&manifest.version);
    let active = read_active(app);

    // 3. Already current? Nothing to download.
    if active.as_deref() == Some(manifest.version.as_str()) {
        return Ok(());
    }

    // 4. Already extracted from a previous run — just flip the pointer.
    if target.is_dir() {
        write_active(app, &manifest.version).map_err(|e| format!("flip pointer: {e}"))?;
        let _ = app.emit("bundle://updated", manifest.version.clone());
        return Ok(());
    }

    // 5. Download + integrity check.
    let zip_url = format!("{base}{}", manifest.url);
    let bytes = client
        .get(&zip_url)
        .send()
        .await
        .map_err(|e| format!("fetch bundle: {e}"))?
        .bytes()
        .await
        .map_err(|e| format!("read bundle: {e}"))?;

    let got = sha256_hex(&bytes);
    if !got.eq_ignore_ascii_case(manifest.sha256.trim()) {
        return Err(format!(
            "sha256 mismatch (expected {}, got {})",
            manifest.sha256, got
        ));
    }

    // 6. Extract to a temp dir, then atomically rename into place.
    std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir bundles: {e}"))?;
    let staging = dir.join(format!(".staging-{}", manifest.version));
    let _ = std::fs::remove_dir_all(&staging);
    extract_zip(&bytes, &staging).map_err(|e| format!("extract: {e}"))?;
    let _ = std::fs::remove_dir_all(&target);
    std::fs::rename(&staging, &target).map_err(|e| format!("install: {e}"))?;

    // 7. Flip the active pointer + prune old bundles.
    write_active(app, &manifest.version).map_err(|e| format!("flip pointer: {e}"))?;
    prune(&dir, &manifest.version);

    log_warn(&format!("installed bundle {} (active next launch)", manifest.version));
    let _ = app.emit("bundle://updated", manifest.version.clone());
    Ok(())
}

/// Extract a zip archive (in memory) into `dest`.
fn extract_zip(bytes: &[u8], dest: &Path) -> std::io::Result<()> {
    let mut archive = zip::ZipArchive::new(Cursor::new(bytes))
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    std::fs::create_dir_all(dest)?;
    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
        // `enclosed_name` strips `..`/absolute components — guards against zip-slip.
        let rel = match entry.enclosed_name() {
            Some(p) => p,
            None => continue,
        };
        let out = dest.join(rel);
        if entry.is_dir() {
            std::fs::create_dir_all(&out)?;
        } else {
            if let Some(parent) = out.parent() {
                std::fs::create_dir_all(parent)?;
            }
            let mut f = std::fs::File::create(&out)?;
            std::io::copy(&mut entry, &mut f)?;
        }
    }
    Ok(())
}

/// Keep the `active` bundle + the single most-recently-modified other one;
/// delete the rest. Bounds disk use while preserving one rollback target.
fn prune(dir: &Path, active: &str) {
    let mut others: Vec<(std::time::SystemTime, std::path::PathBuf)> = Vec::new();
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name == active || name.starts_with(".staging-") {
            continue;
        }
        let mtime = entry
            .metadata()
            .and_then(|m| m.modified())
            .unwrap_or(std::time::UNIX_EPOCH);
        others.push((mtime, path));
    }
    others.sort_by(|a, b| b.0.cmp(&a.0)); // newest first
    for (_, path) in others.into_iter().skip(1) {
        let _ = std::fs::remove_dir_all(path);
    }
}

fn log_warn(msg: &str) {
    eprintln!("[bundle-updater] {msg}");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sha256_hex_known_vector() {
        // SHA-256 of the empty input.
        assert_eq!(
            sha256_hex(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        // SHA-256 of "abc".
        assert_eq!(
            sha256_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn version_ordering() {
        assert!(version_lt("1.8.0", "1.8.1"));
        assert!(version_lt("1.8.0", "1.10.0"));
        assert!(version_lt("0.1.0", "1.0.0"));
        assert!(!version_lt("1.8.1", "1.8.1"));
        assert!(!version_lt("1.9.0", "1.8.9"));
        // Missing components count as zero.
        assert!(version_lt("1.8", "1.8.1"));
        assert!(!version_lt("1.8.0", "1.8"));
    }

    #[test]
    fn extract_roundtrip() {
        // Build a tiny zip in memory and extract it.
        let mut buf = Vec::new();
        {
            let mut zw = zip::ZipWriter::new(Cursor::new(&mut buf));
            use std::io::Write;
            let opts: zip::write::FileOptions<'_, ()> = zip::write::FileOptions::default();
            zw.start_file("index.html", opts).unwrap();
            zw.write_all(b"<html>hi</html>").unwrap();
            zw.start_file("assets/app.js", opts).unwrap();
            zw.write_all(b"console.log(1)").unwrap();
            zw.finish().unwrap();
        }
        let tmp = std::env::temp_dir().join(format!("bkemo-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        extract_zip(&buf, &tmp).unwrap();
        assert_eq!(
            std::fs::read_to_string(tmp.join("index.html")).unwrap(),
            "<html>hi</html>"
        );
        assert_eq!(
            std::fs::read_to_string(tmp.join("assets/app.js")).unwrap(),
            "console.log(1)"
        );
        let _ = std::fs::remove_dir_all(&tmp);
    }
}
