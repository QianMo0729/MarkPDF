import { useEffect, useState } from "react";
import { S } from "../../core/strings";
import { Dialog } from "../../core/ui/Dialog";
import { toast } from "../../core/ui/Toast";
import { fmtDuration } from "../../core/utils/time";
import { discardUnfinishedSession, findUnfinishedSessions, finishUnfinishedSession, type UnfinishedSession } from "./sessionFlows";

/** Crash recovery prompt shown at startup (docs/SPEC.md 6.5.18). */
export function RecoveryDialog() {
  const [queue, setQueue] = useState<UnfinishedSession[]>([]);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  useEffect(() => {
    findUnfinishedSessions()
      .then(setQueue)
      .catch(() => undefined);
  }, []);

  const current = queue[0];
  if (!current) return null;
  const next = () => setQueue((q) => q.slice(1));

  return (
    <>
      <Dialog
        open
        title="上次录音没有正常结束"
        onClose={() => undefined}
        locked
        actions={
          <>
            <button className="btn btn-outlined" onClick={() => setConfirmDiscard(true)}>
              丢弃
            </button>
            <button
              className="btn btn-filled"
              onClick={async () => {
                try {
                  await finishUnfinishedSession(current);
                } catch (e) {
                  toast(S.errors.generic(String(e)), "error");
                  return;
                }
                next();
              }}
            >
              保存并结束
            </button>
          </>
        }
      >
        <div className="body text2">
          {current.session.title}，已录 {fmtDuration(current.durationMs)}。
        </div>
      </Dialog>
      <Dialog
        open={confirmDiscard}
        title="确定丢弃这段录音？"
        onClose={() => setConfirmDiscard(false)}
        actions={
          <>
            <button className="btn btn-outlined" onClick={() => setConfirmDiscard(false)}>
              取消
            </button>
            <button
              className="btn btn-filled btn-record"
              onClick={async () => {
                await discardUnfinishedSession(current);
                setConfirmDiscard(false);
                next();
              }}
            >
              丢弃
            </button>
          </>
        }
      >
        <div className="body text2">录音文件和这节课的记录都会被删除。</div>
      </Dialog>
    </>
  );
}
