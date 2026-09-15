import { v7 as uuidv7 } from "uuid";

/** All ids are UUIDv7 (time ordered). */
export const newId = (): string => uuidv7();

/** ISO 8601 UTC, the only timestamp format stored. */
export const nowIso = (): string => new Date().toISOString();
