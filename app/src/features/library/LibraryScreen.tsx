import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useLayoutClass } from "../../core/layout/breakpoints";
import { S } from "../../core/strings";
import { ConfirmDialog } from "../../core/ui/Dialog";
import { useContextMenu } from "../../core/ui/ContextMenu";
import { Icon } from "../../core/ui/Icon";
import { useLiveQuery } from "../../data/db/live";
import {
  COURSE_COLORS,
  createCourse,
  listCourses,
  updateCourse,
  type CourseSummary,
} from "../../data/db/repos/courses";
import { deleteCourseWithFiles } from "../../domain/deletion";
import { listRecentDecks } from "../../data/db/repos/decks";
import { DeckThumbnail } from "../../pdf/DeckThumbnail";
import { fmtDateShort } from "../../core/utils/time";
import { CourseDialog, type CourseDialogValue } from "./CourseDialog";
import "./library.css";

export function LibraryScreen() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "recent" ? "recent" : "courses";
  const layout = useLayoutClass();

  return (
    <div className={`library ${layout}`}>
      <div className="library-tabs">
        <div className="segmented">
          <button className={tab === "courses" ? "selected" : ""} onClick={() => setParams({})}>
            {S.nav.courses}
          </button>
          <button className={tab === "recent" ? "selected" : ""} onClick={() => setParams({ tab: "recent" })}>
            {S.nav.recent}
          </button>
        </div>
      </div>
      {tab === "courses" ? <CoursesTab /> : <RecentTab />}
    </div>
  );
}

function CoursesTab() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const courses = useLiveQuery(() => listCourses(search), ["courses", "decks", "sessions"], [search]);
  const [dialog, setDialog] = useState<{ mode: "create" } | { mode: "rename"; course: CourseSummary } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<CourseSummary | null>(null);
  const menu = useContextMenu();

  const items = courses.data ?? [];
  const hasAny = useMemo(() => items.length > 0 || search.trim() !== "", [items, search]);

  const submit = async (value: CourseDialogValue) => {
    if (dialog?.mode === "rename") {
      await updateCourse(dialog.course.id, { name: value.name, term: value.term, color_index: value.colorIndex });
    } else {
      const c = await createCourse(value);
      navigate(`/course/${c.id}`);
    }
    setDialog(null);
  };

  const openMenu = (e: React.MouseEvent, course: CourseSummary) =>
    menu.open(e, [
      { label: S.library.rename, icon: "edit", onClick: () => setDialog({ mode: "rename", course }) },
      { label: S.library.delete, icon: "delete", danger: true, onClick: () => setPendingDelete(course) },
    ]);

  return (
    <>
      <div className="library-header">
        <h1 className="display">{S.library.title}</h1>
        <input
          className="input library-search"
          placeholder={S.library.searchPlaceholder}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label={S.library.searchPlaceholder}
        />
        <button className="btn btn-filled" onClick={() => setDialog({ mode: "create" })}>
          <Icon name="add" size={20} />
          {S.library.newCourse}
        </button>
      </div>

      {!courses.loading && !hasAny && (
        <div className="empty library-empty">
          <Icon name="menu_book" size={48} />
          <div className="subtitle" style={{ color: "var(--text)" }}>
            {S.library.emptyTitle}
          </div>
          <div className="body">{S.library.emptyBody}</div>
          <button className="btn btn-filled" onClick={() => setDialog({ mode: "create" })}>
            {S.library.newCourse}
          </button>
        </div>
      )}

      <div className="course-grid">
        {items.map((c) => (
          <button
            key={c.id}
            className="course-tile"
            onClick={() => navigate(`/course/${c.id}`)}
            onContextMenu={(e) => openMenu(e, c)}
            aria-label={c.name}
          >
            <span className="course-spine" style={{ background: COURSE_COLORS[c.color_index % COURSE_COLORS.length] }} />
            <span className="course-tile-body">
              <span className="subtitle course-name">{c.name}</span>
              {c.term && <span className="caption">{c.term}</span>}
              <span className="grow" />
              <span className="body-small text2">{S.library.sessionsCount(c.session_count)}</span>
              <span className="body-small text2">{S.library.decksCount(c.deck_count)}</span>
              {c.last_activity && <span className="caption">{fmtDateShort(c.last_activity)}</span>}
            </span>
          </button>
        ))}
      </div>

      {menu.element}
      <CourseDialog
        open={dialog !== null}
        initial={dialog?.mode === "rename" ? dialog.course : undefined}
        onSubmit={submit}
        onClose={() => setDialog(null)}
      />
      <ConfirmDialog
        open={pendingDelete !== null}
        title={`${S.library.delete}“${pendingDelete?.name ?? ""}”？`}
        body={S.library.deleteConfirm}
        confirmLabel={S.library.delete}
        danger
        onCancel={() => setPendingDelete(null)}
        onConfirm={async () => {
          if (pendingDelete) await deleteCourseWithFiles(pendingDelete.id);
          setPendingDelete(null);
        }}
      />
    </>
  );
}

function RecentTab() {
  const navigate = useNavigate();
  const recent = useLiveQuery(() => listRecentDecks(), ["sessions", "decks", "courses"]);
  const items = recent.data ?? [];
  return (
    <>
      <div className="library-header">
        <h1 className="display">{S.nav.recent}</h1>
      </div>
      {!recent.loading && items.length === 0 && (
        <div className="empty library-empty">
          <Icon name="history" size={48} />
          <div className="subtitle" style={{ color: "var(--text)" }}>
            {S.library.recentEmpty}
          </div>
          <div className="body">导入 PDF 后，可在课件内录音和回放。</div>
        </div>
      )}
      <div className="session-list">
        {items.map((d) => (
          <button key={d.id} className="session-row" onClick={() => navigate(`/deck/${d.id}`)}>
            <DeckThumbnail deckId={d.id} pageIndex={0} width={64} height={36} />
            <span className="col grow" style={{ gap: 2, textAlign: "left" }}>
              <span className="subtitle">{d.title}</span>
              <span className="caption">{d.course_name} · {d.page_count} 页 · {d.recording_count} 段录音</span>
            </span>
          </button>
        ))}
      </div>
    </>
  );
}
