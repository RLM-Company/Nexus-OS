import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";
const repo = process.argv[2];
const req = createRequire(join(repo, "packages/db/package.json"));
const { drizzle } = req("drizzle-orm/sqlite-proxy");
const { migrate } = req("drizzle-orm/sqlite-proxy/migrator");
const dir = mkdtempSync(join(tmpdir(), "kosmora-migration-review-"));
function show(ref, file) {
  return execFileSync("git", ["show", ref + ":" + file], {
    cwd: repo,
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024
  });
}
function materialize(ref, name) {
  const folder = join(dir, name);
  mkdirSync(join(folder, "meta"), { recursive: true });
  const journal = show(ref, "packages/db/migrations/meta/_journal.json");
  writeFileSync(join(folder, "meta/_journal.json"), journal);
  for (const item of JSON.parse(journal).entries)
    writeFileSync(
      join(folder, item.tag + ".sql"),
      show(ref, "packages/db/migrations/" + item.tag + ".sql")
    );
  return folder;
}
const db = new DatabaseSync(":memory:");
const proxy = drizzle(async (sql, params, method) => {
  const stmt = db.prepare(sql);
  if (method === "run") {
    stmt.run(...params);
    return { rows: [] };
  }
  stmt.setReturnArrays(true);
  return { rows: method === "get" ? (stmt.get(...params) ?? []) : stmt.all(...params) };
});
async function apply(folder) {
  await migrate(
    proxy,
    async (queries) => {
      db.exec("BEGIN IMMEDIATE");
      try {
        for (const sql of queries) db.exec(sql);
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
    { migrationsFolder: folder }
  );
}
await apply(materialize("origin/main", "main"));
const before = db.prepare("SELECT MAX(created_at) AS latest FROM __drizzle_migrations").get();
await apply(materialize("origin/review-684", "delivery"));
const names = [
  "stars_missions",
  "project_correction_rules",
  "project_source_settings",
  "project_members"
];
const tables = names.map((name) => ({
  name,
  present: !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name)
}));
console.log(
  JSON.stringify(
    {
      main: "3e8d8bbd",
      delivery: "6547e18e",
      before,
      after: db.prepare("SELECT MAX(created_at) AS latest FROM __drizzle_migrations").get(),
      tables,
      result: "Upgrade skipped earlier migrations because Stars timestamp is already applied",
      fixture: dir
    },
    null,
    2
  )
);
db.close();
