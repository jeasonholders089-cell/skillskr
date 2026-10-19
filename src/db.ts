import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.ts";

const here = dirname(fileURLToPath(import.meta.url));

export type Row = Record<string, unknown>;

let database: DatabaseSync | null = null;

export function db(): DatabaseSync {
  if (!database) {
    throw new Error("Database not initialised. Call openDatabase() first.");
  }
  return database;
}

export function openDatabase(path = config.databasePath): DatabaseSync {
  if (database) return database;

  if (path !== ":memory:") {
    mkdirSync(dirname(resolve(path)), { recursive: true });
  }
  const handle = new DatabaseSync(path);
  handle.exec("PRAGMA foreign_keys = ON;");
  database = handle;
  migrate(handle);
  return handle;
}

export function closeDatabase(): void {
  if (database) {
    database.close();
    database = null;
  }
}

/** Apply the schema. Every statement is `IF NOT EXISTS`, so this is idempotent. */
export function migrate(handle: DatabaseSync = db()): void {
  const sql = readFileSync(resolve(here, "schema.sql"), "utf-8");
  handle.exec(sql);
  applyAlterations(handle);
}

/**
 * `CREATE TABLE IF NOT EXISTS` never changes an existing table, so columns added
 * after the first release are patched in here. Each entry is checked against
 * `PRAGMA table_info` before running, which keeps this safe to re-run.
 */
function applyAlterations(handle: DatabaseSync): void {
  ensureColumn(handle, "webhook_events", "tenant_id", "TEXT");
  ensureColumn(handle, "skills", "video_url", "TEXT");
  ensureColumn(handle, "skills", "gallery_json", "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(handle, "skills", "roles_json", "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(handle, "skills", "use_cases_json", "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(handle, "skills", "agents_json", "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn(handle, "skills", "is_featured", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(handle, "skills", "version", "TEXT");
}

function ensureColumn(handle: DatabaseSync, table: string, column: string, type: string): void {
  const columns = handle.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (columns.some((entry) => entry.name === column)) return;
  handle.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  console.log(`[db] added column ${table}.${column}`);
}

/* ------------------------------------------------------------------ helpers */

export function all<T = Row>(sql: string, ...params: unknown[]): T[] {
  return db().prepare(sql).all(...(params as never[])) as T[];
}

export function get<T = Row>(sql: string, ...params: unknown[]): T | undefined {
  const row = db().prepare(sql).get(...(params as never[]));
  return row as T | undefined;
}

export function run(sql: string, ...params: unknown[]): { changes: number; lastInsertRowid: number } {
  return db().prepare(sql).run(...(params as never[])) as {
    changes: number;
    lastInsertRowid: number;
  };
}

/** Run `fn` inside a transaction, rolling back on any throw. */
export function transaction<T>(fn: () => T): T {
  const handle = db();
  handle.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    handle.exec("COMMIT");
    return result;
  } catch (err) {
    try {
      handle.exec("ROLLBACK");
    } catch {
      // the transaction was already rolled back by SQLite
    }
    throw err;
  }
}
