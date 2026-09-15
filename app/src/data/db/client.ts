import Database from "@tauri-apps/plugin-sql";

/** Must match DB_URL in src-tauri/src/lib.rs so migrations apply to this file. */
export const DB_URL = "sqlite:markpdf.db";

let db: Database | null = null;

export async function initDb(): Promise<Database> {
  if (!db) db = await Database.load(DB_URL);
  return db;
}

export function getDb(): Database {
  if (!db) throw new Error("database not initialized; call initDb() first");
  return db;
}

export async function select<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  return getDb().select<T[]>(sql, params);
}

export async function selectOne<T>(sql: string, params: unknown[] = []): Promise<T | null> {
  const rows = await select<T>(sql, params);
  return rows.length ? rows[0] : null;
}

export async function execute(sql: string, params: unknown[] = []): Promise<void> {
  await getDb().execute(sql, params);
}

/** Build "UPDATE table SET a = ?, b = ? WHERE id = ?" from a patch object. */
export async function updateById(
  table: string,
  id: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const keys = Object.keys(patch);
  if (!keys.length) return;
  const sets = keys.map((k) => `${k} = ?`).join(", ");
  await execute(`UPDATE ${table} SET ${sets} WHERE id = ?`, [...keys.map((k) => patch[k]), id]);
}

/** Build "INSERT INTO table (cols) VALUES (?)" with optional upsert on a conflict target. */
export async function insertRow(
  table: string,
  row: Record<string, unknown>,
  conflict?: { target: string[]; update: string[] },
): Promise<void> {
  const keys = Object.keys(row);
  const placeholders = keys.map(() => "?").join(", ");
  let sql = `INSERT INTO ${table} (${keys.join(", ")}) VALUES (${placeholders})`;
  if (conflict) {
    const sets = conflict.update.map((k) => `${k} = excluded.${k}`).join(", ");
    sql += ` ON CONFLICT(${conflict.target.join(", ")}) DO UPDATE SET ${sets}`;
  }
  await execute(sql, keys.map((k) => row[k]));
}
