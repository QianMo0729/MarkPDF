//! 16 kHz / mono / 16-bit WAV writer whose RIFF and data sizes are patched
//! every few seconds so a crash still leaves a playable file (docs/SPEC.md 7.3).

use std::fs::{File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::Path;

pub const SAMPLE_RATE: u32 = 16_000;
const CHANNELS: u16 = 1;
const BITS: u16 = 16;
const HEADER_LEN: u64 = 44;
const PATCH_EVERY_SAMPLES: u64 = 5 * SAMPLE_RATE as u64;

pub struct WavWriter {
    file: File,
    samples: u64,
    since_patch: u64,
}

impl WavWriter {
    pub fn create(path: &Path) -> std::io::Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let mut file = OpenOptions::new().create(true).write(true).read(true).truncate(true).open(path)?;
        file.write_all(&header(0))?;
        Ok(Self { file, samples: 0, since_patch: 0 })
    }

    /// Append to an existing WAV (crash recovery / resume after restart).
    pub fn append(path: &Path) -> std::io::Result<Self> {
        // An interrupted recording may have PCM beyond the last header patch.
        // Repair before seeking so continuing never overwrites that saved tail.
        let info = repair(path)?;
        let mut file = OpenOptions::new().write(true).read(true).open(path)?;
        file.seek(SeekFrom::Start(HEADER_LEN + info.samples * 2))?;
        Ok(Self { file, samples: info.samples, since_patch: 0 })
    }

    pub fn write(&mut self, pcm: &[i16]) -> std::io::Result<()> {
        let mut bytes = Vec::with_capacity(pcm.len() * 2);
        for s in pcm {
            bytes.extend_from_slice(&s.to_le_bytes());
        }
        self.file.write_all(&bytes)?;
        self.samples += pcm.len() as u64;
        self.since_patch += pcm.len() as u64;
        if self.since_patch >= PATCH_EVERY_SAMPLES {
            self.patch_header()?;
            self.since_patch = 0;
        }
        Ok(())
    }

    pub fn samples(&self) -> u64 {
        self.samples
    }

    pub fn patch_header(&mut self) -> std::io::Result<()> {
        let pos = self.file.stream_position()?;
        self.file.seek(SeekFrom::Start(0))?;
        self.file.write_all(&header(self.samples))?;
        self.file.seek(SeekFrom::Start(pos))?;
        self.file.flush()
    }

    pub fn finalize(mut self) -> std::io::Result<u64> {
        self.patch_header()?;
        self.file.sync_all()?;
        Ok(self.samples)
    }
}

fn header(samples: u64) -> [u8; 44] {
    let data_len = (samples * 2) as u32;
    let byte_rate = SAMPLE_RATE * CHANNELS as u32 * (BITS as u32 / 8);
    let block_align = CHANNELS * (BITS / 8);
    let mut h = [0u8; 44];
    h[0..4].copy_from_slice(b"RIFF");
    h[4..8].copy_from_slice(&(36 + data_len).to_le_bytes());
    h[8..12].copy_from_slice(b"WAVE");
    h[12..16].copy_from_slice(b"fmt ");
    h[16..20].copy_from_slice(&16u32.to_le_bytes());
    h[20..22].copy_from_slice(&1u16.to_le_bytes());
    h[22..24].copy_from_slice(&CHANNELS.to_le_bytes());
    h[24..28].copy_from_slice(&SAMPLE_RATE.to_le_bytes());
    h[28..32].copy_from_slice(&byte_rate.to_le_bytes());
    h[32..34].copy_from_slice(&block_align.to_le_bytes());
    h[34..36].copy_from_slice(&BITS.to_le_bytes());
    h[36..40].copy_from_slice(b"data");
    h[40..44].copy_from_slice(&data_len.to_le_bytes());
    h
}

#[derive(serde::Serialize, Clone, Copy, Debug)]
pub struct WavInfo {
    pub sample_rate: u32,
    pub channels: u16,
    pub samples: u64,
    pub duration_ms: u64,
}

/// Read the header; falls back to the file length when the data size was never patched.
pub fn probe(path: &Path) -> std::io::Result<WavInfo> {
    let mut file = File::open(path)?;
    let len = file.metadata()?.len();
    let mut h = [0u8; 44];
    file.read_exact(&mut h)?;
    if &h[0..4] != b"RIFF" || &h[8..12] != b"WAVE" {
        return Err(std::io::Error::new(std::io::ErrorKind::InvalidData, "not a WAV file"));
    }
    let channels = u16::from_le_bytes([h[22], h[23]]).max(1);
    let sample_rate = u32::from_le_bytes([h[24], h[25], h[26], h[27]]).max(1);
    let bits = u16::from_le_bytes([h[34], h[35]]).max(8);
    let declared = u32::from_le_bytes([h[40], h[41], h[42], h[43]]) as u64;
    let available = len.saturating_sub(HEADER_LEN);
    let data_len = if declared == 0 || declared > available { available } else { declared };
    let frame = channels as u64 * (bits as u64 / 8);
    let samples = data_len / frame.max(1);
    Ok(WavInfo { sample_rate, channels, samples, duration_ms: samples * 1000 / sample_rate as u64 })
}

/// Crash recovery (docs/SPEC.md 6.5.18): make the header agree with the PCM that is
/// actually on disk. Only the writer's own 16 kHz / mono / 16-bit layout is accepted;
/// a trailing partial sample is cut off. Returns the repaired file's info.
pub fn repair(path: &Path) -> std::io::Result<WavInfo> {
    let mut file = OpenOptions::new().read(true).write(true).open(path)?;
    let len = file.metadata()?.len();
    let mut h = [0u8; 44];
    file.read_exact(&mut h)?;
    let invalid = |m: &str| std::io::Error::new(std::io::ErrorKind::InvalidData, m.to_string());
    if &h[0..4] != b"RIFF" || &h[8..12] != b"WAVE" || &h[12..16] != b"fmt " || &h[36..40] != b"data" {
        return Err(invalid("not a MarkPDF WAV file"));
    }
    let channels = u16::from_le_bytes([h[22], h[23]]);
    let rate = u32::from_le_bytes([h[24], h[25], h[26], h[27]]);
    let bits = u16::from_le_bytes([h[34], h[35]]);
    if channels != CHANNELS || rate != SAMPLE_RATE || bits != BITS {
        return Err(invalid("unexpected WAV format"));
    }
    let samples = len.saturating_sub(HEADER_LEN) / 2;
    file.set_len(HEADER_LEN + samples * 2)?;
    file.seek(SeekFrom::Start(0))?;
    file.write_all(&header(samples))?;
    file.sync_all()?;
    Ok(WavInfo { sample_rate: SAMPLE_RATE, channels: CHANNELS, samples, duration_ms: samples * 1000 / SAMPLE_RATE as u64 })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn declared_data_len(path: &Path) -> u32 {
        let bytes = std::fs::read(path).unwrap();
        u32::from_le_bytes([bytes[40], bytes[41], bytes[42], bytes[43]])
    }

    #[test]
    fn repair_fixes_a_file_that_was_never_finalized() {
        let dir = std::env::temp_dir().join(format!("markpdf-wav-repair-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        // 3 s written, header still says 0 (crash inside the first 5 s patch window).
        let path = dir.join("short.wav");
        let w = WavWriter::create(&path).unwrap();
        let mut w = w;
        w.write(&vec![1i16; 16_000 * 3]).unwrap();
        drop(w); // no finalize
        assert_eq!(declared_data_len(&path), 0);
        let info = repair(&path).unwrap();
        assert_eq!(info.samples, 48_000);
        assert_eq!(info.duration_ms, 3000);
        assert_eq!(declared_data_len(&path), 96_000);
        assert_eq!(probe(&path).unwrap().duration_ms, 3000);

        // 5 s patched, then 2 s more and a stray odd byte: header says 5 s, file holds 7 s.
        let path = dir.join("stale.wav");
        let mut w = WavWriter::create(&path).unwrap();
        w.write(&vec![1i16; 16_000 * 5]).unwrap();
        w.write(&vec![1i16; 16_000 * 2]).unwrap();
        drop(w);
        {
            use std::io::Write;
            let mut f = OpenOptions::new().append(true).open(&path).unwrap();
            f.write_all(&[7u8]).unwrap();
        }
        assert_eq!(declared_data_len(&path), 160_000);
        let info = repair(&path).unwrap();
        assert_eq!(info.duration_ms, 7000);
        assert_eq!(std::fs::metadata(&path).unwrap().len(), HEADER_LEN + 224_000);
        assert_eq!(declared_data_len(&path), 224_000);

        // Foreign layouts are refused untouched.
        let path = dir.join("foreign.wav");
        let mut h = header(10);
        h[24..28].copy_from_slice(&44_100u32.to_le_bytes());
        std::fs::write(&path, h).unwrap();
        assert!(repair(&path).is_err());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn append_preserves_finalized_audio_and_unpatched_crash_tail() {
        let dir = std::env::temp_dir().join(format!("markpdf-wav-append-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        for finalized in [false, true] {
            let path = dir.join(if finalized { "saved.wav" } else { "crashed.wav" });
            let mut w = WavWriter::create(&path).unwrap();
            w.write(&vec![123i16; 16_000 * 5]).unwrap();
            w.write(&vec![-456i16; 16_000 * 2]).unwrap();
            if finalized { w.finalize().unwrap(); } else { drop(w); }
            let original_pcm = std::fs::read(&path).unwrap()[44..].to_vec();
            let mut w = WavWriter::append(&path).unwrap();
            assert_eq!(w.samples(), 16_000 * 7);
            w.write(&vec![789i16; 16_000]).unwrap();
            assert_eq!(w.finalize().unwrap(), 16_000 * 8);
            let bytes = std::fs::read(&path).unwrap();
            assert_eq!(&bytes[44..44 + original_pcm.len()], original_pcm.as_slice());
            assert_eq!(&bytes[44 + original_pcm.len()..], vec![789i16.to_le_bytes(); 16_000].concat());
            assert_eq!(probe(&path).unwrap().duration_ms, 8000);
        }
        let missing = dir.join("missing.wav");
        assert!(WavWriter::append(&missing).is_err());
        assert!(!missing.exists());
        let foreign = dir.join("foreign.wav");
        let mut bytes = header(0);
        bytes[24..28].copy_from_slice(&44_100u32.to_le_bytes());
        std::fs::write(&foreign, bytes).unwrap();
        assert!(WavWriter::append(&foreign).is_err());
        assert_eq!(std::fs::read(&foreign).unwrap(), bytes);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn header_is_patched_and_probe_reads_it() {
        let dir = std::env::temp_dir().join(format!("markpdf-wav-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("t.wav");
        let mut w = WavWriter::create(&path).unwrap();
        w.write(&vec![0i16; 16_000 * 3]).unwrap();
        // Before finalize: header still says 0 samples, probe falls back to file length.
        let info = probe(&path).unwrap();
        assert_eq!(info.samples, 48_000);
        assert_eq!(info.duration_ms, 3000);
        w.write(&vec![0i16; 16_000 * 3]).unwrap(); // crosses the 5 s patch threshold
        let info = probe(&path).unwrap();
        assert_eq!(info.duration_ms, 6000);
        let total = w.finalize().unwrap();
        assert_eq!(total, 96_000);
        std::fs::remove_dir_all(&dir).ok();
    }
}
