//! On-device speech recognition (docs/SPEC.md 7.5 / 7.6).

pub mod engine;
pub mod model_manager;

use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use tauri::{AppHandle, Emitter, State};

use crate::audio::AudioState;
use engine::{AsrEngine, Decoder, FinalPayload, WavPcmReader};

#[derive(Default)]
pub struct AsrState(pub Mutex<Option<AsrEngine>>);

/// Offline transcription jobs in flight, each with its cancel flag (docs/SPEC.md 16.1).
#[derive(Default)]
pub struct ActiveTranscriptions(pub Mutex<HashMap<String, Arc<AtomicBool>>>);

pub const EVT_TRANSCRIBE: &str = "asr://transcribe";

#[derive(serde::Serialize, Clone)]
struct TranscribeProgress<'a> {
    job_id: &'a str,
    done_ms: u64,
    total_ms: u64,
}

#[derive(serde::Serialize)]
pub struct TranscribeResult {
    pub segments: Vec<FinalPayload>,
    pub audio_ms: u64,
    pub load_ms: u64,
    pub decode_ms: u64,
}

/// Decodes a whole recording with the same streaming Decoder the live path
/// uses (identical endpointing and timestamps), reading the WAV in chunks and
/// reporting progress about once per second of audio. Runs on a blocking
/// thread; `asr_transcribe_cancel` stops it between chunks.
#[tauri::command]
pub async fn asr_transcribe_file(app: AppHandle, active: State<'_, ActiveTranscriptions>, job_id: String, model_dir: String, wav_path: String) -> Result<TranscribeResult, String> {
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut map = active.0.lock().unwrap();
        if map.contains_key(&job_id) {
            return Err("transcribe_in_progress".into());
        }
        map.insert(job_id.clone(), cancel.clone());
    }
    let job = job_id.clone();
    let app2 = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || transcribe_file(&app2, &job, &model_dir, &wav_path, &cancel)).await.map_err(|e| e.to_string());
    active.0.lock().unwrap().remove(&job_id);
    result?
}

fn transcribe_file(app: &AppHandle, job_id: &str, model_dir: &str, wav_path: &str, cancel: &AtomicBool) -> Result<TranscribeResult, String> {
    let mut wav = WavPcmReader::open(Path::new(wav_path))?;
    if wav.sample_rate != engine::SAMPLE_RATE {
        return Err(format!("expected a 16 kHz WAV, got {} Hz", wav.sample_rate));
    }
    let total_ms = wav.duration_ms();
    let _ = app.emit(EVT_TRANSCRIBE, TranscribeProgress { job_id, done_ms: 0, total_ms });
    let t = std::time::Instant::now();
    let mut decoder = Decoder::new(Path::new(model_dir), 0)?;
    let load_ms = t.elapsed().as_millis() as u64;
    let t = std::time::Instant::now();
    let mut segments = Vec::new();
    let mut on_partial = |_: &str| {};
    let mut on_final = |seg: FinalPayload| segments.push(seg);
    let mut fed: u64 = 0;
    let mut last_report: u64 = 0;
    loop {
        if cancel.load(Ordering::SeqCst) {
            return Err("cancelled".into());
        }
        let chunk = wav.next_chunk(1600)?;
        if chunk.is_empty() {
            break;
        }
        fed += chunk.len() as u64;
        decoder.feed(&chunk, &mut on_partial, &mut on_final);
        let done_ms = fed * 1000 / engine::SAMPLE_RATE as u64;
        if done_ms - last_report >= 1000 {
            last_report = done_ms;
            let _ = app.emit(EVT_TRANSCRIBE, TranscribeProgress { job_id, done_ms, total_ms });
        }
    }
    decoder.finish(&mut on_final);
    let _ = app.emit(EVT_TRANSCRIBE, TranscribeProgress { job_id, done_ms: total_ms, total_ms });
    Ok(TranscribeResult { segments, audio_ms: total_ms, load_ms, decode_ms: t.elapsed().as_millis() as u64 })
}

/// Asks a running job to stop; it returns `cancelled` after the current chunk.
#[tauri::command]
pub fn asr_transcribe_cancel(active: State<'_, ActiveTranscriptions>, job_id: String) -> bool {
    match active.0.lock().unwrap().get(&job_id) {
        Some(flag) => {
            flag.store(true, Ordering::SeqCst);
            true
        }
        None => false,
    }
}

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
