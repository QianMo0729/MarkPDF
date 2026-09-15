import { execute, selectOne } from "../client";
import { notifyChanged } from "../live";
import { newId } from "../../../core/utils/ids";

export async function getState(key: string): Promise<string | null> {
  const row = await selectOne<{ value: string }>("SELECT value FROM sync_state WHERE key = ?", [key]);
  return row?.value ?? null;
}

export async function setState(key: string, value: string): Promise<void> {
  await execute(
    "INSERT INTO sync_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [key, value],
  );
  notifyChanged("sync_state");
}

export async function deleteState(key: string): Promise<void> {
  await execute("DELETE FROM sync_state WHERE key = ?", [key]);
  notifyChanged("sync_state");
}

/** First launch writes a stable device id; later launches return it. */
export async function ensureDeviceId(): Promise<string> {
  const existing = await getState("device_id");
  if (existing) return existing;
  const id = newId();
  await setState("device_id", id);
  return id;
}
