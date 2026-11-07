// Node 24+. Build @cosmora/contracts, @cosmora/core, @cosmora/db, @cosmora/api first.
// Fixture corpus only: no owner data, no provider call, no model download.
// The embedding encoder is a deterministic one-hot stand-in, so the semantic
// numbers describe the pipeline, NOT real E5 retrieval quality.
import assert from "node:assert/strict";
import console from "node:console";
import process from "node:process";
import { performance } from "node:perf_hooks";
import { writeFileSync } from "node:fs";
import { openDatabase, runMigrations, ContextMemoryStore } from "../packages/db/dist/index.js";
import { compactChatHistory } from "../packages/core/dist/history-compaction.js";
import { SemanticHistoryIndex } from "../apps/api/dist/semantic-memory/index-service.js";

const at = "2026-11-02T09:00:00.000Z";
const target = { kind: "chat", id: "work" };
const filler = (n) =>
  ("Подробное описание визуального варианта оформления, часть " + n + ". ").repeat(24);
const turns = [
  ["user", "Проект «Логистика». Заявка 00123, бюджет 17 350 ₽. Доставка не входит."],
  ["assistant", filler(1)],
  ["user", "Уточнение от 2026-11-02: бюджет 19 700 ₽ на заявку 00123."],
  ["assistant", filler(2)],
  ["user", "Добавь в письмо дату 02.11.2026 и сумму 19 700 ₽."],
  ["assistant", "Итого 21 000 ₽ с доставкой — по моей оценке."],
  ["user", "Без доставки. Кроме доставки ничего не добавлять."],
  ["assistant", filler(3)],
  ["user", "Статус: письмо не отправлено, ждём согласования."],
  ["assistant", filler(4)],
  ["user", "Код заявки 00123 не менять."],
  ["assistant", filler(5)],
  ["user", "Следующий шаг — проверить адрес доставки."],
  ["assistant", filler(6)],
  ["user", "И ещё правка: срок 05.11.2026."],
  ["assistant", filler(7)],
  ["user", "Напомни: какой бюджет заявки и что с доставкой?"]
];
const corpus = turns.map(([role, content], i) => ({
  id: "m-" + String(i).padStart(2, "0"),
  chat_id: "archive",
  role,
  content_type: "text",
  content,
  status: "completed",
  run_id: null,
  error_code: null,
  created_at: new Date(Date.parse(at) + i * 60_000).toISOString(),
  updated_at: at
}));

const db = openDatabase(":memory:");
await runMigrations(db);
const insert = db.sqlite.prepare(
  "INSERT INTO general_chat_messages(id,chat_id,owner_id,role,content_type,content,status,created_at,updated_at) VALUES(?,?,?,?,'text',?,'completed',?,?)"
);
for (const [id, owner] of [
  ["work", "a"],
  ["archive", "a"]
])
  db.sqlite
    .prepare("INSERT INTO general_chats(id,owner_id,title,created_at,updated_at) VALUES(?,?,?,?,?)")
    .run(id, owner, id, at, at);
for (const m of corpus) insert.run(m.id, m.chat_id, "a", m.role, m.content, m.created_at, at);

const memory = new ContextMemoryStore(db.sqlite, () => Date.parse(at));
const settings = (extra) =>
  memory.updateSettings(
    target,
    {
      enabled: true,
      use_personal: false,
      source_chat_ids: ["archive"],
      project_ids: [],
      expected_version: memory.settings(target, "a").version,
      ...extra
    },
    "a"
  );

// 1. Compaction: real bytes, real coverage, explicit stale retention.
const started = performance.now();
const compacted = compactChatHistory(corpus, {
  enabled: true,
  query: "какой бюджет заявки и что с доставкой"
});
const compactionMs = performance.now() - started;
assert.equal(compacted.report.state, "applied");
const capsule = compacted.memory.items.map((e) => e.text).join("\n");
const required = ["19 700", "00123", "Кроме доставки", "17 350"];
const kept = required.filter((v) => capsule.includes(v));

// 2. Recall: lexical hit on the owner decision, stale figure attribution.
settings();
const v2 = corpus.find((m) => m.id === "m-02");
const entry = memory.create(
  {
    scope: "chat",
    scope_id: "work",
    kind: "decision",
    title: "Бюджет заявки 00123",
    content: "Бюджет 19 700 ₽, доставка не входит.",
    pinned: true,
    expires_at: null,
    source: { kind: "chat_message", message_id: v2.id, quote: "бюджет 19 700 ₽" }
  },
  "a"
);
const recalled = await memory.resolveAsync(target, "a", "бюджет заявки");
const memoryHits = recalled.items.filter((e) => e.kind === "memory");
const stale = recalled.items.filter((e) => e.text.includes("17 350"));
const assistantClaims = recalled.items.filter((e) => e.source?.role === "assistant");

// 3. Index build cost: real rows/time; encoder replaced by a fixture.
const unit = (n) => Array.from({ length: 384 }, (_, i) => (i === n ? 1 : 0));
const encoder = {
  encoder: "fixture-onehot",
  drain: () => Promise.resolve(),
  rank: () => Promise.reject(new Error("legacy rank must not run")),
  embed: async (_kind, texts) => ({
    encoder: "fixture-onehot",
    vectors: texts.map((t) => unit(/Логистика|перевозк|груз/.test(t) ? 1 : 2))
  })
};
const index = new SemanticHistoryIndex(db.sqlite, encoder, { now: () => Date.parse(at) });
memory.indexedRecall = index;
const indexStarted = performance.now();
let builds = 0;
for (let n = 0; n < 250; n++) {
  if (index.store.progress(target, "a", index.format).state !== "building") break;
  await index.buildOnce(target, "a");
  builds++;
}
const indexMs = performance.now() - indexStarted;
const summary = index.store.summary(target, "a", index.format);
const paraphrased = await memory.resolveAsync(target, "a", "какая сумма по перевозке груза");

// 4. Revocation: nothing survives in recall or index.
memory.updateSettings(
  target,
  {
    enabled: true,
    use_personal: false,
    source_chat_ids: [],
    project_ids: [],
    expected_version: memory.settings(target, "a").version
  },
  "a"
);
const revoked = await memory.resolveAsync(target, "a", "какая сумма по перевозке груза");
const historyAfterRevoke = revoked.items.filter((e) => e.kind === "history").length;
const rowsLeft = db.sqlite.prepare("SELECT count(*) n FROM semantic_index_sources").get().n;
const forgotten = memory.forgetScope(target, "a");
const afterForget = await memory.resolveAsync(target, "a", "какая сумма по перевозке груза");
await index.stop();

const report = {
  at: new Date().toISOString(),
  node: process.version,
  fixture: true,
  provider_called: false,
  encoder: "fixture-onehot (not E5; semantic quality not measured)",
  corpus: {
    messages: corpus.length,
    source_bytes: compacted.report.source_bytes,
    capsule_bytes: compacted.report.capsule_bytes,
    ratio: Number(
      ((compacted.report.capsule_bytes / compacted.report.source_bytes) * 100).toFixed(1)
    ),
    protected_spans: compacted.report.protected_spans,
    protected_kept: compacted.report.protected_kept,
    omitted_spans: compacted.report.omitted_spans,
    duplicate_spans: compacted.report.duplicate_spans,
    compaction_ms: Number(compactionMs.toFixed(2)),
    tokens: "not measured: no tokenizer for this route; bytes are the only honest bound"
  },
  coverage: {
    required_facts: required.length,
    extracted_facts: kept.length,
    missing: required.filter((v) => !kept.includes(v)),
    superseded_kept_in_capsule: capsule.includes("17 350") ? 1 : 0
  },
  recall: {
    memory_hits: memoryHits.length,
    correct_entry: memoryHits.some((e) => e.reference === "M:" + entry.id),
    stale_hits_user_role: stale.filter((e) => e.source?.role === "user").length,
    assistant_claims: assistantClaims.length,
    retrieval: recalled.retrieval,
    bundle_bytes: recalled.bytes
  },
  index: {
    builds,
    build_ms: Number(indexMs.toFixed(2)),
    indexed_sources: summary.indexed_sources,
    indexed_chunks: summary.indexed_chunks,
    paraphrase_hybrid: paraphrased.retrieval === "hybrid",
    paraphrase_top: paraphrased.items[0]?.reference ?? null
  },
  revocation: {
    history_items_after_revoke: historyAfterRevoke,
    index_rows_left: Number(rowsLeft),
    forgotten_entries: forgotten.forgotten_entries,
    items_after_forget: afterForget.items.length
  }
};
assert.equal(report.coverage.missing.length, 0, "fixture facts must survive compaction");
assert.equal(report.recall.correct_entry, true);
assert.equal(report.revocation.history_items_after_revoke, 0);
assert.equal(report.revocation.index_rows_left, 0);
assert.equal(report.revocation.items_after_forget, 0);

db.close();
const output = process.argv.find((v) => v.startsWith("--output="))?.slice(9);
if (output) writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
