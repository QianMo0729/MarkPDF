import { useState } from "react";
import { Dialog } from "../../core/ui/Dialog";
import { toast } from "../../core/ui/Toast";
import { useLiveQuery } from "../../data/db/live";
import { listCourses } from "../../data/db/repos/courses";
import { moveDeckToCourse } from "../../data/db/repos/decks";
import type { DeckRow } from "../../data/db/schema";

export function MoveDeckDialog({ deck, onClose }: { deck: DeckRow; onClose: () => void }) {
  const courses = useLiveQuery(() => listCourses(), ["courses"], []);
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const choices = (courses.data ?? []).filter((c) => c.id !== deck.course_id);
  const move = async () => {
    if (!target || busy) return;
    setBusy(true);
    setError(null);
    try {
      await moveDeckToCourse(deck.id, target);
      toast(`已移动到 ${choices.find((c) => c.id === target)?.name ?? "目标课程"}`);
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open title="移动课件到其他课程" onClose={onClose} locked={busy} actions={
      <>
        <button className="btn btn-outlined" disabled={busy} onClick={onClose}>取消</button>
        <button className="btn btn-filled" disabled={busy || !choices.some((c) => c.id === target)} onClick={() => void move()}>
          {busy ? "移动中…" : "移动课件"}
        </button>
      </>
    }>
      <p className="body text2">“{deck.title}”的笔记、标注、录音和转录会一起移动。</p>
      <label className="col" style={{ gap: 8 }}>
        目标课程
        <select className="input" value={target} onChange={(e) => setTarget(e.target.value)} disabled={busy}>
          <option value="">请选择课程</option>
          {choices.map((c) => <option key={c.id} value={c.id}>{c.name}{c.term ? ` · ${c.term}` : ""}</option>)}
        </select>
      </label>
      {!courses.loading && choices.length === 0 && <p className="body-small text2">请先在课程库创建另一门课程。</p>}
      {(error || courses.error) && <p role="alert">{error ?? String(courses.error)}</p>}
    </Dialog>
  );
}
