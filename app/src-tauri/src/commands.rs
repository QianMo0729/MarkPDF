//! Tauri commands exposed to the frontend. Keep this file a thin list; real
//! logic lives in the sibling modules (audio/, asr/, files/) as they arrive.

use sha2::{Digest, Sha256};
use std::io::Read;
use std::path::{Path, PathBuf};

/// SHA-256 of a file, hex encoded. Runs on a blocking thread.
#[tauri::command]
pub async fn file_sha256(path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut file = std::fs::File::open(&path).map_err(|e| format!("open {path}: {e}"))?;
        let mut hasher = Sha256::new();
        let mut buf = vec![0u8; 1 << 20];
        loop {
            let n = file.read(&mut buf).map_err(|e| e.to_string())?;
            if n == 0 {
                break;
            }
            hasher.update(&buf[..n]);
        }
        Ok(format!("{:x}", hasher.finalize()))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Copy any readable file (e.g. one the user picked in a dialog) into the app's
/// data directory. `dest` must resolve inside the app data dir; parents are created.
#[tauri::command]
pub async fn copy_file(app: tauri::AppHandle, src: String, dest: String) -> Result<u64, String> {
    use tauri::Manager;
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let dest_path = PathBuf::from(&dest);
    if !is_inside(&dest_path, &data_dir) {
        return Err(format!("destination must be inside {}", data_dir.display()));
    }
    tauri::async_runtime::spawn_blocking(move || {
        if let Some(parent) = dest_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        std::fs::copy(&src, &dest_path).map_err(|e| format!("copy {src}: {e}"))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Write base64 bytes to a user-chosen path (export fallback when the fs scope refuses).
#[tauri::command]
pub async fn write_bytes_b64(path: String, data_b64: String) -> Result<u64, String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data_b64.as_bytes())
        .map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        if let Some(parent) = Path::new(&path).parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        std::fs::write(&path, &bytes).map_err(|e| format!("write {path}: {e}"))?;
        Ok(bytes.len() as u64)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Size in bytes of any readable file.
#[tauri::command]
pub async fn file_size(path: String) -> Result<u64, String> {
    std::fs::metadata(&path)
        .map(|m| m.len())
        .map_err(|e| format!("stat {path}: {e}"))
}

fn is_inside(path: &Path, dir: &Path) -> bool {
    let norm = |p: &Path| -> PathBuf {
        let mut out = PathBuf::new();
        for c in p.components() {
            match c {
                std::path::Component::ParentDir => {
                    out.pop();
                }
                std::path::Component::CurDir => {}
                other => out.push(other.as_os_str()),
            }
        }
        out
    };
    let p = norm(path);
    let d = norm(dir);
    p.starts_with(&d)
}

/// Print a file with whatever handles the shell "print" verb for its type. On
/// Windows that is the user's PDF reader; MarkPDF registers no print verb itself,
/// so this never loops back into the app (audit PM-08).
#[tauri::command]
pub fn print_file(path: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::Shell::ShellExecuteW;
        use windows_sys::Win32::UI::WindowsAndMessaging::SW_HIDE;
        let wide = |s: &str| s.encode_utf16().chain(std::iter::once(0)).collect::<Vec<u16>>();
        let verb = wide("print");
        let file = wide(&path);
        let r = unsafe { ShellExecuteW(std::ptr::null_mut(), verb.as_ptr(), file.as_ptr(), std::ptr::null(), std::ptr::null(), SW_HIDE) } as usize;
        if r > 32 {
            Ok(())
        } else {
            Err(format!("no_print_handler:{r}"))
        }
    }
    #[cfg(not(windows))]
    {
        let _ = path;
        Err("no_print_handler:unsupported".into())
    }
}
