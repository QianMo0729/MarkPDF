//! On-device speech recognition (docs/SPEC.md 7.5 / 7.6).

pub mod engine;
pub mod model_manager;

use std::path::Path;
use std::sync::Mutex;

use tauri::{AppHandle, State};

use crate::audio::AudioState;
use engine::{AsrEngine, Decoder, FinalPayload};

#[derive(Default)]
pub struct AsrState(pub Mutex<Option<AsrEngine>>);

/// Attaches a streaming recognizer to the running recorder. Model loading
/// happens on the ASR thread; `asr://status` reports loading → ready | error.
#[tauri::command]
pub fn asr_start(app: AppHandle, audio: State<'_, AudioState>, asr: State<'_, AsrState>, model_dir: String) -> Result<(), String> {
    let mut slot = asr.0.lock().unwrap();
    if slot.is_some() {
        return Err("asr_already_running".into());
    }
    let audio_guard = audio.0.lock().unwrap();
    let recorder = audio_guard.as_ref().ok_or("not_recording")?;
    let engine = AsrEngine::start(app, Path::new(&model_dir), recorder.clock.t_ms())?;
    recorder.set_asr_sink(Some(engine.sink()));
    *slot = Some(engine);
    Ok(())
}

/// Detaches from the recorder, flushes the last segment and unloads the model.
#[tauri::command]
pub async fn asr_stop(audio: State<'_, AudioState>, asr: State<'_, AsrState>) -> Result<(), String> {
    let engine = asr.0.lock().unwrap().take();
    if let Some(r) = audio.0.lock().unwrap().as_ref() {
        r.set_asr_sink(None);
    }
    if let Some(engine) = engine {
        tauri::async_runtime::spawn_blocking(move || engine.stop()).await.map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[derive(serde::Serialize)]
pub struct BenchResult {
    pub segments: Vec<FinalPayload>,
    pub audio_ms: u64,
    pub load_ms: u64,
    pub decode_ms: u64,
}

/// Dev/test helper: decodes a 16 kHz WAV offline through the same Decoder the
/// live path uses, so timestamps and endpointing can be checked without a mic.
#[tauri::command]
pub async fn asr_bench(model_dir: String, wav_path: String) -> Result<BenchResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (rate, samples) = engine::read_wav_f32(Path::new(&wav_path))?;
        if rate != engine::SAMPLE_RATE {
            return Err(format!("bench expects 16 kHz WAV, got {rate}"));
        }
        let t = std::time::Instant::now();
        let mut decoder = Decoder::new(Path::new(&model_dir), 0)?;
        let load_ms = t.elapsed().as_millis() as u64;
        let t = std::time::Instant::now();
        let mut segments = Vec::new();
        let mut on_partial = |_: &str| {};
        let mut on_final = |seg: FinalPayload| segments.push(seg);
        for chunk in samples.chunks(1600) {
            decoder.feed(chunk, &mut on_partial, &mut on_final);
        }
        decoder.finish(&mut on_final);
        let decode_ms = t.elapsed().as_millis() as u64;
        Ok(BenchResult { segments, audio_ms: samples.len() as u64 * 1000 / engine::SAMPLE_RATE as u64, load_ms, decode_ms })
    })
    .await
    .map_err(|e| e.to_string())?
}
