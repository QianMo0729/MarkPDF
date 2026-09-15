import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import { S } from "../../core/strings";
import { useContextMenu } from "../../core/ui/ContextMenu";
import { ConfirmDialog, Dialog } from "../../core/ui/Dialog";
import { Icon } from "../../core/ui/Icon";
import { PromptDialog } from "../../core/ui/PromptDialog";
import { toast } from "../../core/ui/Toast";
import { useLiveQuery } from "../../data/db/live";
import { getCourse } from "../../data/db/repos/courses";
import { listDecks, updateDeck } from "../../data/db/repos/decks";
import { deleteDeckWithFiles } from "../../domain/deletion";
import { listSessions } from "../../data/db/repos/sessions";
import type { DeckRow } from "../../data/db/schema";
import { DeckThumbnail } from "../../pdf/DeckThumbnail";
import { hasLocalPdf, importDeckFromPath, pickAndImportDeck, pickPdf, PptxUnsupportedError, reindexDeck } from "../deck_import/deckImport";
import { MoveDeckDialog } from "./MoveDeckDialog";
import { DeckChooserDialog } from "./DeckChooserDialog";
import "../library/library.css";
import "./course.css";

export function CourseScreen() {
  const { courseId = "" } = useParams();
  const navigate = useNavigate();
  const course = useLiveQuery(() => getCourse(courseId), ["courses"], [courseId]);
  const decks = useLiveQuery(() => listDecks(courseId), ["decks"], [courseId]);
  const sessions = useLiveQuery(() => listSessions(courseId), ["sessions", "decks"], [courseId]);

  const [progress, setProgress] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [pptxDialog, setPptxDialog] = useState(false);
  const [renaming, setRenaming] = useState<DeckRow | null>(null);
  const [deleting, setDeleting] = useState<DeckRow | null>(null);
  const [moving, setMoving] = useState<DeckRow | null>(null);
  const [chooser, setChooser] = useState(false);
  const menu = useContextMenu();

  const startClass = () => {
    const ready = (decks.data ?? []).filter((d) => d.status === "ready");
    if (ready.length === 0) void runImport();
    else setChooser(true);
  };
  const beginSession = async (deck: DeckRow) => {
    setChooser(false);
    navigate(`/deck/${deck.id}`);
  };

  const runImport = async () => {
    setImportError(null);
    try {
      const result = await pickAndImportDeck(courseId, setProgress);
      setProgress(null);
      if (!result) return;
      if (result.duplicate) toast(S.importFlow.duplicate);
      navigate(`/deck/${result.deck.id}`);
    } catch (e) {
      setProgress(null);
      if (e instanceof PptxUnsupportedError) setPptxDialog(true);
      else setImportError(String(e));
    }
  };

  const retry = async (deck: DeckRow) => {
    try {
      let target = deck.id;
      if (await hasLocalPdf(deck)) await reindexDeck(deck, setProgress);
      else {
        // The copy never landed (disk full, interrupted): ask for the source file again (audit PM-06).
        const path = await pickPdf();
        if (!path) return;
        target = (await importDeckFromPath(courseId, path, setProgress)).deck.id;
      }
      setProgress(null);
      navigate(`/deck/${target}`);
    } catch (e) {
      setProgress(null);
      setImportError(String(e));
    }
  };

  const openDeckMenu = (e: React.MouseEvent, deck: DeckRow) =>
    menu.open(e, [
      { label: S.library.rename, icon: "edit", onClick: () => setRenaming(deck) },
      { label: "移动到其他课程", icon: "drive_file_move", disabled: ["importing", "uploading", "converting"].includes(deck.status), onClick: () => setMoving(deck) },
      { label: S.library.delete, icon: "delete", danger: true, onClick: () => setDeleting(deck) },
    ]);

  if (course.loading) return null;
  if (!course.data) {
    return (
      <div className="empty" style={{ height: "100%" }}>
        <div className="body text2">课程不存在</div>
      </div>
    );
  }
  const c = course.data;

  return (
    <div className="course">
      <div className="course-header">
        <button className="icon-btn" aria-label={S.session.back} onClick={() => navigate("/")}>
          <Icon name="arrow_back" size={24} />
        </button>
        <div className="col grow">
          <h1 className="display" style={{ margin: 0 }}>
            {c.name}
          </h1>
          {c.term && <span className="caption">{c.term}</span>}
        </div>
        <button className="btn btn-filled" onClick={startClass}>
          <Icon name="mic" size={20} />
          打开课件
        </button>
        <button className="btn btn-outlined" onClick={runImport}>
          <Icon name="upload_file" size={20} />
          {S.course.importDeck}
        </button>
      </div>

      <h2 className="subtitle course-section-title">{S.course.decks}</h2>
      {(decks.data?.length ?? 0) === 0 ? (
        <div className="body-small text2 course-section-empty">{S.course.decksEmpty}</div>
      ) : (
        <div className="deck-row">
          {decks.data!.map((d) => (
            <button
              key={d.id}
              className="deck-card"
              onClick={() => (d.status === "ready" ? navigate(`/deck/${d.id}`) : undefined)}
              onContextMenu={(e) => openDeckMenu(e, d)}
              aria-label={d.title}
            >
              <span className="deck-card-thumb">
                {d.status === "ready" ? <DeckThumbnail deckId={d.id} pageIndex={0} width={198} height={111} radius={0} /> : <Icon name="picture_as_pdf" size={32} className="text3" />}
              </span>
              <span className="subtitle deck-card-title">{d.title}</span>
              {d.status === "ready" ? (
                <span className="caption">{S.course.pages(d.page_count)} · {(sessions.data ?? []).filter((s) => s.deck_id === d.id && s.started_at).length} 段录音</span>
              ) : (
                <span className="row deck-card-status" style={{ gap: 6 }}>
                  <span className="chip">{statusLabel(d)}</span>
                  {d.status === "error" && (
                    <span
                      className="btn btn-text toolbar-small"
                      role="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        retry(d);
                      }}
                    >
                      {S.course.retry}
                    </span>
                  )}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      <p className="body-small text2">录音保存在对应课件内。打开 PDF 可查看录音、转录，或开始新的录音。</p>

      {moving && <MoveDeckDialog key={moving.id} deck={moving} onClose={() => setMoving(null)} />}

      {menu.element}

      <DeckChooserDialog
        open={chooser}
        decks={decks.data ?? []}
        onChoose={(d) => void beginSession(d)}
        onImport={() => {
          setChooser(false);
          void runImport();
        }}
        onClose={() => setChooser(false)}
      />

      <Dialog open={progress !== null} title={S.course.importDeck} onClose={() => undefined} locked>
        <div className="row" style={{ gap: 12 }}>
          <span className="spinner" aria-hidden="true" />
          <span className="body">{progress}</span>
        </div>
      </Dialog>

      <Dialog
        open={importError !== null}
        title={S.course.statusError}
        onClose={() => setImportError(null)}
        actions={
          <>
            <button className="btn btn-outlined" onClick={() => setImportError(null)}>
              {S.importFlow.cancel}
            </button>
            <button
              className="btn btn-filled"
              onClick={() => {
                setImportError(null);
                runImport();
              }}
            >
              {S.course.retry}
            </button>
          </>
        }
      >
        <div className="body text2" style={{ userSelect: "text" }}>
          {importError && S.importFlow.failed(importError)}
        </div>
      </Dialog>

      <Dialog
        open={pptxDialog}
        title="PPTX"
        onClose={() => setPptxDialog(false)}
        actions={
          <button className="btn btn-filled" onClick={() => setPptxDialog(false)}>
            {S.common.ok}
          </button>
        }
      >
        <div className="body text2">{S.importFlow.pdfOnly}</div>
      </Dialog>

      <PromptDialog
        open={renaming !== null}
        title={S.library.rename}
        initial={renaming?.title}
        onClose={() => setRenaming(null)}
        onSubmit={async (title) => {
          if (renaming) await updateDeck(renaming.id, { title });
          setRenaming(null);
        }}
      />
      <ConfirmDialog
        open={deleting !== null}
        title={`${S.library.delete}“${deleting?.title ?? ""}”？`}
        body="删除课件会同时删除它的笔记、标注和课堂记录。"
        confirmLabel={S.library.delete}
        danger
        onCancel={() => setDeleting(null)}
        onConfirm={async () => {
          if (deleting) await deleteDeckWithFiles(deleting.id);
          setDeleting(null);
        }}
      />
    </div>
  );
}

function statusLabel(d: DeckRow): string {
  switch (d.status) {
    case "importing":
      return S.course.statusImporting;
    case "uploading":
      return S.course.statusUploading;
    case "converting":
      return S.course.statusConverting(0);
    case "error":
      return S.course.statusError;
    default:
      return "";
  }
}
