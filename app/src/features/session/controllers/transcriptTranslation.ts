import { saveSegmentTranslation } from "../../../data/db/repos/transcripts";
import type { TranscriptSegmentRow } from "../../../data/db/schema";
import type { TranslationMode } from "../../../stores/settings";
import { runTextAction } from "./translate";

export interface TranscriptTranslationState {
  activeId: string | null;
  pendingCount: number;
  progress: string;
  error: { segmentId: string; message: string } | null;
}

export const IDLE_TRANSCRIPT_TRANSLATION: TranscriptTranslationState = { activeId: null, pendingCount: 0, progress: "", error: null };

type Job = { id: string; text: string };
interface QueueOptions {
  sessionId: string;
  target: "zh" | "en";
  mode: TranslationMode;
  onState: (state: TranscriptTranslationState) => void;
  translate?: typeof runTextAction;
  save?: typeof saveSegmentTranslation;
}

/** A single recording's finalized sentences. The recorder never waits for this queue. */
export class TranscriptTranslationQueue {
  private disposed = false;
  private initialized = false;
  private running = false;
  private rows: TranscriptSegmentRow[] = [];
  private attempted = new Map<string, string>();
  private pending: Job[] = [];
  private controller: AbortController | null = null;
  private state: TranscriptTranslationState = { ...IDLE_TRANSCRIPT_TRANSLATION };

  constructor(private options: QueueOptions) {}

  observe(rows: TranscriptSegmentRow[]): void {
    if (this.disposed) return;
    this.rows = rows.filter((row) => row.session_id === this.options.sessionId).slice().sort((a, b) => a.t0_ms - b.t0_ms || a.t1_ms - b.t1_ms);
    let candidates = this.rows;
    if (!this.initialized) {
      this.initialized = true;
      // Enabling translation must not silently backfill hours of old speech.
      // Start at the latest complete sentence, then handle every newly finalized row.
      for (const row of this.rows.slice(0, -1)) this.attempted.set(row.id, row.text);
      candidates = this.rows.slice(-1);
    }
    for (const row of candidates) {
      if (!row.text.trim() || row.translation?.trim() || this.attempted.get(row.id) === row.text) continue;
      this.attempted.set(row.id, row.text);
      this.pending.push({ id: row.id, text: row.text });
    }
    this.publish({ pendingCount: this.pending.length });
    void this.drain();
  }

  retry(): void {
    if (this.disposed || !this.state.error) return;
    this.publish({ error: null, progress: "" });
    void this.drain();
  }

  dispose(): void {
    this.disposed = true;
    this.controller?.abort();
    this.pending = [];
  }

  private publish(patch: Partial<TranscriptTranslationState>): void {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    this.options.onState(this.state);
  }

  private matchingRow(job: Job): TranscriptSegmentRow | undefined {
    return this.rows.find((row) => row.id === job.id && row.text === job.text && !row.translation?.trim());
  }

  private async drain(): Promise<void> {
    if (this.disposed || this.running || this.state.error) return;
    this.running = true;
    try {
      while (!this.disposed && !this.state.error && this.pending.length) {
        const job = this.pending.shift()!;
        const row = this.matchingRow(job);
        if (!row) continue;
        const ctrl = new AbortController();
        this.controller = ctrl;
        this.publish({ activeId: row.id, pendingCount: this.pending.length, progress: "" });
        try {
          const index = this.rows.findIndex((item) => item.id === row.id);
          const context = this.options.mode === "ai" ? this.rows.slice(Math.max(0, index - 3), index).map((item) => item.text).join("\n").slice(-600) : undefined;
          const reply = await (this.options.translate ?? runTextAction)("translate", row.text, this.options.target, this.options.mode, {
            signal: ctrl.signal, pageText: context, contextKind: "transcript",
            onProgress: (progress) => { if (!ctrl.signal.aborted) this.publish({ progress }); },
          });
          if (this.disposed || ctrl.signal.aborted || !this.matchingRow(job)) continue;
          await (this.options.save ?? saveSegmentTranslation)(row, reply, ctrl.signal);
        } catch (error) {
          if (this.disposed || ctrl.signal.aborted) return;
          // A correction may have superseded this sentence while the old request
          // was running. Its failure must not pause the replacement translation.
          if (!this.matchingRow(job)) continue;
          this.pending.unshift(job);
          this.publish({ error: { segmentId: row.id, message: error instanceof Error ? error.message : String(error) } });
        } finally {
          if (this.controller === ctrl) this.controller = null;
          this.publish({ activeId: null, pendingCount: this.pending.length, progress: "" });
        }
      }
    } finally {
      this.running = false;
    }
  }
}
