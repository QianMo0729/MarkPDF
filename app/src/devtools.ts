/**
 * Development-only hooks reachable from a DevTools console / CDP session.
 * Nothing here ships in production builds (guarded by import.meta.env.DEV).
 */
import { importDeckFromPath } from "./features/deck_import/deckImport";
import { createCourse, listCourses } from "./data/db/repos/courses";
import { getDeck, getDeckPages, listDecks } from "./data/db/repos/decks";
import { listAnnotations } from "./data/db/repos/annotations";
import { select, execute } from "./data/db/client";
import { exportAnnotatedPdf } from "./domain/export_pdf";
import { asrBench } from "./platform/asr";
import { audioInjectWav } from "./platform/audio";
import { useModelManager } from "./features/settings/modelManager";
import { useAnnotationStore } from "./features/session/controllers/annotations";
import { useNoteEditor } from "./features/session/controllers/noteEditor";
import { usePlayback } from "./features/session/controllers/playback";
import { useRecording } from "./features/session/controllers/recording";
import { createSession } from "./features/session/sessionFlows";
import { useSessionUi } from "./features/session/sessionStore";
import { writeBytes } from "./platform/saveFile";
import { useSettings } from "./stores/settings";

export function installDevHooks(navigate: (to: string) => void): void {
  if (!import.meta.env.DEV) return;
  (window as unknown as { __markpdf: unknown }).__markpdf = {
    navigate,
    importDeckFromPath: (courseId: string, path: string) => importDeckFromPath(courseId, path, (m) => console.log("[import]", m)),
    createCourse,
    listCourses,
    listDecks,
    select,
    execute,
    sessionUi: useSessionUi,
    noteEditor: useNoteEditor,
    annotations: useAnnotationStore,
    recording: useRecording,
    playback: usePlayback,
    createSession,
    settings: useSettings,
    asrBench,
    injectWav: audioInjectWav,
    models: useModelManager,
    exportAnnotated: async (deckId: string, outPath: string) => {
      const deck = await getDeck(deckId);
      if (!deck) throw new Error("no deck");
      const result = await exportAnnotatedPdf(deck, await getDeckPages(deckId), await listAnnotations(deckId));
      await writeBytes(outPath, result.bytes);
      return { written: result.written, failed: result.failed, bytes: result.bytes.length };
    },
  };
}
