//! Bridge to the native SwiftUI quick-capture helper (`out/macos/native-capture`).
//!
//! Tauri still owns the ⌃W global shortcut and the tray "Quick Note" item —
//! see `docs/plans/mac.md`. This module only spawns the helper (kept warm
//! for as long as this app runs) and tells it to show/toggle over a local
//! Unix-domain socket, carrying whatever bearer token this app currently
//! holds. The helper never signs in on its own.

use std::io::Write;
use std::os::unix::net::UnixStream;
use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::Mutex;
use std::time::Duration;

use serde_json::json;
use tauri::{AppHandle, Runtime, Manager};

use super::keychain::load_session_token;

/// Overridable at build time via `BKEMO_ENDPOINT` — mirrors
/// `bundle_updater.rs` / `blinkoEndpoint.ts`'s `DEFAULT_TAURI_ENDPOINT`.
const DEFAULT_ENDPOINT: &str = "https://bk.hax429.me";

fn endpoint() -> String {
    endpoint_path().and_then(|path| std::fs::read_to_string(path).ok())
        .unwrap_or_else(|| option_env!("BKEMO_ENDPOINT").unwrap_or(DEFAULT_ENDPOINT).to_string())
}
fn endpoint_path() -> Option<PathBuf> { socket_path().map(|path| path.with_file_name("native-endpoint.txt")) }
pub fn save_endpoint(value: &str) -> Result<(), String> {
    let url = reqwest::Url::parse(value).map_err(|_| "Invalid server address")?;
    let local = matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
    if url.scheme() != "https" && !(url.scheme() == "http" && local) { return Err("Use HTTPS or a local development server".into()); }
    if !url.username().is_empty() || url.password().is_some() || url.query().is_some() || url.fragment().is_some() { return Err("Server address must not contain credentials or query parameters".into()); }
    let path = endpoint_path().ok_or("Home directory is unavailable")?;
    std::fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    std::fs::write(path, url.as_str().trim_end_matches('/')).map_err(|e| e.to_string())
}

/// Must match `CaptureIPC.socketURL` in `native-capture/Sources/BkemoCapture/IPCServer.swift`.
fn socket_path() -> Option<PathBuf> {
    let home = std::env::var_os("HOME")?;
    Some(
        PathBuf::from(home)
            .join("Library/Application Support/me.hax429.bk")
            .join("capture.sock"),
    )
}

/// Packaged builds resolve the helper from inside the app bundle
/// (`Contents/Resources/BkemoCapture.app`, embedded by `build_macos.sh`).
/// Debug builds fall back to the raw `native-capture/.build/<config>-app/`
/// output next to the source tree so `cargo tauri dev` works without
/// packaging first; release builds never take that fallback.
fn helper_executable_path<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    if let Ok(resources) = app.path().resource_dir() {
        let bundled = resources.join("BkemoCapture.app/Contents/MacOS/BkemoCapture");
        if bundled.is_file() { return Some(bundled); }
    }
    if !cfg!(debug_assertions) { return None; }
    let manifest_dir = env!("CARGO_MANIFEST_DIR");
    for config in ["debug", "release"] {
        let candidate = PathBuf::from(manifest_dir)
            .join("native-capture/.build")
            .join(format!("{config}-app"))
            .join("BkemoCapture.app/Contents/MacOS/BkemoCapture");
        if candidate.exists() {
            return Some(candidate);
        }
    }
    None
}

static HELPER_CHILD: Mutex<Option<Child>> = Mutex::new(None);

fn is_helper_running() -> bool {
    let Some(path) = socket_path() else { return false };
    UnixStream::connect(&path).is_ok()
}

/// Spawns the helper if it isn't already listening. Safe to call more than
/// once (e.g. on every setup) — a no-op when it's already up.
pub fn spawn_helper_if_needed<R: Runtime>(app: &AppHandle<R>) {
    if is_helper_running() {
        return;
    }
    let Some(exe) = helper_executable_path(app) else {
        eprintln!(
            "[native-capture] helper not built yet — run out/macos/native-capture/build.sh"
        );
        return;
    };
    match Command::new(&exe).spawn() {
        Ok(child) => {
            println!("[native-capture] launched helper: {}", exe.display());
            *HELPER_CHILD.lock().unwrap() = Some(child);
        }
        Err(error) => {
            eprintln!("[native-capture] failed to launch helper: {error}");
        }
    }
}

/// Kills the helper this process spawned. Called on Tauri `RunEvent::Exit` so
/// capture stays tied to the main app's lifetime (no login item, no
/// independent background agent — see the locked decisions in mac.md).
pub fn terminate_helper() {
    if let Ok(mut guard) = HELPER_CHILD.lock() {
        if let Some(mut child) = guard.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

fn send_command<R: Runtime>(app: &AppHandle<R>, cmd: &'static str, section: Option<String>) {
    let token = load_session_token().ok().flatten();
    let Some(path) = socket_path() else { return };
    let app = app.clone();
    // Entirely on a background thread — including the "is it even running"
    // fallback — so a ⌃W press never blocks on I/O. A previous version
    // called `spawn_helper_if_needed` synchronously here on *every* press,
    // which meant every ⌃W did a blocking socket connect on the
    // hotkey-dispatch thread before the real send even started. That was
    // the dominant source of felt latency, not the IPC hop itself.
    std::thread::spawn(move || {
        let payload = json!({ "cmd": cmd, "token": token, "endpoint": endpoint(), "section": section }).to_string();
        for attempt in 0..50 {
            match UnixStream::connect(&path) {
                Ok(mut stream) => {
                    let _ = stream.write_all(payload.as_bytes());
                    let _ = stream.write_all(b"\n");
                    return;
                }
                Err(_) if attempt < 49 => {
                    if attempt == 0 { spawn_helper_if_needed(&app); }
                    std::thread::sleep(Duration::from_millis(20));
                }
                Err(error) => {
                    eprintln!("[native-capture] failed to reach helper after retries: {error}");
                    spawn_helper_if_needed(&app);
                }
            }
        }
    });
}

/// ⌃W: toggle — a second press hides the panel while preserving the draft.
pub fn send_toggle<R: Runtime>(app: &AppHandle<R>) {
    send_command(app, "toggle", None);
}

/// Tray "Quick Note": always show, never hide (matches the old
/// `show_quicknote_window` semantics).
pub fn send_show<R: Runtime>(app: &AppHandle<R>) {
    send_command(app, "show", None);
}

pub fn send_settings<R: Runtime>(app: &AppHandle<R>, section: Option<String>) {
    send_command(app, "settings", section);
}
pub fn send_session<R: Runtime>(app: &AppHandle<R>) { send_command(app, "session", None); }
