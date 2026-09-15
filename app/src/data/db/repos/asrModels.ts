import { execute, insertRow, select, selectOne } from "../client";
import { notifyChanged } from "../live";
import type { AsrModelRow } from "../schema";

export async function listAsrModels(): Promise<AsrModelRow[]> {
  return select<AsrModelRow>("SELECT * FROM asr_models ORDER BY id");
}

export async function getAsrModel(id: string): Promise<AsrModelRow | null> {
  return selectOne<AsrModelRow>("SELECT * FROM asr_models WHERE id = ?", [id]);
}

export async function upsertAsrModel(row: AsrModelRow): Promise<void> {
  await insertRow("asr_models", row as unknown as Record<string, unknown>, {
    target: ["id"],
    update: ["name", "dir_path", "size_bytes", "sha256", "status", "progress"],
  });
  notifyChanged("asr_models");
}

export async function setAsrModelStatus(id: string, status: AsrModelRow["status"], progress: number): Promise<void> {
  await execute("UPDATE asr_models SET status = ?, progress = ? WHERE id = ?", [status, progress, id]);
  notifyChanged("asr_models");
}
