import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { drizzle, type RemoteCallback, type SqliteRemoteDatabase } from "drizzle-orm/sqlite-proxy";
import { migrate, type ProxyMigrator } from "drizzle-orm/sqlite-proxy/migrator";
import * as schema from "./schema.js";

export type KosmoraDatabase = SqliteRemoteDatabase<typeof schema>;

export interface DatabaseHealth {
  ping(): void;
}

export interface DatabaseHandle extends DatabaseHealth {
  db: KosmoraDatabase;
  sqlite: DatabaseSync;
  close(): void;
}

const migrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url));

const resolveDatabaseFile = (databaseUrl: string): string => {
  if (databaseUrl === ":memory:") {
    return databaseUrl;
  }

  const file = databaseUrl.startsWith("file:") ? databaseUrl.slice("file:".length) : databaseUrl;
  if (!file) {
    throw new Error("DATABASE_URL must point to a SQLite file");
  }

  const absoluteFile = resolve(file);
  mkdirSync(dirname(absoluteFile), { recursive: true });
  return absoluteFile;
};

export const openDatabase = (databaseUrl: string): DatabaseHandle => {
  const sqlite = new DatabaseSync(resolveDatabaseFile(databaseUrl));
  sqlite.exec("PRAGMA foreign_keys = ON;");
  sqlite.exec("PRAGMA busy_timeout = 5000;");

  const execute: RemoteCallback = (query, rawParameters, method) => {
    const statement = sqlite.prepare(query);
    const parameters = rawParameters as SQLInputValue[];

    if (method === "run") {
      statement.run(...parameters);
      return Promise.resolve({ rows: [] });
    }

    statement.setReturnArrays(true);
    if (method === "get") {
      const row = statement.get(...parameters) as unknown[] | undefined;
      return Promise.resolve({ rows: row ?? [] });
    }

    const rows = statement.all(...parameters) as unknown as unknown[][];
    return Promise.resolve({ rows });
  };

  const db = drizzle(execute, { schema });

  return {
    db,
    sqlite,
    ping: () => {
      sqlite.prepare("SELECT 1 AS ok").get();
    },
    close: () => sqlite.close()
  };
};

/** Detect the historical 76e44320 journal hole before Drizzle would skip migration 25. */
export const assertDocumentLibraryUpgradeReady = (sqlite: DatabaseSync): void => {
  const has = (name: string) =>
    Boolean(
      sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name)
    );
  const modern = has("project_memory"); // 0026 was in 76e44320; 0025 was not.
  const original = has("document_library_files"),
    chunks = has("document_library_chunks"),
    fts = has("document_library_fts");
  if (
    (modern && !original) ||
    ([original, chunks, fts].some(Boolean) && ![original, chunks, fts].every(Boolean))
  )
    throw Error(
      "SQLITE_LIBRARY_0025_UPGRADE_REQUIRED: stop API; back up; run scripts/retrofit-document-library.mjs offline"
    );
};
export const runMigrations = (
  database: Pick<DatabaseHandle, "db" | "sqlite">,
  folder = migrationsFolder
): Promise<void> => {
  const applyQueries: ProxyMigrator = (queries) => {
    database.sqlite.exec("BEGIN IMMEDIATE;");
    try {
      for (const query of queries) {
        database.sqlite.exec(query);
      }
      database.sqlite.exec("COMMIT;");
      return Promise.resolve();
    } catch (error) {
      database.sqlite.exec("ROLLBACK;");
      const migrationError =
        error instanceof Error ? error : new Error("SQLite migration failed", { cause: error });
      return Promise.reject(migrationError);
    }
  };

  // Some previous unshipped integration snapshots contained the old 0030 table without
  // a run_id retention key; that schema cannot prove deduplicated owner quota after deletion.
  const retained = database.sqlite
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='kosmora_retained_accounting'"
    )
    .get();
  if (
    retained &&
    !(
      database.sqlite.prepare("PRAGMA table_info(kosmora_retained_accounting)").all() as Array<{
        name: string;
      }>
    ).some((row) => row.name === "run_id")
  )
    throw Error(
      "SQLITE_RETAINED_USAGE_SCHEMA_UPGRADE_REQUIRED: offline schema recovery needed before startup"
    );
  assertDocumentLibraryUpgradeReady(database.sqlite);
  return migrate(database.db, applyQueries, { migrationsFolder: folder });
};

export { schema };
export * from "./agent-blueprint-store.js";
export * from "./agent-instance-store.js";
export * from "./agent-studio-mutation-store.js";
export * from "./emergency-stop-store.js";
export * from "./general-chat-store.js";
export * from "./identity-store.js";
export * from "./manager-demo-store.js";
export * from "./manager-work-store.js";
export * from "./pattern-library-store.js";
export * from "./policy-store.js";
export * from "./project-store.js";
export * from "./step-up-proof-store.js";
export * from "./usage-store.js";
export * from "./project-memory-store.js";
export * from "./work-runtime-store.js";
export * from "./work-dag-store.js";
export * from "./document-library-store.js";
export * from "./canvas-artifact-store.js";
export * from "./document-answer-store.js";
export * from "./chat-history-search-store.js";
