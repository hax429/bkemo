//! Instant NSPanel-style show/hide for the macOS quick-capture window.
#![allow(unexpected_cfgs)]
//!
//! Tauri's default show/hide can fade the window and activate the whole app
//! before the editor is ready. This path disables window animation, orders the
//! already-mounted webview front, and focuses TipTap without waiting for JS
//! event listeners.

use tauri::{Emitter, Runtime, WebviewWindow};

#[cfg(target_os = "macos")]
use objc::runtime::{Object, BOOL, NO, YES};
#[cfg(target_os = "macos")]
use objc::{class, msg_send, sel, sel_impl};

#[cfg(target_os = "macos")]
type Id = *mut Object;

#[cfg(target_os = "macos")]
const NIL: Id = std::ptr::null_mut();

/// `NSWindowAnimationBehaviorNone` — snap in/out, no fade.
#[cfg(target_os = "macos")]
const ANIMATION_NONE: i64 = 2;

/// CanJoinAllSpaces | Transient | IgnoresCycle | FullScreenAuxiliary
///
/// `CanJoinAllSpaces` and `MoveToActiveSpace` are mutually exclusive per
/// Apple's docs — combining them makes `setCollectionBehavior:` throw
/// `NSInvalidArgumentException` (crashes the app on launch since that
/// exception unwinds into Rust code that cannot catch it).
#[cfg(target_os = "macos")]
const CAPTURE_COLLECTION: u64 = 1 | 8 | 64 | 256;

#[cfg(target_os = "macos")]
const FLOATING_LEVEL: i64 = 3;

const FOCUS_JS: &str = r#"(function () {
  var root = document.getElementById('quicknote-editor');
  var el = root && root.querySelector('[contenteditable="true"], textarea');
  if (el) el.focus();
})()"#;

#[cfg(target_os = "macos")]
fn ns_window<R: Runtime>(window: &WebviewWindow<R>) -> Option<Id> {
    window.ns_window().ok().map(|ptr| ptr as Id)
}

pub fn configure_quicknote_panel<R: Runtime>(window: &WebviewWindow<R>) {
    let _ = window.set_skip_taskbar(true);
    let _ = window.set_always_on_top(true);
    let _ = window.set_visible_on_all_workspaces(true);

    #[cfg(target_os = "macos")]
    if let Some(ns) = ns_window(window) {
        unsafe {
            let _: () = msg_send![ns, setAnimationBehavior: ANIMATION_NONE];
            let _: () = msg_send![ns, setCollectionBehavior: CAPTURE_COLLECTION];
            let _: () = msg_send![ns, setLevel: FLOATING_LEVEL];
            let _: () = msg_send![ns, setHidesOnDeactivate: NO];
            let _: () = msg_send![ns, setReleasedWhenClosed: NO];
        }
    }
}

pub fn is_quicknote_visible<R: Runtime>(window: &WebviewWindow<R>) -> bool {
    #[cfg(target_os = "macos")]
    if let Some(ns) = ns_window(window) {
        let visible: BOOL = unsafe { msg_send![ns, isVisible] };
        return visible == YES;
    }
    window.is_visible().unwrap_or(false)
}

pub fn show_quicknote_panel<R: Runtime>(window: &WebviewWindow<R>) {
    configure_quicknote_panel(window);

    #[cfg(target_os = "macos")]
    if let Some(ns) = ns_window(window) {
        unsafe {
            // Paint first, then take keyboard. Activation is the slow part.
            let _: () = msg_send![ns, orderFrontRegardless];
            let app: Id = msg_send![class!(NSApplication), sharedApplication];
            let _: BOOL = msg_send![app, activateIgnoringOtherApps: YES];
            let _: () = msg_send![ns, makeKeyAndOrderFront: NIL];
        }
        let _ = window.eval(FOCUS_JS);
        let _ = window.emit("quicknote-shortcut", ());
        return;
    }

    let _ = window.show();
    let _ = window.set_focus();
    let _ = window.eval(FOCUS_JS);
    let _ = window.emit("quicknote-shortcut", ());
}

pub fn hide_quicknote_panel<R: Runtime>(window: &WebviewWindow<R>) {
    #[cfg(target_os = "macos")]
    if let Some(ns) = ns_window(window) {
        unsafe {
            let _: () = msg_send![ns, orderOut: NIL];
        }
        return;
    }
    let _ = window.hide();
}
