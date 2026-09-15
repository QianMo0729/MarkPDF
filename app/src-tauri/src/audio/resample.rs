//! Device rate -> 16 kHz mono resampling (docs/SPEC.md 7.2).

use rubato::{FastFixedIn, PolynomialDegree, Resampler};

use super::wav_writer::SAMPLE_RATE;

const CHUNK: usize = 1024;

pub struct MonoResampler {
    inner: Option<FastFixedIn<f32>>,
    pending: Vec<f32>,
}

impl MonoResampler {
    pub fn new(device_rate: u32) -> Result<Self, String> {
        if device_rate == SAMPLE_RATE {
            return Ok(Self { inner: None, pending: Vec::new() });
        }
        let ratio = SAMPLE_RATE as f64 / device_rate as f64;
        let inner = FastFixedIn::<f32>::new(ratio, 1.0, PolynomialDegree::Cubic, CHUNK, 1).map_err(|e| e.to_string())?;
        Ok(Self { inner: Some(inner), pending: Vec::with_capacity(CHUNK * 2) })
    }

    /// Feed device-rate mono samples; returns whatever 16 kHz samples are ready.
    pub fn push(&mut self, input: &[f32]) -> Vec<f32> {
        let Some(rs) = self.inner.as_mut() else {
            return input.to_vec();
        };
        self.pending.extend_from_slice(input);
        let mut out = Vec::new();
        while self.pending.len() >= CHUNK {
            let chunk: Vec<f32> = self.pending.drain(..CHUNK).collect();
            if let Ok(frames) = rs.process(&[chunk.as_slice()], None) {
                if let Some(ch) = frames.into_iter().next() {
                    out.extend(ch);
                }
            }
        }
        out
    }

    /// Flush the tail at stop.
    pub fn finish(&mut self) -> Vec<f32> {
        let Some(rs) = self.inner.as_mut() else {
            return Vec::new();
        };
        let mut out = Vec::new();
        if !self.pending.is_empty() {
            let tail = std::mem::take(&mut self.pending);
            if let Ok(frames) = rs.process_partial(Some(&[tail.as_slice()]), None) {
                if let Some(ch) = frames.into_iter().next() {
                    out.extend(ch);
                }
            }
        }
        if let Ok(frames) = rs.process_partial::<&[f32]>(None, None) {
            if let Some(ch) = frames.into_iter().next() {
                out.extend(ch);
            }
        }
        out
    }
}

pub fn to_i16(samples: &[f32]) -> Vec<i16> {
    samples.iter().map(|s| (s.clamp(-1.0, 1.0) * 32767.0).round() as i16).collect()
}

/// RMS level in dBFS, clamped to [-60, 0].
pub fn level_db(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return -60.0;
    }
    let sum: f32 = samples.iter().map(|s| s * s).sum();
    let rms = (sum / samples.len() as f32).sqrt();
    if rms <= 0.0 {
        return -60.0;
    }
    (20.0 * rms.log10()).clamp(-60.0, 0.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resamples_48k_to_16k() {
        let mut r = MonoResampler::new(48_000).unwrap();
        let input: Vec<f32> = (0..48_000).map(|i| ((i as f32) * 0.01).sin()).collect();
        let mut out = r.push(&input);
        out.extend(r.finish());
        // The final flush emits the resampler's internal delay as a short tail (< 40 ms).
        let n = out.len() as i64;
        assert!((n - 16_000).abs() < 640, "got {n} samples");
    }

    #[test]
    fn passthrough_at_16k() {
        let mut r = MonoResampler::new(16_000).unwrap();
        assert_eq!(r.push(&[0.5, -0.5]).len(), 2);
    }

    #[test]
    fn level_of_silence_is_floor() {
        assert_eq!(level_db(&[0.0; 100]), -60.0);
        assert!(level_db(&[1.0; 100]) > -1.0);
    }
}
