import { exists } from "@tauri-apps/plugin-fs";
import { newId, nowIso } from "../../core/utils/ids";
import { fmtDateShort } from "../../core/utils/time";
import { getDeck } from "../../data/db/repos/decks";
import { appendEvent } from "../../data/db/repos/events";
import { insertSession, listUnfinishedSessions, updateSession } from "../../data/db/repos/sessions";
import type { SessionRow } from "../../data/db/schema";
import { sessionWavPath } from "../../data/files/file_store";
import { deleteSessionWithFiles } from "../../domain/deletion";
import { useSettings } from "../../stores/settings";
import { wavProbe, wavRepair } from "../../platform/audio";

/** "开始上课": create a live session in its prepare state (docs/SPEC.md 6.4.3). */
export async function createSession(_courseId: string, deckId: string): Promise<SessionRow> {
  const deck = await getDeck(deckId);
  if (!deck) throw new Error("课件不存在");
  const ts = nowIso();
  const row: SessionRow = {
    id: newId(),
    course_id: deck.course_id,
    deck_id: deckId,
    title: `${deck.title} ${fmtDateShort(ts)}`,
    started_at: null,
    ended_at: null,
    duration_ms: null,
    initial_page_index: 0,
    lang_mode: useSettings.getState().settings.langMode,
    audio_status: "recording",
    asr_status: "none",
    summary_status: "none",
    audio_wav_key: null,
    audio_m4a_key: null,
    created_at: ts,
    updated_at: ts,
    deleted_at: null,
    local_wav_path: null,
    local_m4a_path: null,
    dirty: 1,
  };
  await insertSession(row);
  return row;
}

export interface UnfinishedSession {
  session: SessionRow;
  wavPath: string;
  durationMs: number;
}

/** Sessions that started recording but never ended and still have a WAV on disk (docs/SPEC.md 6.5.18). */
export async function findUnfinishedSessions(): Promise<UnfinishedSession[]> {
  const out: UnfinishedSession[] = [];
  for (const session of await listUnfinishedSessions()) {
    const wavPath = session.local_wav_path ?? (await sessionWavPath(session.id));
    if (!(await exists(wavPath))) continue;
    try {
      const info = await wavProbe(wavPath);
      out.push({ session, wavPath, durationMs: info.duration_ms });
    } catch {
      /* unreadable file: ignore */
    }
  }
  return out;
}

/**
 * "保存并结束": first make the WAV header agree with the PCM on disk (a crash
 * leaves the data size stale or zero, so players would see a shorter or empty
 * file), then close the session with the repaired length (release audit B02).
 */
export async function finishUnfinishedSession(u: UnfinishedSession): Promise<void> {
  const info = await wavRepair(u.wavPath);
  await appendEvent(u.session.id, "recording_state", info.duration_ms, { state: "stopped" });
  await updateSession(u.session.id, { ended_at: nowIso(), duration_ms: info.duration_ms, audio_status: "local", local_wav_path: u.wavPath });
}

/** "丢弃": the rows and the recording file both go (the dialog says so). */
export async function discardUnfinishedSession(u: UnfinishedSession): Promise<void> {
  await deleteSessionWithFiles({ id: u.session.id, local_wav_path: u.wavPath });
}
