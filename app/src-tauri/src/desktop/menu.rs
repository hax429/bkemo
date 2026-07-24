use tauri::{
    menu::{AboutMetadata, MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder},
    AppHandle, Emitter, Manager,
};

use crate::desktop::{set_dock_visible, toggle_editor_window, toggle_quicknote_window};

const SETTINGS_ID: &str = "navigate/settings";
const NEW_NOTE_ID: &str = "file/new-note";
const QUICK_NOTE_ID: &str = "file/quick-note";
const SYNC_NOW_ID: &str = "file/sync-now";
const PRINT_ID: &str = "file/print";
const HIDE_WINDOW_ID: &str = "file/hide-window";
const TOGGLE_MAIN_ID: &str = "file/toggle-main";
const SEARCH_ID: &str = "navigate/search";
const FIND_ID: &str = "navigate/find";
const GRAPH_ID: &str = "navigate/graph";
const CALENDAR_ID: &str = "navigate/calendar";
const FILES_ID: &str = "navigate/files";
const ANALYTICS_ID: &str = "navigate/analytics";
const AI_ID: &str = "navigate/ai";
const HELP_ID: &str = "help/bkemo";
const FORMAT_BOLD_ID: &str = "edit/bold";
const FORMAT_ITALIC_ID: &str = "edit/italic";
const FORMAT_UNDERLINE_ID: &str = "edit/underline";
const FORMAT_HIGHLIGHT_ID: &str = "edit/highlight";
const FORMAT_STRIKE_ID: &str = "edit/strike";
const FORMAT_CODE_ID: &str = "edit/code";
const FORMAT_LINK_ID: &str = "edit/link";

fn route_for_menu_id(id: &str) -> Option<&'static str> {
    match id {
        SETTINGS_ID => Some("/settings"),
        GRAPH_ID => Some("/graph"),
        CALENDAR_ID => Some("/calendar"),
        FILES_ID => Some("/files"),
        ANALYTICS_ID => Some("/analytics"),
        AI_ID => Some("/ai"),
        HELP_ID => Some("/settings/about"),
        _ => None,
    }
}

fn show_main(app: &AppHandle) -> Option<tauri::WebviewWindow> {
    let window = app.get_webview_window("main")?;
    set_dock_visible(app, true);
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
    Some(window)
}

fn show_main_route(app: &AppHandle, route: &str) {
    let Some(window) = show_main(app) else {
        return;
    };
    let _ = window.emit(
        "navigate-to-route",
        serde_json::json!({
            "route": route,
            "replace": true,
            "targetWindow": "main",
        }),
    );
}

fn hide_focused_window(app: &AppHandle) {
    for window in app.webview_windows().values() {
        if window.is_focused().unwrap_or(false) {
            let is_main = window.label() == "main";
            let _ = window.hide();
            if is_main {
                set_dock_visible(app, false);
            }
            return;
        }
    }
}

fn emit_to_focused(app: &AppHandle, event: &str) {
    for window in app.webview_windows().values() {
        if window.is_focused().unwrap_or(false) {
            let _ = window.emit(event, ());
            return;
        }
    }
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.emit(event, ());
    }
}

#[cfg(target_os = "macos")]
pub fn setup_application_menu(app: &AppHandle) -> tauri::Result<()> {
    let settings = MenuItemBuilder::with_id(SETTINGS_ID, "Settings…")
        .accelerator("CmdOrCtrl+,")
        .build(app)?;
    let app_menu = SubmenuBuilder::new(app, "bkemo")
        .about(Some(AboutMetadata::default()))
        .separator()
        .item(&settings)
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;

    let new_note = MenuItemBuilder::with_id(NEW_NOTE_ID, "New Note")
        .accelerator("CmdOrCtrl+N")
        .build(app)?;
    let quick_note = MenuItemBuilder::with_id(QUICK_NOTE_ID, "Quick Note")
        .accelerator("Ctrl+W")
        .build(app)?;
    let sync_now = MenuItemBuilder::with_id(SYNC_NOW_ID, "Sync Now")
        .accelerator("CmdOrCtrl+Shift+R")
        .build(app)?;
    let print = MenuItemBuilder::with_id(PRINT_ID, "Print…")
        .accelerator("CmdOrCtrl+P")
        .build(app)?;
    let hide_window = MenuItemBuilder::with_id(HIDE_WINDOW_ID, "Close Window")
        .accelerator("CmdOrCtrl+W")
        .build(app)?;
    let toggle_main = MenuItemBuilder::with_id(TOGGLE_MAIN_ID, "Show/Hide Main Window")
        .accelerator("Ctrl+Q")
        .build(app)?;
    let file_menu = SubmenuBuilder::new(app, "File")
        .items(&[&new_note, &quick_note])
        .separator()
        .item(&sync_now)
        .item(&print)
        .separator()
        .item(&toggle_main)
        .item(&hide_window)
        .build()?;

    let bold = MenuItemBuilder::with_id(FORMAT_BOLD_ID, "Bold")
        .accelerator("CmdOrCtrl+B")
        .build(app)?;
    let italic = MenuItemBuilder::with_id(FORMAT_ITALIC_ID, "Italic")
        .accelerator("CmdOrCtrl+I")
        .build(app)?;
    let underline = MenuItemBuilder::with_id(FORMAT_UNDERLINE_ID, "Underline")
        .accelerator("CmdOrCtrl+U")
        .build(app)?;
    let highlight = MenuItemBuilder::with_id(FORMAT_HIGHLIGHT_ID, "Highlight")
        .accelerator("CmdOrCtrl+Shift+H")
        .build(app)?;
    let strike = MenuItemBuilder::with_id(FORMAT_STRIKE_ID, "Strikethrough")
        .accelerator("CmdOrCtrl+Shift+X")
        .build(app)?;
    let code = MenuItemBuilder::with_id(FORMAT_CODE_ID, "Code")
        .accelerator("CmdOrCtrl+E")
        .build(app)?;
    let link = MenuItemBuilder::with_id(FORMAT_LINK_ID, "Link…")
        .accelerator("CmdOrCtrl+Shift+K")
        .build(app)?;
    let edit_sep_1 = PredefinedMenuItem::separator(app)?;
    let edit_sep_2 = PredefinedMenuItem::separator(app)?;
    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .item(&edit_sep_1)
        .cut()
        .copy()
        .paste()
        .select_all()
        .item(&edit_sep_2)
        .items(&[&bold, &italic, &underline, &highlight, &strike, &code, &link])
        .build()?;

    let search = MenuItemBuilder::with_id(SEARCH_ID, "Search…")
        .accelerator("CmdOrCtrl+K")
        .build(app)?;
    let find = MenuItemBuilder::with_id(FIND_ID, "Find…")
        .accelerator("CmdOrCtrl+F")
        .build(app)?;
    let graph = MenuItemBuilder::with_id(GRAPH_ID, "Graph").build(app)?;
    let calendar = MenuItemBuilder::with_id(CALENDAR_ID, "Calendar").build(app)?;
    let files = MenuItemBuilder::with_id(FILES_ID, "Files").build(app)?;
    let analytics = MenuItemBuilder::with_id(ANALYTICS_ID, "Analytics").build(app)?;
    let ai = MenuItemBuilder::with_id(AI_ID, "AI").build(app)?;
    let navigate_menu = SubmenuBuilder::new(app, "Navigate")
        .items(&[&search, &find])
        .separator()
        .items(&[&graph, &calendar, &files, &analytics, &ai])
        .build()?;

    let help = MenuItemBuilder::with_id(HELP_ID, "bkemo Help").build(app)?;
    let help_menu = SubmenuBuilder::new(app, "Help").item(&help).build()?;

    let menu = MenuBuilder::new(app)
        .items(&[
            &app_menu,
            &file_menu,
            &edit_menu,
            &navigate_menu,
            &help_menu,
        ])
        .build()?;
    app.set_menu(menu)?;

    app.on_menu_event(|app, event| match event.id().as_ref() {
        NEW_NOTE_ID => {
            if let Some(window) = show_main(app) {
                let _ = window.emit("native-new-note", ());
            }
        }
        QUICK_NOTE_ID => {
            let _ = toggle_quicknote_window(app.clone());
        }
        SYNC_NOW_ID => {
            if let Some(window) = show_main(app) {
                let _ = window.emit("native-sync", ());
            }
        }
        PRINT_ID => emit_to_focused(app, "native-print"),
        TOGGLE_MAIN_ID => {
            let _ = toggle_editor_window(app.clone());
        }
        HIDE_WINDOW_ID => hide_focused_window(app),
        SEARCH_ID | FIND_ID => {
            if let Some(window) = show_main(app) {
                let _ = window.emit("native-search", ());
            }
        }
        FORMAT_BOLD_ID => emit_to_focused(app, "native-format-bold"),
        FORMAT_ITALIC_ID => emit_to_focused(app, "native-format-italic"),
        FORMAT_UNDERLINE_ID => emit_to_focused(app, "native-format-underline"),
        FORMAT_HIGHLIGHT_ID => emit_to_focused(app, "native-format-highlight"),
        FORMAT_STRIKE_ID => emit_to_focused(app, "native-format-strike"),
        FORMAT_CODE_ID => emit_to_focused(app, "native-format-code"),
        FORMAT_LINK_ID => emit_to_focused(app, "native-format-link"),
        id => {
            if let Some(route) = route_for_menu_id(id) {
                show_main_route(app, route);
            }
        }
    });

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::route_for_menu_id;

    #[test]
    fn navigation_menu_ids_map_to_bkemo_routes() {
        assert_eq!(route_for_menu_id("navigate/settings"), Some("/settings"));
        assert_eq!(route_for_menu_id("navigate/graph"), Some("/graph"));
        assert_eq!(route_for_menu_id("navigate/calendar"), Some("/calendar"));
        assert_eq!(route_for_menu_id("navigate/files"), Some("/files"));
        assert_eq!(route_for_menu_id("navigate/analytics"), Some("/analytics"));
        assert_eq!(route_for_menu_id("navigate/ai"), Some("/ai"));
        assert_eq!(route_for_menu_id("help/bkemo"), Some("/settings/about"));
        assert_eq!(route_for_menu_id("unrelated"), None);
    }
}
