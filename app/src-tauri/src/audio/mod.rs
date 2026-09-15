//! Audio commands exposed to the frontend (docs/SPEC.md 7.1).

pub mod capture;
pub mod resample;
pub mod sample_clock;
pub mod wav_writer;

use std::path::PathBuf;
use std::sync::atomic::Ordering;
use std::sync::Mutex;

use tauri::{AppHandle, State};

use capture::{Recorder, StartOptions, STATE_IDLE, STATE_PAUSED, STATE_RECORDING};

#[derive(Default)]
pub struct AudioState(pub Mutex<Option<Recorder>>);

#[derive(serde::Serialize)]
pub struct AudioStatus {
    pub state: &'static str,
    pub t_ms: u64,
}

#[derive(serde::Serialize)]
pub struct StopResult {
    pub duration_ms: u64,
}

fn state_name(v: u8) -> &'static str {
    match v {
        STATE_RECORDING => "recording",
        STATE_PAUSED => "paused",
        _ => "idle",
    }
}

#[tauri::command]
pub async fn audio_start(app: AppHandle, state: State<'_, AudioState>, wav_path: String, append: Option<bool>) -> Result<(), String> {
    {
        let guard = state.0.lock().unwrap();
        if guard.is_some() {
            return Err("already_recording".into());
        }
    }
    let app2 = app.clone();
    let opts = StartOptions { wav_path: PathBuf::from(wav_path), append: append.unwrap_or(false) };
    let recorder = tauri::async_runtime::spawn_blocking(move || Recorder::start(app2, opts))
        .await
        .map_err(|e| e.to_string())??;
    *state.0.lock().unwrap() = Some(recorder);
    Ok(())
}

#[tauri::command]
pub fn audio_pause(app: AppHandle, state: State<'_, AudioState>) -> Result<(), String> {
    let guard = state.0.lock().unwrap();
    guard.as_ref().ok_or("not_recording")?.pause(&app)
}

#[tauri::command]
pub fn audio_resume(app: AppHandle, state: State<'_, AudioState>) -> Result<(), String> {
    let guard = state.0.lock().unwrap();
    guard.as_ref().ok_or("not_recording")?.resume(&app)
}

#[tauri::command]
pub async fn audio_stop(app: AppHandle, state: State<'_, AudioState>, asr: State<'_, crate::asr::AsrState>) -> Result<StopResult, String> {
    let recorder = state.0.lock().unwrap().take().ok_or("not_recording")?;
    // Mic off and WAV closed first; only then is the (bounded) engine queue drained,
    // so ending a class never keeps recording while the decoder catches up (audit B04).
    recorder.set_asr_sink(None);
    let app2 = app.clone();
    let duration_ms = tauri::async_runtime::spawn_blocking(move || recorder.stop(&app2))
        .await
        .map_err(|e| e.to_string())??;
    let engine = asr.0.lock().unwrap().take();
    if let Some(engine) = engine {
        let _ = tauri::async_runtime::spawn_blocking(move || engine.stop()).await;
    }
    Ok(StopResult { duration_ms })
}

#[tauri::command]
pub fn audio_status(state: State<'_, AudioState>) -> AudioStatus {
    let guard = state.0.lock().unwrap();
    match guard.as_ref() {
        Some(r) => AudioStatus { state: state_name(r.state.load(Ordering::SeqCst)), t_ms: r.clock.t_ms() },
        None => AudioStatus { state: state_name(STATE_IDLE), t_ms: 0 },
    }
}

/// Dev/test only (debug builds): feed a WAV through the recorder as a virtual mic.
#[tauri::command]
pub fn audio_inject_wav(state: State<'_, AudioState>, path: String) -> Result<u64, String> {
    let guard = state.0.lock().unwrap();
    guard.as_ref().ok_or("not_recording")?.inject_wav(std::path::Path::new(&path))
}

#[tauri::command]
pub fn wav_probe(path: String) -> Result<wav_writer::WavInfo, String> {
    wav_writer::probe(std::path::Path::new(&path)).map_err(|e| e.to_string())
}

/// Crash recovery: rewrite the RIFF/data sizes from the PCM actually on disk.
#[tauri::command]
pub async fn wav_repair(path: String) -> Result<wav_writer::WavInfo, String> {
    tauri::async_runtime::spawn_blocking(move || wav_writer::repair(std::path::Path::new(&path)).map_err(|e| e.to_string()))
        .await
        .map_err(|e| e.to_string())?
}
