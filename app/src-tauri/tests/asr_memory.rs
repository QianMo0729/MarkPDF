//! Opt-in: measures how much memory a streaming model takes once loaded and
//! decoding (docs/SPEC.md 16.2 "实测内存占用"). Never runs by default.
//!
//! Set MARKPDF_ASR_MODEL_DIR to a model directory, then:
//! cargo test --release --test asr_memory model_memory -- --ignored --nocapture
//!
//! Prints the process working set before loading, after loading, and the peak
//! while decoding 20 s of audio (silence unless MARKPDF_ASR_SMOKE_WAV is set).

#[allow(dead_code)]
#[path = "../src/asr/engine.rs"]
mod engine;

use std::path::{Path, PathBuf};

use engine::{Decoder, SAMPLE_RATE};

#[cfg(windows)]
fn working_set() -> (u64, u64) {
    use windows_sys::Win32::System::ProcessStatus::{K32GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS};
    use windows_sys::Win32::System::Threading::GetCurrentProcess;
    let mut c = PROCESS_MEMORY_COUNTERS { cb: std::mem::size_of::<PROCESS_MEMORY_COUNTERS>() as u32, ..unsafe { std::mem::zeroed() } };
    let ok = unsafe { K32GetProcessMemoryInfo(GetCurrentProcess(), &mut c, c.cb) };
    assert!(ok != 0, "GetProcessMemoryInfo failed");
    (c.WorkingSetSize as u64, c.PeakWorkingSetSize as u64)
}

#[cfg(not(windows))]
fn working_set() -> (u64, u64) {
    let status = std::fs::read_to_string("/proc/self/status").unwrap_or_default();
    let grab = |key: &str| status.lines().find(|l| l.starts_with(key)).and_then(|l| l.split_whitespace().nth(1)).and_then(|v| v.parse::<u64>().ok()).unwrap_or(0) * 1024;
    (grab("VmRSS:"), grab("VmHWM:"))
}

fn mib(b: u64) -> f64 {
    b as f64 / 1024.0 / 1024.0
}

#[test]
#[ignore]
fn model_memory() {
    let dir = std::env::var_os("MARKPDF_ASR_MODEL_DIR").map(PathBuf::from).expect("set MARKPDF_ASR_MODEL_DIR");
    let (before, _) = working_set();
    let t = std::time::Instant::now();
    let mut decoder = Decoder::new(&dir, 0).expect("model load failed");
    let load_ms = t.elapsed().as_millis();
    let (loaded, _) = working_set();
    let audio: Vec<f32> = match std::env::var_os("MARKPDF_ASR_SMOKE_WAV") {
        Some(p) => engine::read_wav_f32(Path::new(&p)).expect("wav").1,
        None => vec![0.0; SAMPLE_RATE as usize * 20],
    };
    let mut segments = 0;
    let mut on_partial = |_: &str| {};
    let mut on_final = |_| segments += 1;
    let t = std::time::Instant::now();
    for chunk in audio.chunks(1600) {
        decoder.feed(chunk, &mut on_partial, &mut on_final);
    }
    decoder.finish(&mut on_final);
    let decode_ms = t.elapsed().as_millis();
    let (after, peak) = working_set();
    println!(
        "model={} load_ms={} decode_ms={} audio_s={:.1} segments={}\nworking set: before={:.0} MiB loaded={:.0} MiB after-decode={:.0} MiB peak={:.0} MiB\nmodel cost (peak - before) = {:.0} MiB",
        dir.display(),
        load_ms,
        decode_ms,
        audio.len() as f64 / SAMPLE_RATE as f64,
        segments,
        mib(before),
        mib(loaded),
        mib(after),
        mib(peak),
        mib(peak.saturating_sub(before))
    );
}
