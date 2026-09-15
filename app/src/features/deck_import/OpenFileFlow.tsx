import { useEffect, useRef, useState } from "react";
import { S } from "../../core/strings";
import { Dialog } from "../../core/ui/Dialog";
import { Icon } from "../../core/ui/Icon";
import { toast } from "../../core/ui/Toast";
import { useLiveQuery } from "../../data/db/live";
import { COURSE_COLORS, createCourse, listCourses } from "../../data/db/repos/courses";
import { findDeckAnywhereBySha } from "../../data/db/repos/decks";
import { fileSha256 } from "../../platform/files";
import { onOpenFiles, takeLaunchFiles } from "../../platform/launch";
import { CourseDialog, type CourseDialogValue } from "../library/CourseDialog";
import { useRecording } from "../session/controllers/recording";
import { importDeckFromPath } from "./deckImport";
import "../course/course.css";

interface Props {
  navigate: (to: string) => void;
}

type Phase =
  | { kind: "idle" }
  | { kind: "busy"; message: string }
  | { kind: "choose" }
  | { kind: "error"; message: string };

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/**
 * "Open with MarkPDF" flow (Explorer double-click / file association / a second
 * instance). A PDF that was imported before opens directly; a new one asks
 * which course to file it under, then runs the normal import.
 */
export function OpenFileFlow({ navigate }: Props) {
  const [queue, setQueue] = useState<string[]>([]);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [newCourse, setNewCourse] = useState(false);
  const startedFor = useRef<string | null>(null);
  const current = queue[0] ?? null;

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    const enqueue = (paths: string[]) => {
      if (paths.length === 0) return;
      setQueue((q) => [...q, ...paths.filter((p) => !q.includes(p))]);
    };
    onOpenFiles(enqueue)
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .then(takeLaunchFiles)
      .then(enqueue)
      .catch((e) => console.warn("[open-file]", e));
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const finish = () => {
    startedFor.current = null;
    setNewCourse(false);
    setPhase({ kind: "idle" });
    setQueue((q) => q.slice(1));
  };

  useEffect(() => {
    if (!current || startedFor.current === current) return;
    startedFor.current = current;
    void (async () => {
      if (useRecording.getState().status !== "idle") {
        toast(S.openFile.busyRecording);
        finish();
        return;
      }
      if (/[\\/]com\.markpdf\.[^\\/]+[\\/]print[\\/]/i.test(current)) {
        // Our own print copy handed back by a PDF viewer round-trip: nothing to import.
        finish();
        return;
      }
      setPhase({ kind: "busy", message: S.openFile.checking });
      try {
        const sha = await fileSha256(current);
        const existing = await findDeckAnywhereBySha(sha);
        if (existing) {
          navigate(`/deck/${existing.id}`);
          finish();
          return;
        }
        setPhase({ kind: "choose" });
      } catch (e) {
        setPhase({ kind: "error", message: String(e) });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  const importInto = async (courseId: string) => {
    if (!current) return;
    setNewCourse(false);
    setPhase({ kind: "busy", message: S.importFlow.copying });
    try {
      const result = await importDeckFromPath(courseId, current, (m) => setPhase({ kind: "busy", message: m }));
      if (result.duplicate) toast(S.importFlow.duplicate);
      navigate(`/deck/${result.deck.id}`);
      finish();
    } catch (e) {
      setPhase({ kind: "error", message: String(e) });
    }
  };

  const createAndImport = async (value: CourseDialogValue) => {
    const course = await createCourse(value);
    await importInto(course.id);
  };

  const name = current ? fileName(current) : "";
  return (
    <>
      <CourseChooserDialog
        open={phase.kind === "choose" && !newCourse}
        fileName={name}
        onChoose={(id) => void importInto(id)}
        onNew={() => setNewCourse(true)}
        onClose={finish}
      />
      <CourseDialog open={phase.kind === "choose" && newCourse} onSubmit={createAndImport} onClose={() => setNewCourse(false)} />

      <Dialog open={phase.kind === "busy"} title={S.openFile.opening(name)} onClose={() => undefined} locked>
        <div className="row" style={{ gap: 12 }}>
          <span className="spinner" aria-hidden="true" />
          <span className="body">{phase.kind === "busy" ? phase.message : ""}</span>
        </div>
      </Dialog>

      <Dialog
        open={phase.kind === "error"}
        title={S.course.statusError}
        onClose={finish}
        actions={
          <button className="btn btn-filled" onClick={finish} autoFocus>
            {S.common.confirm}
          </button>
        }
      >
        <div className="body text2" style={{ userSelect: "text" }}>
          {phase.kind === "error" ? S.openFile.failed(name, phase.message) : ""}
        </div>
      </Dialog>
    </>
  );
}

interface ChooserProps {
  open: boolean;
  fileName: string;
  onChoose: (courseId: string) => void;
  onNew: () => void;
  onClose: () => void;
}

function CourseChooserDialog({ open, fileName, onChoose, onNew, onClose }: ChooserProps) {
  const courses = useLiveQuery(() => listCourses(), ["courses"], [open]);
  const items = courses.data ?? [];
  return (
    <Dialog open={open} title={S.openFile.chooseCourse} onClose={onClose} width={440}>
      <div className="body-small text2">{items.length === 0 ? S.openFile.noCourses : S.openFile.chooseCourseBody(fileName)}</div>
      <div className="col" style={{ gap: 4, maxHeight: 360, overflowY: "auto" }}>
        {items.map((c) => (
          <button key={c.id} className="deck-choice" onClick={() => onChoose(c.id)}>
            <span className="row" style={{ width: 64, justifyContent: "center" }}>
              <span
                aria-hidden="true"
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: 7,
                  background: COURSE_COLORS[c.color_index % COURSE_COLORS.length],
                }}
              />
            </span>
            <span className="col grow" style={{ textAlign: "left", minWidth: 0 }}>
              <span className="body" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {c.name}
              </span>
              <span className="caption">{[c.term, S.library.decksCount(c.deck_count)].filter(Boolean).join(" · ")}</span>
            </span>
          </button>
        ))}
        <button className="deck-choice" onClick={onNew}>
          <span className="row" style={{ width: 64, justifyContent: "center" }}>
            <Icon name="add" size={22} className="text2" />
          </span>
          <span className="body text2">{S.openFile.newCourse}</span>
        </button>
      </div>
    </Dialog>
  );
}
