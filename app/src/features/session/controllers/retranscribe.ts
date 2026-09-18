import { exists } from "@tauri-apps/plugin-fs";
import { create } from "zustand";
import { newId } from "../../../core/utils/ids";
import { listEvents } from "../../../data/db/repos/events";
import { getSession, updateSession } from "../../../data/db/repos/sessions";
import { replaceDeviceSegments } from "../../../data/db/repos/transcripts";
import type { SessionRow } from "../../../data/db/schema";
import { sessionWavPath } from "../../../data/files/file_store";
import { eventFromRow, Timeline } from "../../../domain/timeline";
import { asrTranscribeCancel, asrTranscribeFile, onAsrTranscribeProgress, type AsrFinal } from "../../../platform/asr";
import { useSettings } from "../../../stores/settings";
import { useModelManager } from "../../settings/modelManager";
import { useRecording } from "./recording";

/**
 * Re-run on-device transcription over a finished recording (docs/SPEC.md 16.1).
 * The WAV is decoded offline with the same engine as live transcription; the
 * resulting segments replace the session's device transcript (corrections and
 * translations of the old rows go with them) and are re-attached to pages via
 * the recording's page-change events.
 */

export interface RetranscribeJob {
  jobId: string;
  status: "running" | "done" | "error";
  doneMs: number;
  totalMs: number;
  error?: string;
  segments?: number;
}

interface RetranscribeStore {
  jobs: Record<string, RetranscribeJob>;
  start: (sessionId: string) => Promise<void>;
  cancel: (sessionId: string) => Promise<void>;
  dismiss: (sessionId: string) => void;
}

export class NoModelError extends Error {
  constructor() {
    super("没有可用的转写模型");
  }
}

/** Attach each segment to the page that was open when it started. */
export function segmentsWithPages(segments: AsrFinal[], timeline: Timeline | null): { t0_ms: number; t1_ms: number; text: string; page_index: number | null }[] {
  return segments
    .filter((s) => s.text.trim())
    .map((s) => ({ t0_ms: s.t0_ms, t1_ms: s.t1_ms, text: s.text.trim(), page_index: timeline ? timeline.pageAt(s.t0_ms) : null }));
}

async function timelineFor(session: SessionRow): Promise<Timeline> {
  const rows = await listEvents(session.id);
  return new Timeline({ events: rows.map(eventFromRow), initialPageIndex: session.initial_page_index, durationMs: session.duration_ms ?? 0 });
}

let listening = false;
async function ensureListener(set: (fn: (s: RetranscribeStore) => Partial<RetranscribeStore>) => void) {
  if (listening) return;
  listening = true;
  await onAsrTranscribeProgress((p) => {
    set((s) => {
      const entry = Object.entries(s.jobs).find(([, j]) => j.jobId === p.job_id);
      if (!entry) return {};
      const [sessionId, job] = entry;
      return { jobs: { ...s.jobs, [sessionId]: { ...job, doneMs: p.done_ms, totalMs: p.total_ms } } };
    });
  });
}

export const useRetranscribe = create<RetranscribeStore>((set, get) => ({
  jobs: {},

  start: async (sessionId) => {
    if (get().jobs[sessionId]?.status === "running") return;
    const rec = useRecording.getState();
    if (rec.sessionId === sessionId && (rec.status !== "idle" || rec.starting)) throw new Error("录音仍在进行，结束后再重新转写");
    const session = await getSession(sessionId);
    if (!session || !session.started_at) throw new Error("这节课没有录音");
    const wav = session.local_wav_path ?? (await sessionWavPath(sessionId));
    if (!(await exists(wav))) throw new Error(`找不到录音文件：${wav}`);
    const { langMode, asrModelZh, asrModelEn } = useSettings.getState().settings;
    const mm = useModelManager.getState();
    if (!mm.loaded) await mm.load().catch(() => undefined);
    const lang = (session.lang_mode as "auto" | "zh" | "en" | null) ?? langMode;
    const dir = await useModelManager.getState().readyDirFor(lang, { zh: asrModelZh, en: asrModelEn });
    if (!dir) throw new NoModelError();
    await ensureListener(set);
    const jobId = newId();
    set((s) => ({ jobs: { ...s.jobs, [sessionId]: { jobId, status: "running", doneMs: 0, totalMs: session.duration_ms ?? 0 } } }));
    try {
      const result = await asrTranscribeFile(jobId, dir, wav);
      const timeline = await timelineFor(session).catch(() => null);
      const rows = segmentsWithPages(result.segments, timeline);
      await replaceDeviceSegments(sessionId, rows);
      await updateSession(sessionId, { asr_status: "device" });
      set((s) => ({ jobs: { ...s.jobs, [sessionId]: { jobId, status: "done", doneMs: result.audio_ms, totalMs: result.audio_ms, segments: rows.length } } }));
    } catch (e) {
      const message = String(e instanceof Error ? e.message : e);
      if (/cancelled/.test(message)) {
        set((s) => {
          const jobs = { ...s.jobs };
          delete jobs[sessionId];
          return { jobs };
        });
        return;
      }
      set((s) => ({ jobs: { ...s.jobs, [sessionId]: { jobId, status: "error", doneMs: 0, totalMs: 0, error: message } } }));
      throw e;
    }
  },

  cancel: async (sessionId) => {
    const job = get().jobs[sessionId];
    if (!job || job.status !== "running") return;
    await asrTranscribeCancel(job.jobId);
  },

  dismiss: (sessionId) => {
    set((s) => {
      if (s.jobs[sessionId]?.status === "running") return {};
      const jobs = { ...s.jobs };
      delete jobs[sessionId];
      return { jobs };
    });
  },
}));
