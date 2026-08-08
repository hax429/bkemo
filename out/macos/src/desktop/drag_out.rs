//! Native drag-out of attachment files to Finder / other apps (desktop only).

use tauri::{AppHandle, Runtime, WebviewWindow};

/// Download `url` into a temp file named `filename`, then start a native file drag.
#[tauri::command]
pub async fn start_attachment_drag<R: Runtime>(
    app: AppHandle<R>,
    window: WebviewWindow<R>,
    url: String,
    filename: String,
    token: Option<String>,
) -> Result<(), String> {
    use drag::{DragItem, Image, start_drag};
    use std::io::Write;

    let safe_name = filename
        .chars()
        .map(|c| if matches!(c, '/' | '\\' | ':' | '\0') { '_' } else { c })
        .collect::<String>();
    let safe_name = if safe_name.is_empty() {
        "attachment".to_string()
    } else {
        safe_name
    };

    let mut request = reqwest::Client::new().get(&url);
    if let Some(token) = token.as_deref().filter(|t| !t.is_empty()) {
        request = request.bearer_auth(token);
    }
    let bytes = request
        .send()
        .await
        .map_err(|e| format!("download failed: {e}"))?
        .error_for_status()
        .map_err(|e| format!("download HTTP error: {e}"))?
        .bytes()
        .await
        .map_err(|e| format!("download body: {e}"))?;

    let dir = std::env::temp_dir().join("bkemo-drag");
    std::fs::create_dir_all(&dir).map_err(|e| format!("temp dir: {e}"))?;
    let path = dir.join(&safe_name);
    {
        let mut file = std::fs::File::create(&path).map_err(|e| format!("temp file: {e}"))?;
        file.write_all(&bytes).map_err(|e| format!("temp write: {e}"))?;
    }

    let path = std::fs::canonicalize(&path).unwrap_or(path);
    let paths = vec![path];
    // 1×1 transparent PNG — drag preview; empty Raw can fail ImageNotFound on some hosts.
    let preview = Image::Raw(vec![
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
        0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4,
        0x89, 0x00, 0x00, 0x00, 0x0A, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9C, 0x63, 0x00, 0x01, 0x00, 0x00,
        0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE,
        0x42, 0x60, 0x82,
    ]);
    start_drag(
        &window,
        DragItem::Files(paths),
        preview,
        |result, _cursor| {
            println!("attachment drag finished: {:?}", result);
        },
        Default::default(),
    )
    .map_err(|e| format!("start_drag failed: {e}"))?;
    let _ = app;
    Ok(())
}
