//! Background quick-capture upload.
//!
//! Done hides the panel immediately. This queue persists the note to disk and
//! POSTs `draft.finalize` from a Tauri async task so the webview does not have
//! to stay visible (or even scheduled) for the save to finish.

use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, Runtime};

use super::keychain::load_session_token;
use super::window::hide_quicknote_window;

const QUEUE_FILE: &str = "quicknote-capture-queue.json";
const MAX_BACKOFF_SECS: u64 = 300;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureAttachment {
    pub name: String,
    pub path: String,
    pub size: serde_json::Value,
    #[serde(rename = "type")]
    pub content_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureJob {
    #[serde(default)]
    pub id: String,
    pub endpoint: String,
    pub content: String,
    #[serde(rename = "type")]
    pub note_type: i32,
    #[serde(default)]
    pub is_important: bool,
    #[serde(default)]
    pub is_urgent: bool,
    #[serde(default)]
    pub due_date: Option<String>,
    #[serde(default)]
    pub reference_ids: Vec<i64>,
    #[serde(default)]
    pub attachments: Vec<CaptureAttachment>,
    #[serde(default)]
    pub attempts: u32,
}

static DRAIN_LOCK: Mutex<()> = Mutex::new(());

pub fn finalize_url(endpoint: &str) -> String {
    let base = endpoint.trim().trim_end_matches('/');
    format!("{base}/api/trpc/draft.finalize")
}

pub fn finalize_body(job: &CaptureJob) -> Value {
    json!({
        "json": {
            "content": job.content,
            "type": job.note_type,
            "isImportant": job.is_important,
            "isUrgent": job.is_urgent,
            "dueDate": job.due_date,
            "referenceIds": job.reference_ids,
            "attachments": job.attachments.iter().map(|attachment| json!({
                "name": attachment.name,
                "path": attachment.path,
                "size": attachment.size,
                "type": attachment.content_type,
            })).collect::<Vec<_>>(),
        }
    })
}

fn queue_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("app data dir: {error}"))?;
    std::fs::create_dir_all(&dir).map_err(|error| format!("create app data dir: {error}"))?;
    Ok(dir.join(QUEUE_FILE))
}

fn read_queue(path: &PathBuf) -> Vec<CaptureJob> {
    let Ok(bytes) = std::fs::read(path) else {
        return Vec::new();
    };
    serde_json::from_slice(&bytes).unwrap_or_default()
}

fn write_queue(path: &PathBuf, jobs: &[CaptureJob]) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(jobs).map_err(|error| error.to_string())?;
    std::fs::write(path, bytes).map_err(|error| format!("write capture queue: {error}"))
}

fn with_queue<R: Runtime>(
    app: &AppHandle<R>,
    mutate: impl FnOnce(&mut Vec<CaptureJob>),
) -> Result<Vec<CaptureJob>, String> {
    let _guard = DRAIN_LOCK
        .lock()
        .map_err(|_| "capture queue lock poisoned".to_string())?;
    let path = queue_path(app)?;
    let mut jobs = read_queue(&path);
    mutate(&mut jobs);
    write_queue(&path, &jobs)?;
    Ok(jobs)
}

fn enqueue<R: Runtime>(app: &AppHandle<R>, mut job: CaptureJob) -> Result<(), String> {
    if job.id.is_empty() {
        job.id = format!(
            "qn-{}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis())
                .unwrap_or(0),
            job.content.len()
        );
    }
    with_queue(app, |jobs| jobs.push(job))?;
    Ok(())
}

fn remove_job<R: Runtime>(app: &AppHandle<R>, id: &str) {
    let _ = with_queue(app, |jobs| jobs.retain(|job| job.id != id));
}

fn bump_attempt<R: Runtime>(app: &AppHandle<R>, id: &str) -> u32 {
    let mut attempts = 0;
    let _ = with_queue(app, |jobs| {
        if let Some(job) = jobs.iter_mut().find(|job| job.id == id) {
            job.attempts = job.attempts.saturating_add(1);
            attempts = job.attempts;
        }
    });
    attempts
}

fn extract_note(value: &Value) -> Option<Value> {
    value
        .pointer("/result/data/json/note")
        .or_else(|| value.pointer("/result/data/note"))
        .or_else(|| value.pointer("/note"))
        .cloned()
}

async fn post_finalize(job: &CaptureJob, token: &str) -> Result<Value, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|error| error.to_string())?;
    let response = client
        .post(finalize_url(&job.endpoint))
        .header("Content-Type", "application/json")
        .header("Authorization", format!("Bearer {token}"))
        .header("x-bkemo-platform", "macos")
        .json(&finalize_body(job))
        .send()
        .await
        .map_err(|error| error.to_string())?;
    let status = response.status();
    let body = response
        .json::<Value>()
        .await
        .map_err(|error| format!("decode finalize response: {error}"))?;
    if !status.is_success() {
        return Err(format!("finalize HTTP {status}: {body}"));
    }
    if body.get("error").is_some() {
        return Err(format!("finalize rejected: {body}"));
    }
    extract_note(&body).ok_or_else(|| format!("finalize returned no note: {body}"))
}

fn backoff_for(attempts: u32) -> Duration {
    let secs = 1u64
        .checked_shl(attempts.min(8))
        .unwrap_or(MAX_BACKOFF_SECS)
        .min(MAX_BACKOFF_SECS);
    Duration::from_secs(secs)
}

fn spawn_drain<R: Runtime>(app: AppHandle<R>) {
    tauri::async_runtime::spawn(async move {
        loop {
            let path = match queue_path(&app) {
                Ok(path) => path,
                Err(error) => {
                    eprintln!("[capture-queue] {error}");
                    return;
                }
            };
            let job = {
                let _guard = match DRAIN_LOCK.lock() {
                    Ok(guard) => guard,
                    Err(_) => return,
                };
                read_queue(&path).into_iter().next()
            };
            let Some(job) = job else {
                return;
            };

            let token = match load_session_token() {
                Ok(Some(token)) => token,
                Ok(None) => {
                    eprintln!("[capture-queue] no session token; will retry");
                    tokio::time::sleep(backoff_for(job.attempts.max(1))).await;
                    continue;
                }
                Err(error) => {
                    eprintln!("[capture-queue] keychain: {error}");
                    tokio::time::sleep(backoff_for(job.attempts.max(1))).await;
                    continue;
                }
            };

            match post_finalize(&job, &token).await {
                Ok(note) => {
                    remove_job(&app, &job.id);
                    let _ = app.emit("native-note-changed", note);
                }
                Err(error) => {
                    let attempts = bump_attempt(&app, &job.id);
                    eprintln!("[capture-queue] attempt {attempts} failed: {error}");
                    tokio::time::sleep(backoff_for(attempts)).await;
                }
            }
        }
    });
}

/// Hide the capture panel first, then persist + upload the note in the background.
#[tauri::command]
pub fn queue_quicknote_capture<R: Runtime>(
    app: AppHandle<R>,
    job: CaptureJob,
) -> Result<(), String> {
    let _ = hide_quicknote_window(app.clone());
    enqueue(&app, job)?;
    spawn_drain(app);
    Ok(())
}

pub fn start_capture_queue<R: Runtime>(app: &AppHandle<R>) {
    spawn_drain(app.clone());
}

#[cfg(test)]
mod tests {
    use super::{finalize_body, finalize_url, CaptureAttachment, CaptureJob};
    use serde_json::json;

    fn sample_job() -> CaptureJob {
        CaptureJob {
            id: "qn-1".into(),
            endpoint: "https://bk.hax429.me/".into(),
            content: "hello [[memo]](/n/9)".into(),
            note_type: 0,
            is_important: true,
            is_urgent: false,
            due_date: None,
            reference_ids: vec![9],
            attachments: vec![CaptureAttachment {
                name: "a.png".into(),
                path: "/files/a.png".into(),
                size: json!(12),
                content_type: "image/png".into(),
            }],
            attempts: 0,
        }
    }

    #[test]
    fn finalize_url_strips_trailing_slash() {
        assert_eq!(
            finalize_url("https://bk.hax429.me/"),
            "https://bk.hax429.me/api/trpc/draft.finalize"
        );
    }

    #[test]
    fn finalize_body_matches_trpc_json_envelope() {
        let body = finalize_body(&sample_job());
        assert_eq!(body["json"]["content"], "hello [[memo]](/n/9)");
        assert_eq!(body["json"]["type"], 0);
        assert_eq!(body["json"]["isImportant"], true);
        assert_eq!(body["json"]["referenceIds"][0], 9);
        assert_eq!(body["json"]["attachments"][0]["path"], "/files/a.png");
        assert_eq!(body["json"]["attachments"][0]["type"], "image/png");
    }
}
