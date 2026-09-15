//! Download / verify / delete on-device ASR models (docs/SPEC.md 7.6). Models are
//! fetched file by file (encoder / decoder / joiner / tokens) so no archive
//! extraction is needed. Every file has a known size and SHA-256 (manifest in
//! src/core/asrModels.ts): a download is only "ready" when both match, and
//! `models_check` / `models_verify` re-check what is on disk (release audit B05).
//! Downloads are registered per model id so the same model cannot be fetched
//! twice at once, and they can be cancelled (audit B06).

use std::collections::HashMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures_util::StreamExt;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, State};

pub const EVT_PROGRESS: &str = "models://progress";

#[derive(serde::Deserialize, Clone)]
pub struct ModelFile {
    pub url: String,
    pub name: String,
    pub sha256: Option<String>,
    pub size_bytes: Option<u64>,
}

/// What `models_check` / `models_verify` look at: name plus the expected size / digest.
#[derive(serde::Deserialize, Clone)]
pub struct ExpectedFile {
    pub name: String,
    pub size_bytes: Option<u64>,
    pub sha256: Option<String>,
}

/// Model ids currently downloading, each with its cancel flag.
#[derive(Default)]
pub struct ActiveDownloads(pub Mutex<HashMap<String, Arc<AtomicBool>>>);

#[derive(serde::Serialize, Clone)]
struct ProgressPayload<'a> {
    id: &'a str,
    status: &'a str,
    progress: f64,
    message: Option<String>,
}

fn emit(app: &AppHandle, id: &str, status: &str, progress: f64, message: Option<String>) {
    let _ = app.emit(EVT_PROGRESS, ProgressPayload { id, status, progress, message });
}

/// Download every file of a model into `dir`. Emits `models://progress` at ≤ 5 Hz.
/// Refused while the same model is already downloading.
#[tauri::command]
pub async fn models_download(app: AppHandle, active: State<'_, ActiveDownloads>, id: String, dir: String, files: Vec<ModelFile>) -> Result<(), String> {
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut map = active.0.lock().unwrap();
        if map.contains_key(&id) {
            return Err("download_in_progress".into());
        }
        map.insert(id.clone(), cancel.clone());
    }
    let result = download_all(&app, &id, &dir, &files, &cancel).await;
    active.0.lock().unwrap().remove(&id);
    match &result {
        Ok(()) => emit(&app, &id, "ready", 1.0, None),
        Err(e) if e == "cancelled" => emit(&app, &id, "cancelled", 0.0, None),
        Err(e) => emit(&app, &id, "error", 0.0, Some(e.clone())),
    }
    result
}

async fn download_all(app: &AppHandle, id: &str, dir: &str, files: &[ModelFile], cancel: &Arc<AtomicBool>) -> Result<(), String> {
    let dir = PathBuf::from(dir);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let total: u64 = files.iter().map(|f| f.size_bytes.unwrap_or(0)).sum();
    let mut done: u64 = 0;
    // No total timeout (a 180 MB file on a slow line is fine); stalls are cut by the read timeout.
    let client = reqwest::Client::builder()
        .user_agent("MarkPDF/0.1")
        .connect_timeout(Duration::from_secs(20))
        .read_timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())?;
    emit(app, id, "downloading", 0.0, None);

    for file in files {
        if cancel.load(Ordering::SeqCst) {
            return Err("cancelled".into());
        }
        let target = dir.join(&file.name);
        if file_matches(&target, file.size_bytes, file.sha256.as_deref()) {
            done += file.size_bytes.unwrap_or(0);
            continue;
        }
        let tmp = dir.join(format!("{}.part", file.name));
        let result = download_one(app, id, &client, file, &tmp, &mut done, total, cancel).await;
        if let Err(e) = result {
            let _ = std::fs::remove_file(&tmp);
            return Err(e);
        }
        std::fs::rename(&tmp, &target).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
async fn download_one(app: &AppHandle, id: &str, client: &reqwest::Client, file: &ModelFile, tmp: &Path, done: &mut u64, total: u64, cancel: &Arc<AtomicBool>) -> Result<(), String> {
    let resp = client.get(&file.url).send().await.map_err(|e| format!("下载失败：{e}"))?;
    if !resp.status().is_success() {
        return Err(format!("下载失败：HTTP {}", resp.status()));
    }
    let len = resp.content_length().or(file.size_bytes).unwrap_or(0);
    let mut out = std::fs::File::create(tmp).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut stream = resp.bytes_stream();
    let mut received: u64 = 0;
    let mut last_emit = std::time::Instant::now();
    let grand_total = if total > 0 { total } else { len };
    while let Some(chunk) = stream.next().await {
        if cancel.load(Ordering::SeqCst) {
            return Err("cancelled".into());
        }
        let chunk = chunk.map_err(|e| format!("下载中断：{e}"))?;
        out.write_all(&chunk).map_err(|e| e.to_string())?;
        hasher.update(&chunk);
        received += chunk.len() as u64;
        if last_emit.elapsed().as_millis() >= 200 {
            let frac = if grand_total > 0 { (*done + received) as f64 / grand_total as f64 } else { 0.0 };
            emit(app, id, "downloading", frac.min(0.999), Some(file.name.clone()));
            last_emit = std::time::Instant::now();
        }
    }
    out.flush().map_err(|e| e.to_string())?;
    drop(out);
    // A complete HTTP body that is not the expected model (HTML error page, truncated mirror) must not become "ready".
    if let Some(expected) = file.size_bytes {
        if received != expected {
            return Err(format!("大小不符：{}（收到 {received} 字节，应为 {expected}）", file.name));
        }
    }
    if let Some(expected) = &file.sha256 {
        let actual = format!("{:x}", hasher.finalize());
        if &actual != expected {
            return Err(format!("校验失败：{}", file.name));
        }
    }
    *done += if len > 0 { len } else { received };
    Ok(())
}

/// Cancel a running download of `id`; the caller sees `cancelled` on the progress event.
#[tauri::command]
pub fn models_cancel(active: State<'_, ActiveDownloads>, id: String) -> bool {
    match active.0.lock().unwrap().get(&id) {
        Some(flag) => {
            flag.store(true, Ordering::SeqCst);
            true
        }
        None => false,
    }
}

/// Ids currently downloading (the UI reconciles its state with this after remounting).
#[tauri::command]
pub fn models_active(active: State<'_, ActiveDownloads>) -> Vec<String> {
    active.0.lock().unwrap().keys().cloned().collect()
}

fn sha256_of(path: &Path) -> std::io::Result<String> {
    use std::io::Read;
    let mut f = std::fs::File::open(path)?;
    let mut h = Sha256::new();
    let mut buf = vec![0u8; 1 << 20];
    loop {
        let n = f.read(&mut buf)?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Ok(format!("{:x}", h.finalize()))
}

/// Regular file with the expected size, and (when a digest is known) the expected content.
fn file_matches(path: &Path, size: Option<u64>, sha256: Option<&str>) -> bool {
    let Ok(meta) = std::fs::metadata(path) else { return false };
    if !meta.is_file() || meta.len() == 0 {
        return false;
    }
    if let Some(s) = size {
        if meta.len() != s {
            return false;
        }
    }
    match sha256 {
        Some(expected) => sha256_of(path).map(|h| h == expected).unwrap_or(false),
        None => true,
    }
}

/// Removes a model directory. Only directories inside the app's `asr_models`
/// folder are accepted, so a bad argument cannot delete anything else.
#[tauri::command]
pub fn models_delete(app: AppHandle, dir: String) -> Result<(), String> {
    use tauri::Manager;
    let root = app.path().app_data_dir().map_err(|e| e.to_string())?.join("asr_models");
    let p = PathBuf::from(&dir);
    let inside = p.canonicalize().ok().zip(root.canonicalize().ok()).map(|(a, b)| a.starts_with(&b) && a != b).unwrap_or(false);
    if !p.exists() {
        return Ok(());
    }
    if !inside {
        return Err(format!("refusing to delete outside {}", root.display()));
    }
    std::fs::remove_dir_all(&p).map_err(|e| e.to_string())
}

/// Cheap startup check: every file is a regular, non-empty file of the expected size.
#[tauri::command]
pub fn models_check(dir: String, files: Vec<ExpectedFile>) -> bool {
    let p = PathBuf::from(dir);
    files.iter().all(|f| file_matches(&p.join(&f.name), f.size_bytes, None))
}

/// Full content check (hashes ~200 MB, so it runs on a blocking thread and only when needed).
#[tauri::command]
pub async fn models_verify(dir: String, files: Vec<ExpectedFile>) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let p = PathBuf::from(dir);
        files.iter().all(|f| file_matches(&p.join(&f.name), f.size_bytes, f.sha256.as_deref()))
    })
    .await
    .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_or_wrong_sized_files_are_not_ready() {
        let dir = std::env::temp_dir().join(format!("markpdf-models-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let f = dir.join("encoder.onnx");
        std::fs::write(&f, b"").unwrap();
        assert!(!file_matches(&f, None, None), "0-byte file must not be ready");
        std::fs::write(&f, b"abc").unwrap();
        assert!(!file_matches(&f, Some(4), None), "size mismatch must not be ready");
        assert!(file_matches(&f, Some(3), None));
        let sha = format!("{:x}", Sha256::digest(b"abc"));
        assert!(file_matches(&f, Some(3), Some(&sha)));
        assert!(!file_matches(&f, Some(3), Some("00")), "wrong digest must not be ready");
        std::fs::remove_dir_all(&dir).ok();
    }
}
