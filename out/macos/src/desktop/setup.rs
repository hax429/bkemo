use tauri::{AppHandle, Manager};

#[cfg(not(any(target_os = "android", target_os = "ios")))]
use tauri_plugin_global_shortcut::{ShortcutEvent, ShortcutState};

use crate::desktop::{
    configure_quicknote_panel, restore_main_window_state, setup_system_tray,
    setup_window_state_monitoring, set_dock_visible, start_capture_queue, toggle_editor_window,
    toggle_quickai_window, toggle_quicktool_window, HotkeyConfig,
};
#[cfg(not(target_os = "macos"))]
use crate::desktop::toggle_quicknote_window;
#[cfg(target_os = "macos")]
use crate::desktop::setup_application_menu;
#[cfg(target_os = "macos")]
use crate::desktop::{send_toggle, spawn_helper_if_needed};

pub fn setup_app(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let app_handle = app.handle();
    let main_window = app.get_webview_window("main").unwrap();

    #[cfg(target_os = "macos")]
    {
        use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial};
        let _ = apply_vibrancy(&main_window, NSVisualEffectMaterial::Sidebar, None, Some(12.0));
    }

    // Check if launched via autostart
    let args: Vec<String> = std::env::args().collect();
    let is_autostart = args.iter().any(|arg| arg == "--autostart");

    if is_autostart {
        println!("Application launched via autostart, hiding window to tray");
        // Hide window immediately on autostart
        let _ = main_window.hide();
        set_dock_visible(&app_handle, false);
    } else {
        println!("Application launched normally");
        set_dock_visible(&app_handle, true);
        // Restore window state before applying decorations only for normal launches
        restore_main_window_state(&app_handle);
    }

    // Setup window state monitoring
    setup_window_state_monitoring(&app_handle);

    #[cfg(target_os = "macos")]
    setup_application_menu(&app_handle)?;

    if let Some(quicknote) = app_handle.get_webview_window("quicknote") {
        configure_quicknote_panel(&quicknote);
    }
    start_capture_queue(&app_handle);

    // Native SwiftUI quick-capture helper (macOS only) — see native_capture.rs
    // and docs/plans/mac.md. Kept warm for as long as this app runs; ⌃W and
    // the tray route to it instead of the "quicknote" webview above.

    // Set window close event handler to hide to tray instead of exit
    let window = main_window.clone();
    let close_app_handle = app_handle.clone();
    main_window.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            // Prevent window close
            api.prevent_close();
            // Hide window to tray
            let _ = window.hide();
            set_dock_visible(&close_app_handle, false);
            println!("Window hidden to tray");
        }
    });

    // Setup system tray for desktop platforms (shortcuts will be registered by frontend)
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        let default_config = HotkeyConfig::default();
        
        // Setup system tray
        if default_config.system_tray_enabled {
            if let Err(e) = setup_system_tray(&app_handle) {
                eprintln!("Failed to setup system tray: {}", e);
            } else {
                println!("System tray setup successfully");
            }
        }
        
        // Note: Shortcuts will be registered when frontend loads user configuration
        // This prevents conflicts between default and user-configured shortcuts
        println!("Waiting for frontend to register shortcuts based on user configuration...");

        
    }

    #[cfg(target_os = "macos")]
    {
        crate::desktop::native_settings::start_parent_bridge(&app_handle)?;
        spawn_helper_if_needed(&app_handle);
    }

    Ok(())
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn shortcuts_match(actual: &str, registered: &str) -> bool {
    // Normalize both shortcuts for comparison
    let normalize = |s: &str| -> String {
        let mut normalized = s.to_lowercase();
        
        // Handle CommandOrControl -> control mapping
        normalized = normalized.replace("commandorcontrol", "control");
        
        // Remove "key" prefix from key names (control+KeyG -> control+g)
        normalized = normalized.replace("key", "");
        
        // Ensure consistent casing for modifiers
        normalized = normalized.replace("shift+", "shift+");
        normalized = normalized.replace("control+", "control+");
        normalized = normalized.replace("alt+", "alt+");
        normalized = normalized.replace("cmd+", "control+");
        normalized = normalized.replace("command+", "control+");
        
        // Sort modifiers to ensure consistent order
        let parts: Vec<&str> = normalized.split('+').collect();
        if parts.len() > 1 {
            let mut modifiers: Vec<&str> = parts[..parts.len()-1].to_vec();
            let key = parts[parts.len()-1];
            modifiers.sort();
            format!("{}+{}", modifiers.join("+"), key)
        } else {
            normalized
        }
    };
    
    let normalized_actual = normalize(actual);
    let normalized_registered = normalize(registered);
    
    println!("Shortcut match comparison: '{}' (from '{}') == '{}' (from '{}') -> {}", 
             normalized_actual, actual, normalized_registered, registered,
             normalized_actual == normalized_registered);
    
    normalized_actual == normalized_registered
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn dispatch_shortcut_command(app: &AppHandle<tauri::Wry>, command: &str) -> bool {
    match command {
        "quicknote" => {
            #[cfg(target_os = "macos")]
            {
                send_toggle(app);
            }
            #[cfg(not(target_os = "macos"))]
            {
                let _ = toggle_quicknote_window(app.clone());
            }
            true
        }
        "quickai" => {
            let _ = toggle_quickai_window(app.clone());
            true
        }
        "quicktool" => {
            let _ = toggle_quicktool_window(app.clone());
            true
        }
        "toggle-main" => {
            let _ = toggle_editor_window(app.clone());
            true
        }
        "text-selection" => {
            crate::desktop::handle_text_selection(app);
            true
        }
        _ => false,
    }
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn maybe_handle_text_selection_chord(app: &AppHandle<tauri::Wry>, shortcut_str: &str) -> bool {
    let is_backtick = shortcut_str.contains('`')
        || shortcut_str.contains("Backquote")
        || shortcut_str.contains("Grave");
    if !is_backtick {
        return false;
    }

    let modifier = if shortcut_str.contains("Control") {
        "ctrl"
    } else if shortcut_str.contains("Shift") {
        "shift"
    } else if shortcut_str.contains("Alt") {
        "alt"
    } else {
        return false;
    };

    if crate::desktop::is_text_selection_enabled_for(modifier) {
        crate::desktop::handle_text_selection(app);
        return true;
    }
    false
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub fn create_global_shortcut_handler() -> impl Fn(&AppHandle<tauri::Wry>, &tauri_plugin_global_shortcut::Shortcut, ShortcutEvent) + Send + Sync + 'static {
    move |app, shortcut, event| {
        if event.state != ShortcutState::Pressed {
            return;
        }

        let shortcut_str = shortcut.to_string();
        let shortcuts_map = crate::desktop::get_registered_shortcuts();

        // Capture first: look up the registered command before any other work.
        if let Some(command) = shortcuts_map.get(&shortcut_str.to_lowercase()) {
            if dispatch_shortcut_command(app, command) {
                return;
            }
        }

        if maybe_handle_text_selection_chord(app, &shortcut_str) {
            return;
        }

        for (registered_shortcut, command) in shortcuts_map.iter() {
            if shortcuts_match(&shortcut_str, registered_shortcut)
                && dispatch_shortcut_command(app, command)
            {
                return;
            }
        }
    }
}