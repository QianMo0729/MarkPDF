//! "Open with MarkPDF": PDF paths handed to the process on the command line
//! (Explorer double-click / "Open with"; the installer registers the file
//! association) and by a second instance started while we are already running
//! (tauri-plugin-single-instance forwards its argv + cwd here). macOS never
//! uses argv for this: Finder sends the running (or just launched) app an
//! open-documents event, which arrives as `RunEvent::Opened` (see [`on_opened`]).

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, Runtime};

/// Event sent to the webview with a `Vec<String>` of absolute PDF paths.
pub const OPEN_FILES_EVENT: &str = "open-files";

#[derive(Default)]
pub struct LaunchFiles(Mutex<Inner>);

#[derive(Default)]
struct Inner {
    /// Paths waiting for the frontend to pick them up.
    pending: Vec<String>,
    /// Set once the frontend drained the list; from then on new paths are emitted as events.
    frontend_ready: bool,
}

/// Keep only arguments that point at existing `.pdf` files (relative paths are
/// resolved against `cwd`). `args[0]` is the executable and is skipped.
pub fn pdf_paths(args: impl IntoIterator<Item = String>, cwd: &Path) -> Vec<String> {
    args.into_iter()
        .skip(1)
        .filter(|a| !a.starts_with('-'))
        .filter_map(|a| {
            let p = PathBuf::from(&a);
            let p = if p.is_absolute() { p } else { cwd.join(p) };
            let is_pdf = p
                .extension()
                .map_or(false, |e| e.eq_ignore_ascii_case("pdf"));
            (is_pdf && p.is_file()).then(|| p.to_string_lossy().into_owned())
        })
        .collect()
}

/// Called from `setup`: remember the PDFs this process was started with.
pub fn collect_startup_args<R: Runtime>(app: &AppHandle<R>) {
    let cwd = std::env::current_dir().unwrap_or_default();
    let args = std::env::args_os().map(|a| a.to_string_lossy().into_owned());
    let files = pdf_paths(args, &cwd);
    if !files.is_empty() {
        app.state::<LaunchFiles>().0.lock().unwrap().pending.extend(files);
    }
}

/// single-instance callback: focus the existing window and hand over the PDFs.
pub fn on_second_instance<R: Runtime>(app: &AppHandle<R>, args: Vec<String>, cwd: String) {
    focus_main_window(app);
    deliver(app, pdf_paths(args, Path::new(&cwd)));
}

fn focus_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// macOS: files dropped on the Dock icon or opened from Finder, both at launch
/// and while running.
#[cfg(target_os = "macos")]
pub fn on_opened<R: Runtime>(app: &AppHandle<R>, urls: Vec<tauri::Url>) {
    focus_main_window(app);
    let args = urls
        .iter()
        .filter_map(|u| u.to_file_path().ok())
        .map(|p| p.to_string_lossy().into_owned());
    // pdf_paths skips argv[0]
    let files = pdf_paths(std::iter::once(String::new()).chain(args), Path::new("/"));
    deliver(app, files);
}

/// Queue the files until the frontend is ready, afterwards emit them right away.
fn deliver<R: Runtime>(app: &AppHandle<R>, files: Vec<String>) {
    if files.is_empty() {
        return;
    }
    let state = app.state::<LaunchFiles>();
    let emit_now = {
        let mut inner = state.0.lock().unwrap();
        if inner.frontend_ready {
            true
        } else {
            inner.pending.extend(files.iter().cloned());
            false
        }
    };
    if emit_now {
        let _ = app.emit(OPEN_FILES_EVENT, files);
    }
}

/// Frontend drains the startup list once it can handle files; afterwards new
/// files arrive through [`OPEN_FILES_EVENT`].
#[tauri::command]
pub fn take_launch_files(state: tauri::State<'_, LaunchFiles>) -> Vec<String> {
    let mut inner = state.0.lock().unwrap();
    inner.frontend_ready = true;
    std::mem::take(&mut inner.pending)
}

#[cfg(test)]
mod tests {
    use super::pdf_paths;

    #[test]
    fn keeps_only_existing_pdfs() {
        let dir = std::env::temp_dir().join(format!("markpdf-launch-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let pdf = dir.join("Lecture 1.PDF");
        std::fs::write(&pdf, b"%PDF-1.4").unwrap();
        let txt = dir.join("notes.txt");
        std::fs::write(&txt, b"x").unwrap();

        let args = vec![
            "markpdf.exe".to_string(),
            "--flag".to_string(),
            pdf.to_string_lossy().into_owned(),
            txt.to_string_lossy().into_owned(),
            "Lecture 1.PDF".to_string(),
            dir.join("missing.pdf").to_string_lossy().into_owned(),
        ];
        let got = pdf_paths(args, &dir);
        assert_eq!(got.len(), 2, "{got:?}");
        assert!(got.iter().all(|p| p.ends_with("Lecture 1.PDF")));
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
