use tauri::{AppHandle, command, Runtime};

use crate::models::*;
use crate::Result;
use crate::BlinkoExt;

#[command]
pub(crate) async fn setcolor<R: Runtime>(
    app: AppHandle<R>,
    payload: SetColorRequest,
) -> Result<()> {
    app.blinko().setcolor(payload)
}

#[command]
pub(crate) async fn open_app_settings<R: Runtime>(
    app: AppHandle<R>,
) -> Result<()> {
    app.blinko().open_app_settings()
}

#[command]
pub(crate) async fn share_file<R: Runtime>(
    app: AppHandle<R>,
    payload: ShareFileRequest,
) -> Result<()> {
    app.blinko().share_file(payload)
}