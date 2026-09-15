//! The only clock the timeline trusts: samples written at 16 kHz (docs/SPEC.md 5.1 / 7.4).

use std::sync::atomic::{AtomicU64, Ordering};

use super::wav_writer::SAMPLE_RATE;

#[derive(Default)]
pub struct SampleClock {
    total_samples: AtomicU64,
}

impl SampleClock {
    pub fn new(initial_samples: u64) -> Self {
        Self { total_samples: AtomicU64::new(initial_samples) }
    }

    pub fn add(&self, samples: u64) -> u64 {
        self.total_samples.fetch_add(samples, Ordering::Relaxed) + samples
    }

    pub fn samples(&self) -> u64 {
        self.total_samples.load(Ordering::Relaxed)
    }

    pub fn t_ms(&self) -> u64 {
        self.samples() * 1000 / SAMPLE_RATE as u64
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_samples_to_ms() {
        let c = SampleClock::new(0);
        c.add(16_000);
        assert_eq!(c.t_ms(), 1000);
        c.add(8_000);
        assert_eq!(c.t_ms(), 1500);
    }
}
