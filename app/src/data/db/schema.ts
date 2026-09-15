/** Row types mirror src-tauri/migrations/0001_init.sql column for column. Booleans are 0/1. */

export interface CourseRow {
  id: string;
  name: string;
  term: string | null;
  color_index: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  dirty: number;
}

export type DeckStatus = "importing" | "uploading" | "converting" | "ready" | "error";

export interface DeckRow {
  id: string;
  course_id: string;
  title: string;
  source_type: "pdf" | "pptx";
  page_count: number;
  file_sha256: string;
  remote_key: string | null;
  status: DeckStatus;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  local_pdf_path: string | null;
  local_source_path: string | null;
  dirty: number;
}

export interface DeckPageRow {
  deck_id: string;
  page_index: number;
  width_pt: number;
  height_pt: number;
  text: string;
  speaker_notes: string | null;
  updated_at: string;
}

export type LangMode = "auto" | "zh" | "en";
export type AudioStatus = "recording" | "local" | "uploading" | "uploaded" | "processed" | "error";
export type AsrStatus = "none" | "device" | "server_pending" | "server_done";
export type SummaryStatus = "none" | "pending" | "ready" | "error";

export interface SessionRow {
  id: string;
  course_id: string;
  deck_id: string;
  title: string;
  started_at: string | null;
  ended_at: string | null;
  duration_ms: number | null;
  initial_page_index: number;
  lang_mode: LangMode;
  audio_status: AudioStatus;
  asr_status: AsrStatus;
  summary_status: SummaryStatus;
  audio_wav_key: string | null;
  audio_m4a_key: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  local_wav_path: string | null;
  local_m4a_path: string | null;
  dirty: number;
}

export interface NoteRow {
  id: string;
  deck_id: string;
  page_index: number;
  markdown: string;
  created_at: string;
  updated_at: string;
  dirty: number;
}

export type AnnotationKind = "text_box" | "highlight" | "ink";

export interface AnnotationRow {
  id: string;
  deck_id: string;
  page_index: number;
  kind: AnnotationKind;
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  markdown: string | null;
  selected_text: string | null;
  quads_json: string | null;
  strokes_json: string | null;
  stroke_width: number | null;
  font_size: number | null;
  /** text_box frame; null = no border / no fill (docs/SPEC.md 6.5.5). */
  border_color: string | null;
  fill_color: string | null;
  z: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  dirty: number;
}

export interface TranscriptSegmentRow {
  id: string;
  session_id: string;
  source: "device" | "server";
  t0_ms: number;
  t1_ms: number;
  text: string;
  /** First ASR wording before any AI correction; absent/null on unchanged rows. */
  original_text?: string | null;
  translation: string | null;
  lang: "zh" | "en" | "mixed" | null;
  page_index: number | null;
  created_at: string;
  updated_at: string;
  dirty: number;
}

export interface PageSummaryRow {
  id: string;
  session_id: string;
  page_index: number;
  content_json: string;
  edited_by_user: number;
  created_at: string;
  updated_at: string;
  dirty: number;
}

export interface SessionSummaryRow {
  id: string;
  session_id: string;
  content_json: string;
  edited_by_user: number;
  created_at: string;
  updated_at: string;
  dirty: number;
}

export type EventType =
  | "page_change"
  | "note_snapshot"
  | "annotation_snapshot"
  | "marker"
  | "recording_state";

export interface EventRow {
  id: string;
  session_id: string;
  type: EventType;
  t_ms: number;
  payload_json: string;
  device_id: string;
  created_at: string;
  server_seq: number | null;
  synced: number;
}

export interface AsrModelRow {
  id: string;
  name: string;
  dir_path: string | null;
  size_bytes: number;
  sha256: string | null;
  status: "not_downloaded" | "downloading" | "ready" | "error";
  progress: number;
}

export type MindmapKind = "root" | "excerpt" | "text";

export interface MindmapNodeRow {
  id: string;
  deck_id: string;
  parent_id: string | null;
  kind: MindmapKind;
  markdown: string;
  annotation_id: string | null;
  page_index: number | null;
  order_index: number;
  color: string | null;
  collapsed: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  dirty: number;
}
