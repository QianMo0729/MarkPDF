//! Streaming recognition on a dedicated thread with the official `sherpa-onnx`
//! crate (docs/SPEC.md 7.5). Segment timestamps are derived from the number of
//! 16 kHz samples fed to the engine (plus the SampleClock offset at attach time),
//! never from the model, so they stay aligned with the WAV even when decoding lags.
//!
//! The audio queue is bounded (release audit B04): when decoding falls behind
//! real time the recorder drops audio for the engine and sends the dropped
//! sample count as a `Gap`, which advances the engine clock without decoding.
//! Memory therefore stays flat and the transcript keeps its alignment; the UI
//! is told the engine is lagging.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{Receiver, SyncSender};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use sherpa_onnx::{OnlineModelConfig, OnlineRecognizer, OnlineRecognizerConfig, OnlineStream, OnlineTransducerModelConfig};
use tauri::{AppHandle, Emitter};

pub const EVT_PARTIAL: &str = "asr://partial";
pub const EVT_FINAL: &str = "asr://final";
pub const EVT_STATUS: &str = "asr://status";

pub const SAMPLE_RATE: u32 = 16_000;
/// Measured with a TTS WAV of known speech spans (docs/SPEC.md 15.4): the first
/// token shows up ~500 ms after speech starts (encoder chunk + our 100 ms feed).
const LEAD_IN_MS: u64 = 600;
/// The endpoint fires >= 1.2 s of silence after speech ends plus the same lag.
const TRAIL_MS: u64 = 1600;
const MIN_SEGMENT_MS: u64 = 200;
/// Recorder → engine queue bound: ~2–5 s of audio at typical callback sizes.
pub const ASR_QUEUE_CHUNKS: usize = 256;
/// After stop is requested the queue is drained for at most this long.
const STOP_DRAIN_BUDGET: Duration = Duration::from_secs(3);
/// "Lagging" is reported at most this often.
const LAG_REPORT_EVERY: Duration = Duration::from_secs(5);

#[derive(serde::Serialize, Clone)]
pub struct PartialPayload {
    pub text: String,
}

#[derive(serde::Serialize, Clone, Debug)]
pub struct FinalPayload {
    pub t0_ms: u64,
    pub t1_ms: u64,
    pub text: String,
}

#[derive(serde::Serialize, Clone)]
pub struct StatusPayload {
    pub status: &'static str,
    pub message: Option<String>,
}

pub const MODEL_FILES: [&str; 4] = ["encoder.onnx", "decoder.onnx", "joiner.onnx", "tokens.txt"];

/// What the recorder sends to the engine.
pub enum AsrInput {
    /// 16 kHz mono f32 samples.
    Audio(Vec<f32>),
    /// This many samples were recorded but never queued (engine overloaded).
    Gap(u64),
}

/// Model + stream + segment bookkeeping, independent of threads/events so the
/// same code serves the live recorder and the offline bench.
pub struct Decoder {
    recognizer: OnlineRecognizer,
    stream: OnlineStream,
    fed_samples: u64,
    offset_ms: u64,
    last_text: String,
    segment_start_ms: Option<u64>,
    last_t1_ms: u64,
}

impl Decoder {
    pub fn new(model_dir: &Path, offset_ms: u64) -> Result<Self, String> {
        for f in MODEL_FILES {
            if !model_dir.join(f).is_file() {
                return Err(format!("model file missing: {f}"));
            }
        }
        let s = |f: &str| Some(model_dir.join(f).to_string_lossy().into_owned());
        let config = OnlineRecognizerConfig {
            model_config: OnlineModelConfig {
                transducer: OnlineTransducerModelConfig { encoder: s("encoder.onnx"), decoder: s("decoder.onnx"), joiner: s("joiner.onnx") },
                tokens: s("tokens.txt"),
                num_threads: 2,
                // Left empty on purpose: sherpa-onnx reads the type from the ONNX
                // metadata, so zipformer (bilingual 2023-02-20) and zipformer2
                // (en 2023-06-26) both load. A wrong explicit type aborts the process.
                model_type: None,
                ..Default::default()
            },
            decoding_method: Some("greedy_search".into()),
            enable_endpoint: true,
            rule1_min_trailing_silence: 2.4,
            rule2_min_trailing_silence: 1.2,
            rule3_min_utterance_length: 20.0,
            ..Default::default()
        };
        let recognizer = OnlineRecognizer::create(&config).ok_or_else(|| "failed to load model".to_string())?;
        let stream = recognizer.create_stream();
        Ok(Self { recognizer, stream, fed_samples: 0, offset_ms, last_text: String::new(), segment_start_ms: None, last_t1_ms: offset_ms })
    }

    /// Timeline position of the audio fed so far.
    pub fn position_ms(&self) -> u64 {
        self.offset_ms + self.fed_samples * 1000 / SAMPLE_RATE as u64
    }

    fn current_text(&self) -> String {
        self.recognizer.get_result(&self.stream).map(|r| sentence_case(r.text.trim())).unwrap_or_default()
    }

    /// Feeds one chunk of 16 kHz mono f32 samples. Calls `on_partial` when the
    /// hypothesis changes and `on_final` at endpoints.
    pub fn feed(&mut self, chunk: &[f32], on_partial: &mut dyn FnMut(&str), on_final: &mut dyn FnMut(FinalPayload)) {
        self.stream.accept_waveform(SAMPLE_RATE as i32, chunk);
        self.fed_samples += chunk.len() as u64;
        while self.recognizer.is_ready(&self.stream) {
            self.recognizer.decode(&self.stream);
        }
        let text = self.current_text();
        if !text.is_empty() && self.segment_start_ms.is_none() {
            self.segment_start_ms = Some(self.position_ms().saturating_sub(LEAD_IN_MS).max(self.last_t1_ms));
        }
        if text != self.last_text {
            self.last_text = text.clone();
            on_partial(&text);
        }
        if self.recognizer.is_endpoint(&self.stream) {
            if !text.is_empty() {
                let now = self.position_ms();
                let t0 = self.segment_start_ms.unwrap_or(now.saturating_sub(LEAD_IN_MS)).max(self.last_t1_ms);
                let t1 = now.saturating_sub(TRAIL_MS).max(t0 + MIN_SEGMENT_MS);
                self.last_t1_ms = t1;
                on_final(FinalPayload { t0_ms: t0, t1_ms: t1, text });
                on_partial("");
            }
            self.recognizer.reset(&self.stream);
            self.last_text.clear();
            self.segment_start_ms = None;
        }
    }

    /// Audio that was recorded but never reached the engine: close the current
    /// hypothesis (its audio is over), advance the clock and start fresh.
    pub fn skip(&mut self, samples: u64, on_partial: &mut dyn FnMut(&str), on_final: &mut dyn FnMut(FinalPayload)) {
        let text = self.current_text();
        if !text.is_empty() {
            let now = self.position_ms();
            let t0 = self.segment_start_ms.unwrap_or(now.saturating_sub(LEAD_IN_MS)).max(self.last_t1_ms);
            let t1 = now.max(t0 + MIN_SEGMENT_MS);
            self.last_t1_ms = t1;
            on_final(FinalPayload { t0_ms: t0, t1_ms: t1, text });
            on_partial("");
        }
        self.recognizer.reset(&self.stream);
        self.last_text.clear();
        self.segment_start_ms = None;
        self.fed_samples += samples;
        self.last_t1_ms = self.last_t1_ms.max(self.position_ms());
    }

    /// Flushes the pending hypothesis as a last segment.
    pub fn finish(&mut self, on_final: &mut dyn FnMut(FinalPayload)) {
        self.stream.input_finished();
        while self.recognizer.is_ready(&self.stream) {
            self.recognizer.decode(&self.stream);
        }
        let text = self.current_text();
        if !text.is_empty() {
            let now = self.position_ms();
            let t0 = self.segment_start_ms.unwrap_or(now.saturating_sub(LEAD_IN_MS)).max(self.last_t1_ms);
            let t1 = now.max(t0 + MIN_SEGMENT_MS);
            self.last_t1_ms = t1;
            on_final(FinalPayload { t0_ms: t0, t1_ms: t1, text });
        }
        self.last_text.clear();
        self.segment_start_ms = None;
    }
}

pub struct AsrEngine {
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
    sink: Option<SyncSender<AsrInput>>,
}

impl AsrEngine {
    /// Starts loading the model on a worker thread. Samples sent to `sink()` are
    /// decoded as they arrive; `offset_ms` is the recorder clock at attach time.
    pub fn start(app: AppHandle, model_dir: &Path, offset_ms: u64) -> Result<Self, String> {
        for f in MODEL_FILES {
            if !model_dir.join(f).is_file() {
                return Err(format!("model file missing: {f}"));
            }
        }
        let (tx, rx) = std::sync::mpsc::sync_channel::<AsrInput>(ASR_QUEUE_CHUNKS);
        let stop = Arc::new(AtomicBool::new(false));
        let dir = model_dir.to_path_buf();
        let _ = app.emit(EVT_STATUS, StatusPayload { status: "loading", message: None });
        let stop2 = stop.clone();
        let app2 = app.clone();
        let thread = std::thread::Builder::new()
            .name("markpdf-asr".into())
            .spawn(move || run(app2, dir, offset_ms, rx, stop2))
            .map_err(|e| e.to_string())?;
        Ok(Self { stop, thread: Some(thread), sink: Some(tx) })
    }

    pub fn sink(&self) -> SyncSender<AsrInput> {
        self.sink.as_ref().expect("engine running").clone()
    }

    /// Drains what is queued (bounded, and for at most `STOP_DRAIN_BUDGET`),
    /// emits the last segment, then joins the thread. The recorder should have
    /// dropped its sender first (see `audio_stop` / `asr_stop`).
    pub fn stop(mut self) {
        self.sink = None;
        self.stop.store(true, Ordering::SeqCst);
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

fn run(app: AppHandle, dir: PathBuf, offset_ms: u64, rx: Receiver<AsrInput>, stop: Arc<AtomicBool>) {
    let mut decoder = match Decoder::new(&dir, offset_ms) {
        Ok(d) => d,
        Err(e) => {
            let _ = app.emit(EVT_STATUS, StatusPayload { status: "error", message: Some(e) });
            return;
        }
    };
    let _ = app.emit(EVT_STATUS, StatusPayload { status: "ready", message: None });
    let app_p = app.clone();
    let app_f = app.clone();
    let mut on_partial = |text: &str| {
        let _ = app_p.emit(EVT_PARTIAL, PartialPayload { text: text.to_string() });
    };
    let mut on_final = |seg: FinalPayload| {
        let _ = app_f.emit(EVT_FINAL, seg);
    };
    let mut deadline: Option<Instant> = None;
    let mut last_lag_report: Option<Instant> = None;
    loop {
        if stop.load(Ordering::SeqCst) && deadline.is_none() {
            deadline = Some(Instant::now() + STOP_DRAIN_BUDGET);
        }
        if let Some(d) = deadline {
            if Instant::now() >= d {
                break;
            }
        }
        match rx.recv_timeout(Duration::from_millis(200)) {
            Ok(AsrInput::Audio(chunk)) => decoder.feed(&chunk, &mut on_partial, &mut on_final),
            Ok(AsrInput::Gap(samples)) => {
                decoder.skip(samples, &mut on_partial, &mut on_final);
                if last_lag_report.map(|t| t.elapsed() >= LAG_REPORT_EVERY).unwrap_or(true) {
                    last_lag_report = Some(Instant::now());
                    let _ = app.emit(EVT_STATUS, StatusPayload { status: "lagging", message: Some(format!("skipped {} ms", samples * 1000 / SAMPLE_RATE as u64)) });
                }
            }
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                if stop.load(Ordering::SeqCst) {
                    break;
                }
            }
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
    decoder.finish(&mut on_final);
    let _ = app.emit(EVT_STATUS, StatusPayload { status: "stopped", message: None });
}

/// The zipformer models emit English as upper-case BPE tokens. Turn an all-caps
/// hypothesis into sentence case: first letter and the pronoun "I" upper, the rest
/// lower, and a capital after . ? ! when the text carries punctuation. Text that
/// already has lower-case letters (a casing-aware model) is left alone; CJK is
/// untouched either way.
pub fn sentence_case(text: &str) -> String {
    if text.chars().any(|c| c.is_ascii_lowercase()) {
        return text.to_string();
    }
    let mut out = String::with_capacity(text.len());
    let mut capitalize_next = true;
    for word in text.split(' ') {
        if !out.is_empty() {
            out.push(' ');
        }
        let lower = word.to_ascii_lowercase();
        let is_pronoun_i = matches!(lower.as_str(), "i" | "i'm" | "i've" | "i'll" | "i'd");
        for (idx, ch) in lower.chars().enumerate() {
            if ch.is_ascii_alphabetic() && (capitalize_next || (is_pronoun_i && idx == 0)) {
                out.push(ch.to_ascii_uppercase());
                capitalize_next = false;
            } else {
                out.push(ch);
                if ch.is_ascii_alphabetic() {
                    capitalize_next = false;
                }
            }
            if matches!(ch, '.' | '?' | '!') {
                capitalize_next = true;
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::sentence_case;

    #[test]
    fn caps_become_sentence_case() {
        assert_eq!(sentence_case("TODAY WE WILL TALK ABOUT THE FOURIER TRANSFORM"), "Today we will talk about the fourier transform");
        assert_eq!(sentence_case("I THINK I'M DONE. PLEASE OPEN PAGE SEVEN"), "I think I'm done. Please open page seven");
    }

    #[test]
    fn mixed_case_and_cjk_are_untouched() {
        assert_eq!(sentence_case("Already cased Text"), "Already cased Text");
        assert_eq!(sentence_case("今天讲傅里叶变换"), "今天讲傅里叶变换");
        assert_eq!(sentence_case("这个叫 FOURIER TRANSFORM"), "这个叫 Fourier transform");
    }
}

/// Minimal PCM16 WAV reader (mono/stereo, any rate; the bench requires 16 kHz).
/// Chunk lengths are clamped to the file so a corrupt header cannot index past it.
pub fn read_wav_f32(path: &Path) -> Result<(u32, Vec<f32>), String> {
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    if bytes.len() < 12 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return Err("not a WAV file".into());
    }
    let mut pos = 12;
    let mut channels = 1u16;
    let mut rate = 0u32;
    let mut bits = 16u16;
    let mut data: Option<&[u8]> = None;
    while pos + 8 <= bytes.len() {
        let id = &bytes[pos..pos + 4];
        let size = u32::from_le_bytes([bytes[pos + 4], bytes[pos + 5], bytes[pos + 6], bytes[pos + 7]]) as usize;
        let body_start = pos + 8;
        let body_end = body_start.saturating_add(size).min(bytes.len());
        if id == b"fmt " && body_end - body_start >= 16 {
            let b = &bytes[body_start..body_end];
            channels = u16::from_le_bytes([b[2], b[3]]);
            rate = u32::from_le_bytes([b[4], b[5], b[6], b[7]]);
            bits = u16::from_le_bytes([b[14], b[15]]);
        } else if id == b"data" {
            data = Some(&bytes[body_start..body_end]);
        }
        pos = body_end + (size & 1);
    }
    let data = data.ok_or("no data chunk")?;
    if bits != 16 {
        return Err(format!("unsupported bits per sample: {bits}"));
    }
    if rate == 0 {
        return Err("missing fmt chunk".into());
    }
    let ch = channels.max(1) as usize;
    let frames = data.len() / (2 * ch);
    let mut out = Vec::with_capacity(frames);
    for f in 0..frames {
        let mut acc = 0f32;
        for c in 0..ch {
            let i = (f * ch + c) * 2;
            acc += i16::from_le_bytes([data[i], data[i + 1]]) as f32 / 32768.0;
        }
        out.push(acc / ch as f32);
    }
    Ok((rate, out))
}
