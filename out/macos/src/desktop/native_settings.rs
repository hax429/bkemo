//! Local OS settings stay in Rust; SwiftUI is the presentation layer.
use std::{fs, io::{BufRead, BufReader, Write}, os::unix::{fs::PermissionsExt, net::UnixListener}, path::PathBuf, sync::mpsc, time::Duration};
use serde::{Serialize, Deserialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_autostart::ManagerExt;
use super::{register_hotkey, unregister_hotkey, set_tray_visible, setup_text_selection_monitoring};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct NativeDesktopSettings {
    quick_note: String,
    #[serde(rename = "quickAI")]
    quick_ai: String,
    enabled: bool,
    ai_enabled: bool,
    system_tray_enabled: bool,
    autostart: bool,
    text_selection_toolbar: SelectionSettings,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct SelectionSettings { enabled: bool, trigger_modifier: String }
impl Default for SelectionSettings { fn default() -> Self { Self { enabled: false, trigger_modifier: "shift".into() } } }
impl Default for NativeDesktopSettings {
    fn default() -> Self { Self { quick_note: "Control+W".into(), quick_ai: "Alt+Space".into(), enabled: true, ai_enabled: true, system_tray_enabled: true, autostart: false, text_selection_toolbar: SelectionSettings::default() } }
}
fn directory() -> Result<PathBuf, String> {
    let home = std::env::var_os("HOME").ok_or("Home directory is unavailable")?;
    Ok(PathBuf::from(home).join("Library/Application Support/me.hax429.bk"))
}
fn settings_path() -> Result<PathBuf, String> { Ok(directory()?.join("native-desktop.json")) }
fn read_settings() -> NativeDesktopSettings {
    settings_path().ok().and_then(|path| fs::read(path).ok()).and_then(|data| serde_json::from_slice(&data).ok()).unwrap_or_default()
}
fn validate(settings: &NativeDesktopSettings) -> Result<(), String> {
    use tauri_plugin_global_shortcut::Shortcut;
    let note = settings.quick_note.parse::<Shortcut>().map_err(|e| e.to_string())?;
    let ai = settings.quick_ai.parse::<Shortcut>().map_err(|e| e.to_string())?;
    let main = "Control+Q".parse::<Shortcut>().unwrap();
    if (settings.enabled && note == main) || (settings.ai_enabled && ai == main) || (settings.enabled && settings.ai_enabled && note == ai) {
        return Err("Each enabled shortcut must be different. Control+Q is reserved for the main window.".into());
    }
    if !["shift", "ctrl", "alt", "meta"].contains(&settings.text_selection_toolbar.trigger_modifier.as_str()) { return Err("Unknown selection modifier".into()); }
    Ok(())
}
fn apply(app: &AppHandle, previous: &NativeDesktopSettings, next: &NativeDesktopSettings) -> Result<(), String> {
    let _ = unregister_hotkey(app.clone(), previous.quick_note.clone());
    let _ = unregister_hotkey(app.clone(), previous.quick_ai.clone());
    if next.enabled { register_hotkey(app.clone(), next.quick_note.clone(), "quicknote".into())?; }
    if next.ai_enabled { register_hotkey(app.clone(), next.quick_ai.clone(), "quickai".into())?; }
    set_tray_visible(app.clone(), next.system_tray_enabled || !next.enabled)?;
    setup_text_selection_monitoring(app.clone(), next.text_selection_toolbar.enabled, next.text_selection_toolbar.trigger_modifier.clone())?;
    if next.autostart { app.autolaunch().enable().map_err(|e| e.to_string())?; }
    else { app.autolaunch().disable().map_err(|e| e.to_string())?; }
    Ok(())
}
fn save_settings(app: &AppHandle, mut next: NativeDesktopSettings) -> Result<NativeDesktopSettings, String> {
    validate(&next)?;
    if !next.enabled { next.system_tray_enabled = true; }
    let old = read_settings();
    let path = settings_path()?;
    fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    let temp = path.with_extension("tmp");
    fs::write(&temp, serde_json::to_vec(&next).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    if let Err(error) = apply(app, &old, &next).and_then(|_| fs::rename(&temp, &path).map_err(|e| e.to_string())) {
        let rollback = apply(app, &next, &old);
        let _ = fs::remove_file(temp);
        return Err(match rollback { Ok(()) => error, Err(other) => format!("{error}. Restoring previous shortcuts also failed: {other}") });
    }
    Ok(next)
}
#[tauri::command]
pub fn initialize_native_desktop_settings(app: AppHandle, settings: Value) -> Result<Value, String> {
    if !settings_path()?.exists() {
        let mut settings: NativeDesktopSettings = serde_json::from_value(settings).map_err(|e| e.to_string())?;
        settings.autostart = app.autolaunch().is_enabled().unwrap_or(false);
        save_settings(&app, settings)?;
    }
    serde_json::to_value(read_settings()).map_err(|e| e.to_string())
}
#[tauri::command]
pub fn open_native_settings(app: AppHandle, section: Option<String>) { super::native_capture::send_settings(&app, section); }
#[tauri::command]
pub fn sync_native_session(app: AppHandle) { super::native_capture::send_session(&app); }

fn handle(app: &AppHandle, request: Value) -> Result<Value, String> {
    match request["command"].as_str().unwrap_or("") {
        "desktop.get" => {
            let mut settings = read_settings();
            settings.autostart = app.autolaunch().is_enabled().map_err(|e| e.to_string())?;
            serde_json::to_value(settings).map_err(|e| e.to_string())
        },
        "desktop.save" => serde_json::to_value(save_settings(app, serde_json::from_value(request["input"].clone()).map_err(|e| e.to_string())?)?).map_err(|e| e.to_string()),
        "app.buildInfo" => Ok(crate::build_info()),
        "settings.changed" => { app.emit("native-settings-changed", ()).map_err(|e| e.to_string())?; Ok(json!(true)) },
        "main.show" => {
            if let Some(window) = app.get_webview_window("main") { super::set_dock_visible(app, true); let _ = window.show(); let _ = window.set_focus(); }
            Ok(json!(true))
        },
        _ => Err("Unknown native request".into()),
    }
}
pub fn start_parent_bridge(app: &AppHandle) -> Result<(), String> {
    let path = directory()?.join("native-parent.sock");
    fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
    if path.exists() { fs::remove_file(&path).map_err(|e| e.to_string())?; }
    let listener = UnixListener::bind(&path).map_err(|e| e.to_string())?;
    fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).map_err(|e| e.to_string())?;
    let setup_app = app.clone();
    let app = app.clone();
    // A single bounded request at a time serializes local setting changes.
    std::thread::spawn(move || {
        for connection in listener.incoming() {
            let Ok(mut stream) = connection else { continue };
            let _ = stream.set_read_timeout(Some(Duration::from_secs(3)));
            let _ = stream.set_write_timeout(Some(Duration::from_secs(3)));
            let mut line = String::new();
            use std::io::Read;
            if BufReader::new((&stream).take(65536)).read_line(&mut line).is_err() || !line.ends_with('\n') { continue; }
            let Ok(request) = serde_json::from_str::<Value>(&line) else { continue };
            let (sender, receiver) = mpsc::channel();
            let handle_app = app.clone();
            if app.run_on_main_thread(move || { let _ = sender.send(handle(&handle_app, request)); }).is_err() { continue; }
            let response = match receiver.recv_timeout(Duration::from_secs(4)) {
                Ok(Ok(value)) => json!({"value":value}),
                Ok(Err(error)) => json!({"error":error}),
                Err(_) => json!({"error":"The main app did not respond."}),
            };
            let _ = writeln!(stream, "{response}");
        }
    });
    if settings_path()?.exists() {
        let settings = read_settings();
        if let Err(error) = apply(&setup_app, &settings, &settings) { eprintln!("[native-settings] {error}"); }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn defaults_and_shortcut_collisions() {
        let mut settings = NativeDesktopSettings::default();
        assert!(validate(&settings).is_ok());
        settings.quick_ai = settings.quick_note.clone();
        assert!(validate(&settings).is_err());
        settings.ai_enabled = false;
        assert!(validate(&settings).is_ok());
        settings.quick_note = "Control+Q".into();
        assert!(validate(&settings).is_err());
    }
}
