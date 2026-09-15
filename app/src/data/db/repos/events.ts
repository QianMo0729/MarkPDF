import { insertRow, select } from "../client";
import { notifyChanged } from "../live";
import type { EventRow, EventType } from "../schema";
import { newId, nowIso } from "../../../core/utils/ids";
import { getState } from "./syncState";

let cachedDeviceId: string | null = null;

async function deviceId(): Promise<string> {
  if (!cachedDeviceId) cachedDeviceId = (await getState("device_id")) ?? "unknown";
  return cachedDeviceId;
}

/** Append-only. Returns the stored row. */
export async function appendEvent(
  sessionId: string,
  type: EventType,
  tMs: number,
  payload: unknown,
): Promise<EventRow> {
  const row: EventRow = {
    id: newId(),
    session_id: sessionId,
    type,
    t_ms: Math.max(0, Math.floor(tMs)),
    payload_json: JSON.stringify(payload),
    device_id: await deviceId(),
    created_at: nowIso(),
    server_seq: null,
    synced: 0,
  };
  await insertRow("events", row as unknown as Record<string, unknown>);
  notifyChanged("events");
  return row;
}

export async function listEvents(sessionId: string): Promise<EventRow[]> {
  return select<EventRow>("SELECT * FROM events WHERE session_id = ? ORDER BY t_ms, id", [sessionId]);
}

/** Rows appended since `createdAt` (inclusive; callers dedupe by id). */
export async function listEventsSince(sessionId: string, createdAt: string): Promise<EventRow[]> {
  return select<EventRow>("SELECT * FROM events WHERE session_id = ? AND created_at >= ? ORDER BY t_ms, id", [sessionId, createdAt]);
}
