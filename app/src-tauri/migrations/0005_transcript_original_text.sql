-- Preserve the first ASR sentence only when a correction is actually applied.
-- Existing transcripts keep their text, translations, timestamps and dirty flag.
ALTER TABLE transcript_segments ADD COLUMN original_text TEXT;
