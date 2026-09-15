import { useEffect, useState } from "react";
import { createHashRouter, RouterProvider } from "react-router";
import { AdaptiveShell } from "./core/layout/AdaptiveShell";
import { installLayoutListener } from "./core/layout/breakpoints";
import { S } from "./core/strings";
import { ToastHost } from "./core/ui/Toast";
import { migrateAnnotationUnits } from "./data/db/annotationUnits";
import { initDb } from "./data/db/client";
import { ensureDeviceId } from "./data/db/repos/syncState";
import { ensureDirs } from "./data/files/file_store";
import { sweepAtStartup } from "./domain/deletion";
import { LoginScreen } from "./features/auth/LoginScreen";
import { CourseScreen } from "./features/course/CourseScreen";
import { OpenFileFlow } from "./features/deck_import/OpenFileFlow";
import { LibraryScreen } from "./features/library/LibraryScreen";
import { RecoveryDialog } from "./features/session/RecoveryDialog";
import { SessionScreen } from "./features/session/SessionScreen";
import { AsrModelsScreen } from "./features/settings/AsrModelsScreen";
import { SettingsScreen } from "./features/settings/SettingsScreen";
import { useModelManager } from "./features/settings/modelManager";
import { useSettings } from "./stores/settings";
import { installDevHooks } from "./devtools";

const router = createHashRouter([
  {
    path: "/",
    element: <AdaptiveShell />,
    children: [
      { index: true, element: <LibraryScreen /> },
      { path: "course/:courseId", element: <CourseScreen /> },
      { path: "settings", element: <SettingsScreen /> },
      { path: "settings/asr", element: <AsrModelsScreen /> },
      { path: "login", element: <LoginScreen /> },
    ],
  },
  { path: "/deck/:deckId", element: <SessionScreen kind="deck" /> },
  { path: "/session/:sessionId", element: <SessionScreen kind="session" /> },
]);

export function App() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dispose = installLayoutListener();
    (async () => {
      await initDb();
      await ensureDeviceId();
      await migrateAnnotationUnits();
      await ensureDirs();
      await useSettings.getState().load();
      void sweepAtStartup();
      // Reconcile model files with disk early so a class can start with transcription right away.
      void useModelManager.getState().load().catch(() => undefined);
      installDevHooks((to) => router.navigate(to));
      setReady(true);
    })().catch((e) => setError(String(e)));
    return dispose;
  }, []);

  if (error) {
    return (
      <div className="empty" style={{ height: "100%" }}>
        <span className="material-symbols-rounded">error</span>
        <div className="subtitle">MarkPDF 无法启动</div>
        <div className="body-small text2" style={{ userSelect: "text" }}>
          {error}
        </div>
      </div>
    );
  }
  if (!ready) {
    return (
      <div className="empty" style={{ height: "100%" }}>
        <div className="body text2">{S.common.loading}</div>
      </div>
    );
  }
  return (
    <>
      <RouterProvider router={router} />
      <RecoveryDialog />
      <OpenFileFlow navigate={(to) => void router.navigate(to)} />
      <ToastHost />
    </>
  );
}
