import type { UnlistenFn } from "@tauri-apps/api/event";
import { create } from "zustand";
import { S } from "../../../core/strings";
import { toast } from "../../../core/ui/Toast";
import { nowIso } from "../../../core/utils/ids";
import { appendEvent } from "../../../data/db/repos/events";
import { getSession, updateSession } from "../../../data/db/repos/sessions";
import { insertDeviceSegment } from "../../../data/db/repos/transcripts";
import type { AnnotationRow } from "../../../data/db/schema";
import { sessionWavPath } from "../../../data/files/file_store";
import type { MarkerKind } from "../../../domain/timeline";
import { asrStart, asrStop, onAsrFinal, onAsrPartial, onAsrStatus } from "../../../platform/asr";
import { audioPause, audioResume, audioStart, audioStatus, audioStop, onAudioLevel, onAudioState, onAudioTick } from "../../../platform/audio";
import { useSettings } from "../../../stores/settings";
import { modelForLang } from "../../../core/asrModels";
import { useModelManager } from "../../settings/modelManager";
import { useAnnotationStore, type SnapshotOp } from "./annotations";
import { useNoteEditor } from "./noteEditor";

export type RecStatus = "idle" | "recording" | "paused";
export type AsrUiState = "off" | "loading" | "on" | "lagging" | "error" | "no_model";

interface RecordingStore {
  sessionId: string | null;
  deckId: string | null;
  status: RecStatus;
  tMs: number;
  levelDb: number;
  asr: AsrUiState;
  partial: string;
  lastSnapshotMs: number | null;
  /** The device went away or failed; the recorder is paused until "继续" succeeds. */
  interrupted: boolean;
  interruptReason: string | null;
  starting: boolean;

  /** Binds the store to a session; refused (returns false) while another session is recording. */
  attach: (sessionId: string, deckId: string) => boolean;
  detach: () => void;
  start: (currentPage: number) => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  stop: () => Promise<number | null>;
  onPageChanged: (index: number) => void;
  addMarker: (kind: MarkerKind) => Promise<void>;
}

const PAGE_REST_MS = 300;
const ANNOTATION_DEBOUNCE_MS = 1500;
/** Final segments emitted while the engine flushes may arrive just after `asr_stop` resolves. */
const ASR_LISTENER_LINGER_MS = 800;

let unlisteners: UnlistenFn[] = [];
let asrUnlisteners: UnlistenFn[] = [];
/** Invalidates asynchronous model preparation when a recording ends. */
let asrGeneration = 0;
/** Only the native invoke is awaited on stop, not a slow model download/check. */
let asrNativeStart: Promise<void> | null = null;
let asrNeedsStop = false;
let stopping: Promise<number | null> | null = null;
let recordingGeneration = 0;
let pendingRecordingStart: Promise<void> | null = null;
class RecordingStartCancelled extends Error {}
let pageTimer: number | null = null;
let lastEmittedPage = -1;
const lastNoteSnapshot = new Map<number, string>();
/** Debounced "updated" snapshots: kept with their emit so stop() can flush them (audit F5). */
const annotationTimers = new Map<string, { timer: number; emit: () => void }>();
const lastAnnotationPayload = new Map<string, string>();

async function installListeners(set: (p: Partial<RecordingStore>) => void, get: () => RecordingStore) {
  await removeListeners();
  unlisteners = await Promise.all([
    onAudioTick((tMs) => set({ tMs })),
    onAudioLevel((levelDb) => set({ levelDb })),
    onAudioState((state, message) => {
      if (get().status === "idle") return;
      if (state === "interrupted") {
        set({ status: "paused", interrupted: true, interruptReason: message ?? null });
        toast(S.errors.micInterrupted, "error");
      } else if (state === "recording") {
        set({ status: "recording", interrupted: false, interruptReason: null });
      } else if (state === "error") {
        // The WAV writer died (disk full, I/O error): what was written is playable; end the class cleanly.
        toast(S.errors.recording(message ?? "unknown"), "error");
        void get().stop();
      }
    }),
  ]);
}

async function removeListeners() {
  for (const u of unlisteners) u();
  unlisteners = [];
}

function removeAsrListeners() {
  const list = asrUnlisteners;
  asrUnlisteners = [];
  for (const u of list) u();
}

/**
 * Attaches the on-device engine to the recorder (docs/SPEC.md 7.5). Never throws:
 * recording continues without transcription when the model is missing or fails.
 */
async function startAsr(set: (p: Partial<RecordingStore>) => void, get: () => RecordingStore) {
  const targetSessionId = get().sessionId;
  const generation = ++asrGeneration;
  const isCurrent = () => generation === asrGeneration && targetSessionId !== null
    && get().sessionId === targetSessionId && get().status !== "idle";
  const { asrEnabled, langMode } = useSettings.getState().settings;
  if (!asrEnabled) {
    set({ asr: "off", partial: "" });
    return;
  }
  let listeners: UnlistenFn[] = [];
  let acceptsFinals = true;
  try {
    const mm = useModelManager.getState();
    if (!mm.loaded) await mm.load().catch(() => undefined);
    if (!isCurrent()) return;
    // A model copy that is still being hash-checked (first start after an upgrade) is
    // not "ready" yet: wait for the verdict instead of silently recording without ASR.
    const wanted = modelForLang(langMode).id;
    for (let waited = 0; useModelManager.getState().verifying.has(wanted) && waited < 30_000; waited += 250) {
      await new Promise((r) => window.setTimeout(r, 250));
      if (!isCurrent()) return;
    }
    const dir = await useModelManager.getState().readyDirFor(langMode);
    if (!isCurrent()) return;
    if (!dir) {
      set({ asr: "no_model", partial: "" });
      return;
    }
    set({ asr: "loading", partial: "" });
    removeAsrListeners();
    const registrations = await Promise.allSettled([
      onAsrStatus((st) => {
        if (!isCurrent()) return;
        if (st.status === "ready") set({ asr: "on" });
        else if (st.status === "lagging") set({ asr: "lagging" });
        else if (st.status === "error") {
          set({ asr: "error", partial: "" });
          toast(S.errors.asrModel, "error");
        } else if (st.status === "stopped") set({ partial: "" });
      }),
      onAsrPartial((text) => {
        if (!isCurrent()) return;
        set({ partial: text });
        if (get().asr === "lagging" && text) set({ asr: "on" });
      }),
      onAsrFinal((seg) => {
        // Finals remain accepted during the stop/drain window, but only by the
        // old recording's listeners. New recording attachment is still blocked.
        if (!acceptsFinals || !targetSessionId || get().sessionId !== targetSessionId || !seg.text.trim()) return;
        void insertDeviceSegment(targetSessionId, seg.t0_ms, seg.t1_ms, seg.text.trim(), lastEmittedPage >= 0 ? lastEmittedPage : null);
      }),
    ]);
    listeners = registrations.flatMap((result) => result.status === "fulfilled" ? [() => {
      acceptsFinals = false;
      result.value();
    }] : []);
    if (!isCurrent() || registrations.some((result) => result.status === "rejected")) {
      for (const unlisten of listeners) unlisten();
      const failed = registrations.find((result) => result.status === "rejected");
      if (failed?.status === "rejected") throw failed.reason;
      return;
    }
    asrUnlisteners = listeners;
    asrNeedsStop = true;
    const pending = asrStart(dir);
    asrNativeStart = pending;
    try {
      await pending;
    } finally {
      if (asrNativeStart === pending) asrNativeStart = null;
    }
  } catch (e) {
    if (!isCurrent()) return;
    console.warn("[asr] start failed", e);
    set({ asr: "error", partial: "" });
    toast(S.errors.asrModel, "error");
    for (const unlisten of listeners) unlisten();
    if (asrUnlisteners === listeners) asrUnlisteners = [];
  }
}

async function stopAsr(set: (p: Partial<RecordingStore>) => void, get: () => RecordingStore) {
  ++asrGeneration;
  const targetSessionId = get().sessionId;
  // A queued native start must finish before stop takes the native engine slot.
  // Model preparation has already been invalidated and is allowed to return later.
  await asrNativeStart?.catch(() => undefined);
  if (asrNeedsStop) {
    await asrStop().catch((e) => console.warn("[asr] stop failed", e));
    asrNeedsStop = false;
  }
  // Tauri can deliver the flushed final event after the stop invoke resolves.
  // Keep the recording non-idle until these listeners have actually closed;
  // otherwise the next recording's untagged ASR events reach both sessions.
  if (asrUnlisteners.length) await new Promise((resolve) => window.setTimeout(resolve, ASR_LISTENER_LINGER_MS));
  removeAsrListeners();
  if (get().sessionId === targetSessionId) set({ asr: "off", partial: "" });
}

function clearSnapshotHooks() {
  useNoteEditor.setState({ onSavedForSnapshot: null });
  useAnnotationStore.setState({ onChangeForSnapshot: null });
}

/** Commit every debounced annotation snapshot now (end of class, audit F5). */
function flushAnnotationSnapshots() {
  const pending = [...annotationTimers.values()];
  for (const p of pending) window.clearTimeout(p.timer);
  annotationTimers.clear();
  for (const p of pending) p.emit();
}

export const useRecording = create<RecordingStore>((set, get) => ({
  sessionId: null,
  deckId: null,
  status: "idle",
  tMs: 0,
  levelDb: -60,
  asr: "off",
  partial: "",
  lastSnapshotMs: null,
  interrupted: false,
  interruptReason: null,
  starting: false,

  attach: (sessionId, deckId) => {
    const s = get();
    if (s.sessionId === sessionId) return true;
    // Never hand the recorder to another session while it is running (audit PM-01).
    if (s.status !== "idle" || s.starting) return false;
    set({ sessionId, deckId, status: "idle", tMs: 0, levelDb: -60, lastSnapshotMs: null, interrupted: false, interruptReason: null, asr: "off", partial: "" });
    return true;
  },

  detach: () => {
    if (get().status !== "idle" || get().starting) return;
    ++asrGeneration;
    void removeListeners();
    removeAsrListeners();
    clearSnapshotHooks();
    set({ sessionId: null, deckId: null, status: "idle", tMs: 0, asr: "off", partial: "" });
  },

  start: (currentPage) => {
    const { sessionId, status } = get();
    if (!sessionId || status !== "idle" || get().starting || stopping || pendingRecordingStart) return Promise.resolve();
    const generation = ++recordingGeneration;
    const ensureCurrent = () => {
      if (generation !== recordingGeneration) throw new RecordingStartCancelled();
    };
    set({ starting: true });
    pendingRecordingStart = (async () => {
      let nativeStarted = false;
      let wavPath: string | null = null;
      try {
        const session = await getSession(sessionId);
        ensureCurrent();
        if (!session || session.started_at || session.ended_at || session.local_wav_path) {
          throw new Error("这段录音已有内容，请使用“新增录音”，以保留原录音。");
        }
        wavPath = await sessionWavPath(sessionId);
        ensureCurrent();
        await audioStart(wavPath, false);
        nativeStarted = true;
        ensureCurrent();
        await installListeners(set, get);
        ensureCurrent();
        lastEmittedPage = currentPage;
        lastNoteSnapshot.clear();
        lastAnnotationPayload.clear();
        await updateSession(sessionId, { started_at: nowIso(), initial_page_index: currentPage, audio_status: "recording", local_wav_path: wavPath });
        ensureCurrent();
        await appendEvent(sessionId, "recording_state", 0, { state: "started" });
        ensureCurrent();
        set({ status: "recording", tMs: 0, interrupted: false, interruptReason: null });
        void startAsr(set, get);

        // Snapshot hooks (docs/SPEC.md 5.3 / 5.6).
        useNoteEditor.setState({
          onSavedForSnapshot: (page, markdown) => {
            const s = get();
            if (s.status === "idle" || !s.sessionId) return;
            if (lastNoteSnapshot.get(page) === markdown) return;
            lastNoteSnapshot.set(page, markdown);
            void appendEvent(s.sessionId, "note_snapshot", s.tMs, { page_index: page, markdown });
            set({ lastSnapshotMs: s.tMs });
          },
        });
        useAnnotationStore.setState({
          onChangeForSnapshot: (op: SnapshotOp, row: AnnotationRow) => {
            const s = get();
            if (s.status === "idle" || !s.sessionId) return;
            const emit = () => {
              annotationTimers.delete(row.id);
              const { dirty: _d, ...annotation } = row;
              const payload = { annotation_id: row.id, page_index: row.page_index, kind: row.kind, op, annotation: op === "deleted" ? null : annotation };
              const key = JSON.stringify(payload);
              if (lastAnnotationPayload.get(row.id) === key) return;
              lastAnnotationPayload.set(row.id, key);
              void appendEvent(s.sessionId as string, "annotation_snapshot", get().tMs, payload);
            };
            const pending = annotationTimers.get(row.id);
            if (pending) window.clearTimeout(pending.timer);
            if (op === "updated") annotationTimers.set(row.id, { timer: window.setTimeout(emit, ANNOTATION_DEBOUNCE_MS), emit });
            else {
              annotationTimers.delete(row.id);
              emit();
            }
          },
        });
      } catch (e) {
        // Roll back whatever already ran: the mic must never keep recording behind an idle UI (audit F4).
        if (nativeStarted) {
          const stopped = await audioStop().catch((err) => { console.warn("[audio] rollback stop failed", err); return null; });
          // A cancellation after the mic opened can already contain speech. Keep
          // that WAV associated with this session so retry cannot truncate it.
          if (wavPath) await updateSession(sessionId, {
            started_at: nowIso(), ended_at: nowIso(), initial_page_index: currentPage,
            local_wav_path: wavPath, duration_ms: stopped?.duration_ms ?? get().tMs, audio_status: "local",
          }).catch((err) => console.warn("[audio] preserving cancelled recording failed", err));
        }
        await removeListeners();
        clearSnapshotHooks();
        set({ status: "idle", tMs: 0 });
        if (!(e instanceof RecordingStartCancelled)) {
          const msg = String(e);
          toast(msg.includes("mic_permission_denied") || msg.includes("mic_not_found") ? S.errors.mic : S.errors.recordingStart(msg), "error");
        }
      } finally {
        set({ starting: false });
      }
    })().finally(() => { pendingRecordingStart = null; });
    return pendingRecordingStart;
  },

  pause: async () => {
    const { sessionId, status, tMs } = get();
    if (!sessionId || status !== "recording") return;
    await audioPause();
    await appendEvent(sessionId, "recording_state", tMs, { state: "paused" });
    set({ status: "paused" });
  },

  resume: async () => {
    const { sessionId, status, tMs, interrupted } = get();
    if (!sessionId || status !== "paused") return;
    await audioResume();
    if (interrupted) {
      // The stream thread answers with `recording` once the device is back, or
      // `interrupted` again; the state listener keeps the UI honest either way.
      return;
    }
    await appendEvent(sessionId, "recording_state", tMs, { state: "resumed" });
    set({ status: "recording", interrupted: false, interruptReason: null });
  },

  stop: () => {
    if (stopping) return stopping;
    ++recordingGeneration;
    ++asrGeneration;
    stopping = (async () => {
      // Cancelling a getSession/audioStart in flight must settle its rollback
      // before stop resolves; no delayed native start can appear after that.
      await pendingRecordingStart;
      const { sessionId, status } = get();
      if (!sessionId || status === "idle") {
        // The UI may be idle while the native recorder is not (a failed start, a crash
        // in the middle of start): never leave the mic running behind an idle screen.
        const native = await audioStatus().catch(() => null);
        if (native && native.state !== "idle") await audioStop().catch(() => undefined);
        return null;
      }
      // A failed note save must retain the draft, but must not prevent the user
      // from closing the microphone. Explicit navigation callers still reject.
      await useNoteEditor.getState().flush().catch(() => {
        toast("笔记保存失败，草稿已保留，可稍后重试。", "error");
      });
      flushAnnotationSnapshots();
      // Mic off and WAV closed first; the engine then drains its bounded queue (audit B04).
      let durationMs = get().tMs;
      try {
        durationMs = (await audioStop()).duration_ms;
      } catch (e) {
        console.warn("[audio] stop failed, using the last tick as duration", e);
      }
      await stopAsr(set, get);
      await appendEvent(sessionId, "recording_state", durationMs, { state: "stopped" });
      await updateSession(sessionId, { ended_at: nowIso(), duration_ms: durationMs, audio_status: "local" });
      await removeListeners();
      clearSnapshotHooks();
      set({ status: "idle", tMs: durationMs, interrupted: false, interruptReason: null });
      return durationMs;
    })().finally(() => { stopping = null; });
    return stopping;
  },

  onPageChanged: (index) => {
    if (pageTimer) window.clearTimeout(pageTimer);
    pageTimer = window.setTimeout(() => {
      pageTimer = null;
      const s = get();
      if (s.status === "idle" || !s.sessionId) return;
      if (index === lastEmittedPage) return;
      lastEmittedPage = index;
      void appendEvent(s.sessionId, "page_change", s.tMs, { page_index: index });
    }, PAGE_REST_MS);
  },

  addMarker: async (kind) => {
    const s = get();
    if (s.status === "idle" || !s.sessionId) return;
    await appendEvent(s.sessionId, "marker", s.tMs, { kind });
  },
}));
