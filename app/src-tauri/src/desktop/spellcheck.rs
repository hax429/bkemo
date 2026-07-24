/**
 * macOS WKWebView reads `WebContinuousSpellCheckingEnabled` from the app's
 * NSUserDefaults the first time it spell-checks. Without an Edit → Spelling
 * menu toggle (and for many apps this defaults off), contenteditable never
 * shows red underlines even with HTML spellcheck="true".
 *
 * Bundle id: me.hax429.bk (tauri.conf.json).
 */
#[cfg(target_os = "macos")]
pub fn enable_webview_spellcheck() {
    let status = std::process::Command::new("defaults")
        .args([
            "write",
            "me.hax429.bk",
            "WebContinuousSpellCheckingEnabled",
            "-bool",
            "true",
        ])
        .status();
    match status {
        Ok(s) if s.success() => {
            println!("Enabled WebContinuousSpellCheckingEnabled for me.hax429.bk");
        }
        Ok(s) => eprintln!("defaults write spellcheck exited: {s}"),
        Err(e) => eprintln!("Failed to enable webview spellcheck: {e}"),
    }
}

#[cfg(not(target_os = "macos"))]
pub fn enable_webview_spellcheck() {}
