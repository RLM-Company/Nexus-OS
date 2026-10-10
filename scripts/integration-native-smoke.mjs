#!/usr/bin/env node
import { ts } from "./offline-typescript.mjs";
/** Offline, deterministic smoke of real migration DDL, owner-budget ledger and export ZIP. */
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
const repo = resolve(import.meta.dirname, "..");
const temp = mkdtempSync(join(tmpdir(), "kosmora-native-smoke-"));
let count = 0;
const check = (name, fn) => {
  fn();
  count++;
  console.log("PASS", name);
};
const compile = (source, target) => {
  const output = ts.transpileModule(readFileSync(resolve(repo, source), "utf8"), {
    fileName: source,
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const path = join(temp, target);
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, output);
};
try {
  writeFileSync(join(temp, "package.json"), '{"type":"module"}');
  compile("apps/api/src/account-settings/account-store.ts", "account-store.js");
  compile("apps/api/src/account-settings/migration.ts", "migration.js");
  compile("apps/api/src/account-settings/privacy/archive.ts", "archive.js");
  compile("apps/api/src/account-settings/privacy/integrated-adapters.ts", "integrated-adapters.js");
  const { AccountStore } = await import(pathToFileURL(join(temp, "account-store.js")));
  const { createArchive, verifiedOriginal } = await import(pathToFileURL(join(temp, "archive.js")));
  const { AgentStudioPrivacyAdapter, PolicyProjectsPrivacyAdapter, WorkPrivacyAdapter } =
    await import(pathToFileURL(join(temp, "integrated-adapters.js")));
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys=ON");
  const journal = JSON.parse(
    readFileSync(resolve(repo, "packages/db/migrations/meta/_journal.json"))
  );
  const applied = [];
  for (const item of journal.entries) {
    const sql = readFileSync(resolve(repo, "packages/db/migrations", `${item.tag}.sql`), "utf8");
    sqlite.exec("BEGIN");
    try {
      for (const stmt of sql.split("--> statement-breakpoint")) if (stmt.trim()) sqlite.exec(stmt);
      sqlite.exec("COMMIT");
      applied.push(item.tag);
    } catch (err) {
      sqlite.exec("ROLLBACK");
      throw new Error(`Migration ${item.tag}: ${err.message}`);
    }
  }
  check("all migration slots and order", () => {
    assert.equal(applied.length, journal.entries.length);
    assert.deepEqual(
      journal.entries.filter((x) => x.idx >= 25).map((x) => x.idx),
      [25, 26, 27, 28, 30, 31, 32, 34, 35]
    );
    assert.equal(sqlite.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
  });
  const now = new Date().toISOString();
  sqlite
    .prepare(
      "INSERT INTO projects(id,owner_id,title,status,created_at,updated_at) VALUES(?,?,?,?,?,?)"
    )
    .run("p1", "alice", "Personal", "active", now, now);
  sqlite
    .prepare(
      "INSERT INTO projects(id,owner_id,title,status,created_at,updated_at) VALUES(?,?,?,?,?,?)"
    )
    .run("p2", "bob", "Other", "active", now, now);
  const account = new AccountStore(sqlite);
  const hold = account.reserve("alice", "doc-answer-1", 1, 120, "main", "p1", "provider", "model");
  check("idempotent owner-scoped reserve", () => {
    assert.equal(
      account.reserve("alice", "doc-answer-1", 1, 120, "main", "p1", "provider", "model"),
      hold
    );
    assert.throws(
      () => account.reserve("bob", "doc-answer-1", 1, 120, "main", "p2", "provider", "model"),
      /CONFLICT/
    );
    assert.equal(account.summary("alice").total_counted_tokens, 120);
  });
  account.completeAuxiliary(
    "alice",
    "doc-answer-1",
    1,
    "document",
    "provider",
    "model",
    15,
    23,
    0.001,
    "USD"
  );
  check("canonical auxiliary reconciliation without double debit", () => {
    assert.equal(account.summary("alice").total_counted_tokens, 38);
    assert.equal(
      sqlite.prepare("SELECT count(*) n FROM kosmora_usage_holds WHERE run_id='doc-answer-1'").get()
        .n,
      0
    );
    assert.equal(
      sqlite
        .prepare("SELECT count(*) n FROM kosmora_auxiliary_model_usage WHERE run_id='doc-answer-1'")
        .get().n,
      1
    );
  });
  const uncertain = account.reserve(
    "alice",
    "unknown-usage",
    1,
    65,
    "main",
    "p1",
    "provider",
    "model"
  );
  account.uncertainReservation(uncertain, "main");
  account.releaseBeforeDispatch(uncertain); // Cannot release uncertain after any possible provider dispatch.
  check("unknown provider usage retains hold", () => {
    assert.equal(account.summary("alice").total_counted_tokens, 103);
    assert.equal(
      sqlite.prepare("SELECT status FROM kosmora_usage_holds WHERE id=?").get(uncertain).status,
      "uncertain"
    );
  });
  const pre = account.reserve("alice", "local-fail", 1, 40, "main", "p1", "provider", "model");
  account.releaseBeforeDispatch(pre);
  check("proven pre-dispatch failure releases hold only", () => {
    assert.equal(account.summary("alice").total_counted_tokens, 103);
    assert.equal(
      sqlite.prepare("SELECT count(*) n FROM kosmora_usage_holds WHERE id=?").get(pre).n,
      0
    );
    assert.equal(
      sqlite.prepare("SELECT count(*) n FROM kosmora_usage_holds WHERE id=?").get(uncertain).n,
      1
    );
  });
  const studio = new AgentStudioPrivacyAdapter(sqlite);
  const policy = new PolicyProjectsPrivacyAdapter(sqlite);
  // Canonical token counts without provider pricing are NOT verified costs.
  const priceHold = account.reserve(
    "alice",
    "price-unknown",
    1,
    180,
    "main",
    "p1",
    "provider",
    "model"
  );
  sqlite
    .prepare("INSERT INTO chats(id,project_id,kind,created_at) VALUES(?,?,?,?)")
    .run("c-p1", "p1", "main", now);
  sqlite
    .prepare(
      "INSERT INTO runs(id,project_id,chat_id,status,created_at,updated_at) VALUES(?,?,?,?,?,?)"
    )
    .run("price-unknown", "p1", "c-p1", "succeeded", now, now);
  sqlite
    .prepare(
      `INSERT INTO model_usage_ledger(usage_id,run_id,project_id,attempt,status,registry_version,
   provider_id,model_requested,estimated_input_tokens,max_output_tokens,actual_input_tokens,actual_output_tokens,
   calculated_cost_amount,currency,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      "price-ledger",
      "price-unknown",
      "p1",
      1,
      "committed",
      "r1",
      "provider",
      "model",
      100,
      80,
      12,
      19,
      null,
      null,
      now,
      now
    );
  account.completeReservation(priceHold, "main", 12, 19);
  check("unknown canonical pricing remains uncertain, counted once at reserved upper bound", () => {
    assert.equal(
      sqlite.prepare("SELECT status FROM kosmora_usage_holds WHERE id=?").get(priceHold).status,
      "uncertain"
    );
    assert.equal(account.summary("alice").total_counted_tokens, 103 + 180);
  });
  sqlite
    .prepare("UPDATE model_usage_ledger SET calculated_cost_amount=?,currency=? WHERE usage_id=?")
    .run(0.001, "USD", "price-ledger");
  assert.equal(account.reconcileKnownCanonicalHolds(), 1);
  assert.equal(account.reconcileKnownCanonicalHolds(), 0);
  check("later canonical price reconciles once and releases only proven hold", () => {
    assert.equal(
      sqlite.prepare("SELECT count(*) n FROM kosmora_usage_holds WHERE id=?").get(priceHold).n,
      0
    );
    assert.equal(account.summary("alice").total_counted_tokens, 103 + 31);
  });
  check("SQL privacy exporters on migrated database", () => {
    assert.ok(studio.export("alice"));
    assert.ok(policy.export("alice"));
  });
  const work = new WorkPrivacyAdapter(sqlite, { quiesceOwner: async () => {} });
  await work.export("alice");
  count++;
  console.log("PASS work and memory query shapes");
  sqlite
    .prepare(
      "INSERT INTO kosmora_owner_data_lifecycle(owner_id,epoch,state,operation_id,started_at,updated_at) VALUES('alice',1,'quiescing','test',?,?)"
    )
    .run(now, now);
  check("durable fence blocks original insertion; other owner not blocked", () => {
    assert.throws(
      () =>
        sqlite
          .prepare(
            `INSERT INTO document_library_files
      (id,project_id,owner_id,name,format,media_type,bytes,original,status,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`
          )
          .run(
            "f1",
            "p1",
            "alice",
            "a.txt",
            "txt",
            "text/plain",
            1,
            Buffer.from("a"),
            "ready",
            now,
            now
          ),
      /OWNER_DATA_FENCED/
    );
    sqlite
      .prepare(
        `INSERT INTO document_library_files
      (id,project_id,owner_id,name,format,media_type,bytes,original,status,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`
      )
      .run("f2", "p2", "bob", "b.txt", "txt", "text/plain", 1, Buffer.from("b"), "ready", now, now);
    assert.equal(sqlite.prepare("SELECT count(*) n FROM document_library_files").get().n, 1);
  });
  const bytes = Buffer.from("original document \u00e9");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const verified = await verifiedOriginal(
    (await import("node:stream")).Readable.from([bytes]),
    { id: "b", filename: "b.txt", size_bytes: bytes.length, sha256, content_type: "text/plain" },
    1000
  );
  check("verified binary SHA, size and archive bytes", () => {
    assert.deepEqual(verified, bytes);
    const zip = createArchive(
      [
        { path: "manifest.json", bytes: Buffer.from('{"complete":true}') },
        { path: "originals/documents/00000.bin", bytes }
      ],
      1000
    );
    assert.equal(zip.readUInt32LE(0), 0x04034b50);
    assert.equal(zip.readUInt32LE(zip.length - 22), 0x06054b50);
    assert.ok(zip.includes(bytes));
  });
  sqlite.close();
  console.log("TOTAL PASS", count);
} finally {
  rmSync(temp, { recursive: true, force: true });
}
