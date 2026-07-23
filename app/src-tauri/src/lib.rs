#[cfg(not(any(target_os = "android", target_os = "ios")))]
mod desktop;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
use desktop::*;
use tauri::Manager;

// OTA frontend bundle (Phase 8). Compiled on all targets so a desktop build
// type-checks them; only wired into the runtime on mobile (see below).
#[allow(dead_code)]
mod bundle_resolver;
#[allow(dead_code)]
mod bundle_updater;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_upload::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_blinko::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init());

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        builder = builder
            .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
                // Called when a second instance tries to start
                println!("Second instance detected with args: {:?} and cwd: {:?}", args, cwd);

                // Show and focus the existing window
                if let Some(window) = app.get_webview_window("main") {
                    // Show window if it's hidden
                    if let Err(e) = window.show() {
                        eprintln!("Failed to show window: {}", e);
                    }

                    // Unminimize if minimized
                    if let Err(e) = window.unminimize() {
                        eprintln!("Failed to unminimize window: {}", e);
                    }

                    // Bring to front and focus
                    if let Err(e) = window.set_focus() {
                        eprintln!("Failed to focus window: {}", e);
                    }

                    println!("Focused existing Blinko window");
                }
            }))
            .plugin(
                tauri_plugin_global_shortcut::Builder::new()
                    .with_handler(create_global_shortcut_handler())
                    .build()
            );
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        builder
            .invoke_handler(tauri::generate_handler![
                toggle_editor_window,
                set_main_always_on_top,
                is_main_always_on_top,
                start_attachment_drag,
                register_hotkey,
                unregister_hotkey,
                get_registered_shortcuts,
                save_session_token,
                load_session_token,
                clear_session_token,
                set_tray_visible,
                toggle_quicknote_window,
                resize_quicknote_window,
                toggle_quickai_window,
                resize_quickai_window,
                navigate_main_to_ai_with_prompt,
                toggle_quicktool_window,
                hide_quicktool_window,
                setup_text_selection_monitoring,
                copy_to_clipboard,
                test_text_selection,
                check_accessibility_permissions,
                show_quicktool,
                set_desktop_theme,
                set_desktop_colors
            ])
            .setup(|app| {
                #[cfg(not(any(target_os = "android", target_os = "ios")))]
                {
                    use tauri_plugin_autostart::MacosLauncher;

                    let _ = app.handle().plugin(tauri_plugin_autostart::init(
                        MacosLauncher::LaunchAgent,
                        Some(vec!["--autostart"]),
                    ));
                }

                setup_app(app)?;
                Ok(())
            })
            .run(tauri::generate_context!())
            .expect("error while running tauri application");
    }

    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        use std::borrow::Cow;
        use tauri::http::{header::CONTENT_TYPE, Response};

        builder
            // OTA bundle scheme (Phase 8). Registered so downloaded bundles can be
            // served; the window URL still loads `tauri://localhost` (baked baseline)
            // until the one-line flip to `bundle://localhost/index.html` is verified
            // on-device. Serves from the active extracted bundle, falling back to the
            // baked-in baseline asset, then 404.
            .register_uri_scheme_protocol("bundle", |ctx, request| {
                let app = ctx.app_handle();
                let path = request.uri().path().to_string();

                if let Some((bytes, mime)) = bundle_resolver::resolve(app, &path) {
                    return Response::builder()
                        .status(200)
                        .header(CONTENT_TYPE, mime)
                        .body(Cow::<'static, [u8]>::Owned(bytes))
                        .unwrap();
                }

                let norm = bundle_resolver::normalize(&path);
                if let Some(asset) = app.asset_resolver().get(format!("/{norm}")) {
                    return Response::builder()
                        .status(200)
                        .header(CONTENT_TYPE, asset.mime_type)
                        .body(Cow::<'static, [u8]>::Owned(asset.bytes))
                        .unwrap();
                }

                Response::builder()
                    .status(404)
                    .body(Cow::<'static, [u8]>::Owned(Vec::new()))
                    .unwrap()
            })
            .invoke_handler(tauri::generate_handler![])
            .setup(|app| {
                bundle_updater::spawn_update_check(app.handle().clone());
                Ok(())
            })
            .run(tauri::generate_context!())
            .expect("error while running tauri application");
    }
}