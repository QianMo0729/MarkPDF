//! Opt-in native ASR check; never starts Tauri, a microphone, or the installed app.
//!
//! Set MARKPDF_ASR_MODEL_DIR to a downloaded model directory containing
//! encoder.onnx, decoder.onnx, joiner.onnx and tokens.txt, then run:
//! cargo test --release --test asr_native_smoke native_asr_smoke -- --ignored --nocapture
//!
//! Optionally set MARKPDF_ASR_SMOKE_WAV to an explicitly chosen public/synthetic
//! 16 kHz PCM16 WAV and MARKPDF_ASR_EXPECT_TEXT to a phrase it should recognize.
//! MARKPDF_ASR_EXPECT_KEYWORDS accepts comma-separated words; at least two
//! (or the only word supplied) must occur, allowing minor recognition errors.
//! No model or audio path is inferred from the user's application data.

// Exercise the production decoder without making the app's private ASR module
// public or duplicating its model configuration in this test.
#[allow(dead_code)]
#[path = "../src/asr/engine.rs"]
mod engine;

use std::path::{Path, PathBuf};
use std::time::Instant;

use engine::{Decoder, FinalPayload, SAMPLE_RATE};

fn validate_segments(segments: &[FinalPayload], start_ms: u64, end_ms: u64) {
    let mut previous_end = start_ms;
    for segment in segments {
        assert!(!segment.text.trim().is_empty(), "empty final segment");
        assert!(segment.t0_ms >= previous_end, "segment timestamps went backwards");
        assert!(segment.t1_ms > segment.t0_ms, "non-positive segment duration");
        assert!(segment.t1_ms <= end_ms + 200, "segment extends past the input clock");
        previous_end = segment.t1_ms;
    }
}

fn check_silence(model_dir: &Path) {
    let started = Instant::now();
    let offset_ms = 10_000;
    let mut decoder = Decoder::new(model_dir, offset_ms).expect("native model load failed");
    let load_ms = started.elapsed().as_millis();
    let mut partial_count = 0;
    let mut segments = Vec::new();
    let mut on_partial = |_: &str| partial_count += 1;
    let mut on_final = |segment| segments.push(segment);
    let silence = [0.0_f32; 1600];

    // 100 ms chunks match asr_bench and pass enough samples to run the encoder,
    // its endpoint/reset path, and the audio-gap handling used by live capture.
    for _ in 0..30 {
        decoder.feed(&silence, &mut on_partial, &mut on_final);
    }
    assert_eq!(decoder.position_ms(), offset_ms + 3000);
    decoder.skip(SAMPLE_RATE as u64 / 5, &mut on_partial, &mut on_final);
    assert_eq!(decoder.position_ms(), offset_ms + 3200);
    for _ in 0..10 {
        decoder.feed(&silence, &mut on_partial, &mut on_final);
    }
    decoder.finish(&mut on_final);
    assert_eq!(decoder.position_ms(), offset_ms + 4200);
    validate_segments(&segments, offset_ms, offset_ms + 4200);
    // Silence output is diagnostic: this checks native loading/decoding and
    // lifecycle stability, not a model's accuracy or hallucination rate.
    eprintln!(
        "native ASR silence: load={load_ms} ms, total={} ms, audio=4000 ms, gap=200 ms, partials={partial_count}, finals={}",
        started.elapsed().as_millis(),
        segments.len()
    );
}

fn check_explicit_wav(model_dir: &Path, wav_path: &Path) {
    let (rate, samples) = engine::read_wav_f32(wav_path).expect("cannot read smoke WAV");
    assert_eq!(rate, SAMPLE_RATE, "smoke WAV must use 16 kHz PCM16 audio");
    assert!(!samples.is_empty(), "smoke WAV contains no samples");
    let mut decoder = Decoder::new(model_dir, 0).expect("native model reload failed");
    let mut segments = Vec::new();
    let mut on_partial = |_: &str| {};
    let mut on_final = |segment| segments.push(segment);
    for chunk in samples.chunks(1600) {
        decoder.feed(chunk, &mut on_partial, &mut on_final);
    }
    decoder.finish(&mut on_final);
    let audio_ms = samples.len() as u64 * 1000 / SAMPLE_RATE as u64;
    assert_eq!(decoder.position_ms(), audio_ms);
    validate_segments(&segments, 0, audio_ms);
    let text = segments.iter().map(|segment| segment.text.as_str()).collect::<Vec<_>>().join(" ");
    let normalized = text.to_lowercase();
    if let Ok(expected) = std::env::var("MARKPDF_ASR_EXPECT_TEXT") {
        assert!(!expected.trim().is_empty(), "expected phrase must not be empty");
        assert!(normalized.contains(&expected.to_lowercase()), "expected phrase was not recognized");
    }
    if let Ok(expected) = std::env::var("MARKPDF_ASR_EXPECT_KEYWORDS") {
        let words = expected.split(',').map(str::trim).filter(|word| !word.is_empty()).map(str::to_lowercase).collect::<Vec<_>>();
        assert!(!words.is_empty(), "expected keywords must not be empty");
        let hits = words.iter().filter(|word| normalized.contains(word.as_str())).count();
        assert!(hits >= words.len().min(2), "too few expected keywords were recognized ({hits}/{})", words.len());
        eprintln!("native ASR keyword check: {hits}/{} matched", words.len());
    }
    eprintln!("native ASR explicit WAV: audio={audio_ms} ms, finals={}, text={text:?}", segments.len());
}

#[test]
#[ignore = "requires explicitly selected local ASR models; not downloaded by CI"]
fn native_asr_smoke() {
    let model_dir = PathBuf::from(std::env::var_os("MARKPDF_ASR_MODEL_DIR").expect("set MARKPDF_ASR_MODEL_DIR before running this ignored test"));
    assert!(model_dir.is_dir(), "model directory does not exist");
    check_silence(&model_dir);
    if let Some(wav_path) = std::env::var_os("MARKPDF_ASR_SMOKE_WAV") {
        check_explicit_wav(&model_dir, Path::new(&wav_path));
    } else {
        assert!(std::env::var_os("MARKPDF_ASR_EXPECT_TEXT").is_none(), "MARKPDF_ASR_EXPECT_TEXT requires MARKPDF_ASR_SMOKE_WAV");
        assert!(std::env::var_os("MARKPDF_ASR_EXPECT_KEYWORDS").is_none(), "MARKPDF_ASR_EXPECT_KEYWORDS requires MARKPDF_ASR_SMOKE_WAV");
    }
}
