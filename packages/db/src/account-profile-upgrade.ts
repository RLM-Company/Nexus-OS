import type { DatabaseSync } from "node:sqlite";

const profileColumns = [
  ["display_name", "TEXT NOT NULL DEFAULT ''"],
  [
    "user_gender",
    "TEXT NOT NULL DEFAULT 'masculine' CHECK (user_gender IN ('masculine','feminine','neutral'))"
  ],
  [
    "assistant_gender",
    "TEXT NOT NULL DEFAULT 'neutral' CHECK (assistant_gender IN ('masculine','feminine','neutral'))"
  ]
] as const;

/** Called after Drizzle migrations. Legacy 0027 did not create the profile
 * columns. Use the same atomic upgrade in startup and offline rehearsal. */
export function upgradeAccountProfileColumns(sqlite: DatabaseSync): string[] {
  return addMissingAccountColumns(sqlite, profileColumns);
}

export function upgradeAccountTaskDecomposition(sqlite: DatabaseSync): void {
  addMissingAccountColumns(sqlite, [
    ["task_decomposition", "INTEGER NOT NULL DEFAULT 0 CHECK (task_decomposition IN (0,1))"]
  ]);
}

function addMissingAccountColumns(
  sqlite: DatabaseSync,
  columns: readonly (readonly [name: string, definition: string])[]
): string[] {
  sqlite.exec("BEGIN IMMEDIATE");
  try {
    const existing = new Set(
      sqlite
        .prepare("PRAGMA table_info(kosmora_account_preferences)")
        .all()
        .map(({ name }) => name)
    );
    const added: string[] = [];
    for (const [name, definition] of columns) {
      if (existing.has(name)) continue;
      sqlite.exec("ALTER TABLE kosmora_account_preferences ADD COLUMN " + name + " " + definition);
      added.push(name);
    }
    sqlite.exec("COMMIT");
    return added;
  } catch (error) {
    sqlite.exec("ROLLBACK");
    throw error;
  }
}
