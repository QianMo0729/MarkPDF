//! Microphone capture with cpal. The cpal stream lives on its own thread (it is
//! not Send on every host); PCM flows to a worker that resamples, writes the WAV,
//! advances the SampleClock and emits UI events (docs/SPEC.md 7.1 / 7.2).
//!
//! Failure paths (release audit B01): a device error or a WAV write error is
//! reported through `audio://state` (`interrupted` / `error`) instead of being
//! swallowed, "resume" rebuilds a dead stream, and every queue is bounded so a
//! slow disk or decoder can never grow memory without limit.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::sync::mpsc::{self, Receiver, Sender, SyncSender, TrySendError};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use tauri::{AppHandle, Emitter};

use super::resample::{level_db, to_i16, MonoResampler};
use super::sample_clock::SampleClock;
use super::wav_writer::{WavWriter, SAMPLE_RATE};
use crate::asr::engine::AsrInput;

pub const STATE_IDLE: u8 = 0;
pub const STATE_RECORDING: u8 = 1;
pub const STATE_PAUSED: u8 = 2;

pub const EVT_TICK: &str = "audio://tick";
pub const EVT_LEVEL: &str = "audio://level";
pub const EVT_STATE: &str = "audio://state";

/// Device → worker queue bound (~10 s of 10 ms callbacks). The cpal callback
/// never blocks: when the worker falls behind, chunks are dropped and the
/// timeline stays consistent because the SampleClock only counts written samples.
const CAPTURE_QUEUE_CHUNKS: usize = 1024;

#[derive(serde::Serialize, Clone)]
struct TickPayload {
    t_ms: u64,
}

#[derive(serde::Serialize, Clone)]
struct LevelPayload {
    db: f32,
}

#[derive(serde::Serialize, Clone)]
struct StatePayload {
    state: &'static str,
    message: Option<String>,
}

fn emit_state(app: &AppHandle, state: &'static str, message: Option<String>) {
    let _ = app.emit(EVT_STATE, StatePayload { state, message });
}

enum Cmd {
    Pause,
    Resume,
    Stop(SyncSender<()>),
}

/// From the stream thread to the worker.
enum Chunk {
    /// Mono PCM at the current device rate.
    Data(Vec<f32>),
    /// The stream was rebuilt on a device running at this rate.
    Rate(u32),
    End,
}

pub struct Recorder {
    cmd_tx: Sender<Cmd>,
    worker: Option<JoinHandle<Result<u64, String>>>,
    pub clock: Arc<SampleClock>,
    pub state: Arc<AtomicU8>,
    /// Optional consumer of 16 kHz f32 audio (the ASR engine, M7). Bounded; see `feed_asr`.
    asr_tx: Arc<Mutex<Option<SyncSender<AsrInput>>>>,
    /// Dev-only virtual mic: chunks sent here enter the pipeline like mic data.
    inject_tx: SyncSender<Chunk>,
    mic_muted: Arc<AtomicBool>,
    device_rate: u32,
}

pub struct StartOptions {
    pub wav_path: PathBuf,
    /// Continue an existing file (crash recovery); otherwise truncate.
    pub append: bool,
}

impl Recorder {
    pub fn start(app: AppHandle, opts: StartOptions) -> Result<Self, String> {
        #[cfg(target_os = "macos")]
        super::mic_permission::ensure_access()?;

        let writer = if opts.append {
            WavWriter::append(&opts.wav_path)
        } else {
            WavWriter::create(&opts.wav_path)
        }
        .map_err(|e| format!("open wav: {e}"))?;
        let clock = Arc::new(SampleClock::new(writer.samples()));
        let state = Arc::new(AtomicU8::new(STATE_RECORDING));
        let asr_tx: Arc<Mutex<Option<SyncSender<AsrInput>>>> = Arc::new(Mutex::new(None));
        let mic_muted = Arc::new(AtomicBool::new(false));

        let (chunk_tx, chunk_rx) = mpsc::sync_channel::<Chunk>(CAPTURE_QUEUE_CHUNKS);
        let (cmd_tx, cmd_rx) = mpsc::channel::<Cmd>();
        let (ready_tx, ready_rx) = mpsc::sync_channel::<Result<u32, String>>(1);

        // ----- stream owner thread -----
        {
            let chunk_tx = chunk_tx.clone();
            let state = state.clone();
            let muted = mic_muted.clone();
            let app = app.clone();
            std::thread::Builder::new()
                .name("markpdf-audio-stream".into())
                .spawn(move || stream_thread(app, chunk_tx, cmd_rx, ready_tx, state, muted))
                .map_err(|e| e.to_string())?;
        }
        let device_rate = ready_rx
            .recv_timeout(Duration::from_secs(10))
            .map_err(|_| "audio device did not start".to_string())??;

        // ----- worker thread -----
        let worker = {
            let clock = clock.clone();
            let asr_tx = asr_tx.clone();
            let app = app.clone();
            std::thread::Builder::new()
                .name("markpdf-audio-worker".into())
                .spawn(move || worker_thread(app, chunk_rx, writer, clock, device_rate, asr_tx))
                .map_err(|e| e.to_string())?
        };
        emit_state(&app, "recording", None);
        Ok(Self { cmd_tx, worker: Some(worker), clock, state, asr_tx, inject_tx: chunk_tx, mic_muted, device_rate })
    }

    pub fn pause(&self, app: &AppHandle) -> Result<(), String> {
        self.cmd_tx.send(Cmd::Pause).map_err(|_| "stream gone".to_string())?;
        self.state.store(STATE_PAUSED, Ordering::SeqCst);
        emit_state(app, "paused", None);
        Ok(())
    }

    /// The stream thread answers with `recording` (or `interrupted` again when
    /// the device is still unavailable).
    pub fn resume(&self, _app: &AppHandle) -> Result<(), String> {
        self.cmd_tx.send(Cmd::Resume).map_err(|_| "stream gone".to_string())
    }

    /// Stops the stream, flushes the WAV and returns the recorded duration in ms.
    /// A worker that died earlier (disk error) has already patched the header and
    /// reported the error; its sample count still describes the playable file.
    pub fn stop(mut self, app: &AppHandle) -> Result<u64, String> {
        let (ack_tx, ack_rx) = mpsc::sync_channel::<()>(1);
        if self.cmd_tx.send(Cmd::Stop(ack_tx)).is_ok() {
            let _ = ack_rx.recv_timeout(Duration::from_secs(5));
        }
        self.state.store(STATE_IDLE, Ordering::SeqCst);
        let samples = match self.worker.take() {
            Some(h) => match h.join() {
                Ok(Ok(samples)) => samples,
                Ok(Err(e)) => {
                    eprintln!("audio worker ended with error: {e}");
                    self.clock.samples()
                }
                Err(_) => {
                    eprintln!("audio worker panicked");
                    self.clock.samples()
                }
            },
            None => self.clock.samples(),
        };
        emit_state(app, "stopped", None);
        Ok(samples * 1000 / SAMPLE_RATE as u64)
    }

    pub fn set_asr_sink(&self, tx: Option<SyncSender<AsrInput>>) {
        *self.asr_tx.lock().unwrap() = tx;
    }

    /// Dev/test only: plays a WAV into the pipeline in real time as if the mic
    /// heard it (the real mic is muted meanwhile). Returns the WAV duration in ms.
    pub fn inject_wav(&self, path: &Path) -> Result<u64, String> {
        if !cfg!(debug_assertions) {
            return Err("dev_only".into());
        }
        let (rate, samples) = crate::asr::engine::read_wav_f32(path)?;
        let samples = linear_resample(&samples, rate, self.device_rate);
        let duration_ms = samples.len() as u64 * 1000 / self.device_rate as u64;
        let tx = self.inject_tx.clone();
        let muted = self.mic_muted.clone();
        let chunk = (self.device_rate / 10) as usize;
        std::thread::Builder::new()
            .name("markpdf-audio-inject".into())
            .spawn(move || {
                muted.store(true, Ordering::SeqCst);
                let start = Instant::now();
                for (i, c) in samples.chunks(chunk).enumerate() {
                    let due = start + Duration::from_millis(i as u64 * 100);
                    let now = Instant::now();
                    if due > now {
                        std::thread::sleep(due - now);
                    }
                    if tx.send(Chunk::Data(c.to_vec())).is_err() {
                        break;
                    }
                }
                muted.store(false, Ordering::SeqCst);
            })
            .map_err(|e| e.to_string())?;
        Ok(duration_ms)
    }
}

/// Good enough for the dev virtual mic (upsampling speech); not used on the real path.
fn linear_resample(input: &[f32], from: u32, to: u32) -> Vec<f32> {
    if from == to || input.is_empty() {
        return input.to_vec();
    }
    let n = (input.len() as u64 * to as u64 / from as u64) as usize;
    (0..n)
        .map(|i| {
            let pos = i as f64 * from as f64 / to as f64;
            let j = pos.floor() as usize;
            let frac = (pos - j as f64) as f32;
            let a = input[j.min(input.len() - 1)];
            let b = input[(j + 1).min(input.len() - 1)];
            a + (b - a) * frac
        })
        .collect()
}

/// Opens the default input device and wires its callbacks to `chunk_tx`.
/// Device errors flip `broken`, mark the recorder paused and tell the UI.
fn build_stream(app: &AppHandle, chunk_tx: &SyncSender<Chunk>, state: &Arc<AtomicU8>, muted: &Arc<AtomicBool>, broken: &Arc<AtomicBool>) -> Result<(cpal::Stream, u32), String> {
    let host = cpal::default_host();
    let device = host.default_input_device().ok_or_else(|| "mic_not_found".to_string())?;
    let config = device.default_input_config().map_err(|e| format!("mic_permission_denied: {e}"))?;
    let channels = config.channels() as usize;
    let rate = config.sample_rate().0;

    let err_app = app.clone();
    let err_state = state.clone();
    let err_broken = broken.clone();
    let err_fn = move |e: cpal::StreamError| {
        eprintln!("audio stream error: {e}");
        err_broken.store(true, Ordering::SeqCst);
        err_state.store(STATE_PAUSED, Ordering::SeqCst);
        emit_state(&err_app, "interrupted", Some(e.to_string()));
    };

    // The callback must never block: a full queue drops the chunk (the worker is
    // stalled on disk) rather than stalling the audio thread.
    let push = {
        let tx = chunk_tx.clone();
        move |mono: Vec<f32>| {
            let _ = tx.try_send(Chunk::Data(mono));
        }
    };
    let m1 = muted.clone();
    let m2 = muted.clone();
    let m3 = muted.clone();
    let p1 = push.clone();
    let p2 = push.clone();
    let p3 = push;
    let stream = match config.sample_format() {
        cpal::SampleFormat::F32 => device.build_input_stream(
            &config.into(),
            move |data: &[f32], _| {
                if !m1.load(Ordering::Relaxed) {
                    p1(downmix(data, channels));
                }
            },
            err_fn,
            None,
        ),
        cpal::SampleFormat::I16 => device.build_input_stream(
            &config.into(),
            move |data: &[i16], _| {
                if !m2.load(Ordering::Relaxed) {
                    let f: Vec<f32> = data.iter().map(|s| *s as f32 / 32768.0).collect();
                    p2(downmix(&f, channels));
                }
            },
            err_fn,
            None,
        ),
        cpal::SampleFormat::U16 => device.build_input_stream(
            &config.into(),
            move |data: &[u16], _| {
                if !m3.load(Ordering::Relaxed) {
                    let f: Vec<f32> = data.iter().map(|s| (*s as f32 - 32768.0) / 32768.0).collect();
                    p3(downmix(&f, channels));
                }
            },
            err_fn,
            None,
        ),
        other => Err(cpal::BuildStreamError::BackendSpecific { err: cpal::BackendSpecificError { description: format!("unsupported sample format {other:?}") } }),
    }
    .map_err(|e| format!("mic_permission_denied: {e}"))?;
    Ok((stream, rate))
}

fn stream_thread(app: AppHandle, chunk_tx: SyncSender<Chunk>, cmd_rx: Receiver<Cmd>, ready_tx: SyncSender<Result<u32, String>>, state: Arc<AtomicU8>, muted: Arc<AtomicBool>) {
    // Held for the whole recording; dropped on every exit path of this thread.
    let _awake = KeepAwake::new();

    let broken = Arc::new(AtomicBool::new(false));
    let (first, mut rate) = match build_stream(&app, &chunk_tx, &state, &muted, &broken) {
        Ok(v) => v,
        Err(e) => {
            let _ = ready_tx.send(Err(e));
            return;
        }
    };
    if let Err(e) = first.play() {
        let _ = ready_tx.send(Err(format!("mic_permission_denied: {e}")));
        return;
    }
    let _ = ready_tx.send(Ok(rate));
    // `None` while the device is gone and could not be rebuilt yet.
    let mut stream: Option<cpal::Stream> = Some(first);

    for cmd in cmd_rx {
        match cmd {
            Cmd::Pause => {
                if let Some(s) = &stream {
                    let _ = s.pause();
                }
            }
            Cmd::Resume => {
                let alive = !broken.load(Ordering::SeqCst) && stream.as_ref().map(|s| s.play().is_ok()).unwrap_or(false);
                if !alive {
                    // The device went away (unplugged / switched): rebuild on the current default.
                    drop(stream.take());
                    match build_stream(&app, &chunk_tx, &state, &muted, &broken) {
                        Ok((s, r)) => {
                            if r != rate {
                                rate = r;
                                let _ = chunk_tx.send(Chunk::Rate(r));
                            }
                            broken.store(false, Ordering::SeqCst);
                            if let Err(e) = s.play() {
                                broken.store(true, Ordering::SeqCst);
                                state.store(STATE_PAUSED, Ordering::SeqCst);
                                emit_state(&app, "interrupted", Some(e.to_string()));
                                continue;
                            }
                            stream = Some(s);
                        }
                        Err(e) => {
                            state.store(STATE_PAUSED, Ordering::SeqCst);
                            emit_state(&app, "interrupted", Some(e));
                            continue;
                        }
                    }
                }
                state.store(STATE_RECORDING, Ordering::SeqCst);
                emit_state(&app, "recording", None);
            }
            Cmd::Stop(ack) => {
                drop(stream.take());
                let _ = chunk_tx.send(Chunk::End);
                let _ = ack.send(());
                break;
            }
        }
    }
}

fn downmix(data: &[f32], channels: usize) -> Vec<f32> {
    if channels <= 1 {
        return data.to_vec();
    }
    data.chunks(channels).map(|frame| frame.iter().sum::<f32>() / channels as f32).collect()
}

fn worker_thread(
    app: AppHandle,
    rx: Receiver<Chunk>,
    mut writer: WavWriter,
    clock: Arc<SampleClock>,
    device_rate: u32,
    asr_tx: Arc<Mutex<Option<SyncSender<AsrInput>>>>,
) -> Result<u64, String> {
    let result = pump(&app, rx, &mut writer, &clock, device_rate, &asr_tx);
    // Whatever happened, leave a playable file behind.
    let finalized = writer.finalize().map_err(|e| format!("finalize wav: {e}"));
    match (result, finalized) {
        (Ok(()), Ok(samples)) => {
            let _ = app.emit(EVT_TICK, TickPayload { t_ms: clock.t_ms() });
            Ok(samples)
        }
        (Err(e), _) | (Ok(()), Err(e)) => {
            eprintln!("audio worker error: {e}");
            emit_state(&app, "error", Some(e.clone()));
            Err(e)
        }
    }
}

/// Feeds the recognizer without ever blocking the audio path. Overflow is
/// remembered as a gap so the engine's clock stays aligned with the WAV.
struct AsrFeed {
    pending_gap: u64,
}

impl AsrFeed {
    fn push(&mut self, tx: &SyncSender<AsrInput>, samples: Vec<f32>) {
        if self.pending_gap > 0 {
            match tx.try_send(AsrInput::Gap(self.pending_gap)) {
                Ok(()) | Err(TrySendError::Disconnected(_)) => self.pending_gap = 0,
                Err(TrySendError::Full(_)) => {}
            }
        }
        if self.pending_gap > 0 {
            self.pending_gap += samples.len() as u64;
            return;
        }
        match tx.try_send(AsrInput::Audio(samples)) {
            Ok(()) | Err(TrySendError::Disconnected(_)) => {}
            Err(TrySendError::Full(AsrInput::Audio(s))) => self.pending_gap += s.len() as u64,
            Err(TrySendError::Full(AsrInput::Gap(n))) => self.pending_gap += n,
        }
    }
}

fn pump(app: &AppHandle, rx: Receiver<Chunk>, writer: &mut WavWriter, clock: &Arc<SampleClock>, device_rate: u32, asr_tx: &Arc<Mutex<Option<SyncSender<AsrInput>>>>) -> Result<(), String> {
    let mut resampler = MonoResampler::new(device_rate)?;
    let mut last_tick = Instant::now();
    let mut last_level = Instant::now();
    let mut level_acc: Vec<f32> = Vec::new();
    let mut feed = AsrFeed { pending_gap: 0 };

    let mut handle = |samples16: Vec<f32>, writer: &mut WavWriter| -> Result<(), String> {
        if samples16.is_empty() {
            return Ok(());
        }
        writer.write(&to_i16(&samples16)).map_err(|e| format!("write wav: {e}"))?;
        clock.add(samples16.len() as u64);
        level_acc.extend_from_slice(&samples16);
        if last_level.elapsed() >= Duration::from_millis(50) {
            let _ = app.emit(EVT_LEVEL, LevelPayload { db: level_db(&level_acc) });
            level_acc.clear();
            last_level = Instant::now();
        }
        if last_tick.elapsed() >= Duration::from_millis(100) {
            let _ = app.emit(EVT_TICK, TickPayload { t_ms: clock.t_ms() });
            last_tick = Instant::now();
        }
        if let Some(tx) = asr_tx.lock().unwrap().as_ref() {
            feed.push(tx, samples16);
        }
        Ok(())
    };

    for chunk in rx {
        match chunk {
            Chunk::Data(data) => {
                let out = resampler.push(&data);
                handle(out, writer)?;
            }
            Chunk::Rate(rate) => {
                let tail = resampler.finish();
                handle(tail, writer)?;
                resampler = MonoResampler::new(rate)?;
            }
            Chunk::End => break,
        }
    }
    let tail = resampler.finish();
    handle(tail, writer)?;
    Ok(())
}

/// Keeps the machine from idle-sleeping while a lecture is being recorded.
struct KeepAwake {
    /// `caffeinate -i`, tied to our pid so it can never outlive the app.
    #[cfg(target_os = "macos")]
    caffeinate: Option<std::process::Child>,
}

impl KeepAwake {
    fn new() -> Self {
        #[cfg(windows)]
        unsafe {
            use windows_sys::Win32::System::Power::{SetThreadExecutionState, ES_CONTINUOUS, ES_SYSTEM_REQUIRED};
            SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED);
        }
        Self {
            #[cfg(target_os = "macos")]
            caffeinate: std::process::Command::new("/usr/bin/caffeinate")
                .args(["-i", "-w", &std::process::id().to_string()])
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .spawn()
                .ok(),
        }
    }
}

impl Drop for KeepAwake {
    fn drop(&mut self) {
        // Same thread as `new`: the Windows execution state is per thread.
        #[cfg(windows)]
        unsafe {
            use windows_sys::Win32::System::Power::{SetThreadExecutionState, ES_CONTINUOUS};
            SetThreadExecutionState(ES_CONTINUOUS);
        }
        #[cfg(target_os = "macos")]
        if let Some(mut child) = self.caffeinate.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}
