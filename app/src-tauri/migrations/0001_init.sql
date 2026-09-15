-- MarkPDF schema v1. Mirrors docs/SPEC.md section 4 exactly (names and columns).
-- Booleans are INTEGER 0/1. Timestamps are ISO 8601 UTC TEXT. Positions are INTEGER ms.

CREATE TABLE IF NOT EXISTS courses (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  term TEXT,
  color_index INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  dirty INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS decks (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL,
  title TEXT NOT NULL,
  source_type TEXT NOT NULL,
  page_count INTEGER NOT NULL DEFAULT 0,
  file_sha256 TEXT NOT NULL,
  remote_key TEXT,
  status TEXT NOT NULL,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  local_pdf_path TEXT,
  local_source_path TEXT,
  dirty INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_decks_course ON decks(course_id);

CREATE TABLE IF NOT EXISTS deck_pages (
  deck_id TEXT NOT NULL,
  page_index INTEGER NOT NULL,
  width_pt REAL NOT NULL,
  height_pt REAL NOT NULL,
  text TEXT NOT NULL DEFAULT '',
  speaker_notes TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (deck_id, page_index)
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL,
  deck_id TEXT NOT NULL,
  title TEXT NOT NULL,
  started_at TEXT,
  ended_at TEXT,
  duration_ms INTEGER,
  initial_page_index INTEGER NOT NULL DEFAULT 0,
  lang_mode TEXT NOT NULL DEFAULT 'auto',
  audio_status TEXT NOT NULL DEFAULT 'recording',
  asr_status TEXT NOT NULL DEFAULT 'none',
  summary_status TEXT NOT NULL DEFAULT 'none',
  audio_wav_key TEXT,
  audio_m4a_key TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  local_wav_path TEXT,
  local_m4a_path TEXT,
  dirty INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_sessions_course ON sessions(course_id);
CREATE INDEX IF NOT EXISTS idx_sessions_deck ON sessions(deck_id);

CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  deck_id TEXT NOT NULL,
  page_index INTEGER NOT NULL,
  markdown TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  dirty INTEGER NOT NULL DEFAULT 1,
  UNIQUE (deck_id, page_index)
);

CREATE TABLE IF NOT EXISTS annotations (
  id TEXT PRIMARY KEY,
  deck_id TEXT NOT NULL,
  page_index INTEGER NOT NULL,
  kind TEXT NOT NULL,
  x REAL NOT NULL,
  y REAL NOT NULL,
  w REAL NOT NULL,
  h REAL NOT NULL,
  color TEXT NOT NULL,
  markdown TEXT,
  selected_text TEXT,
  quads_json TEXT,
  strokes_json TEXT,
  stroke_width REAL,
  font_size REAL,
  z INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  dirty INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_annotations_page ON annotations(deck_id, page_index);

CREATE TABLE IF NOT EXISTS transcript_segments (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  source TEXT NOT NULL,
  t0_ms INTEGER NOT NULL,
  t1_ms INTEGER NOT NULL,
  text TEXT NOT NULL,
  translation TEXT,
  lang TEXT,
  page_index INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  dirty INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_transcript_session ON transcript_segments(session_id, t0_ms);

CREATE TABLE IF NOT EXISTS page_summaries (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  page_index INTEGER NOT NULL,
  content_json TEXT NOT NULL,
  edited_by_user INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  dirty INTEGER NOT NULL DEFAULT 1,
  UNIQUE (session_id, page_index)
);

CREATE TABLE IF NOT EXISTS session_summaries (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL UNIQUE,
  content_json TEXT NOT NULL,
  edited_by_user INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  dirty INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  type TEXT NOT NULL,
  t_ms INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  device_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  server_seq INTEGER,
  synced INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id, t_ms);

CREATE TABLE IF NOT EXISTS sync_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS asr_models (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  dir_path TEXT,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  sha256 TEXT,
  status TEXT NOT NULL DEFAULT 'not_downloaded',
  progress REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS uploads (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  target_id TEXT NOT NULL,
  upload_id TEXT,
  part_size INTEGER,
  completed_parts_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL
);
