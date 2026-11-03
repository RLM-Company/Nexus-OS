import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { ContextMemoryStore, openDatabase, runMigrations } from "../packages/db/src/index.ts";
import { LocalMemoryRanker } from "../apps/api/src/semantic-memory/local-ranker.ts";
import { SemanticHistoryIndex } from "../apps/api/src/semantic-memory/index-service.ts";

const [directory, output, profile] = process.argv.slice(2);
if (!directory) throw Error("Pass a verified local model directory and optional report path");
if (profile && profile !== "--small") throw Error("Unknown runtime profile");
const fixture = JSON.parse(
  await readFile(
    new URL("../packages/db/test/fixtures/semantic-memory-evaluation.json", import.meta.url),
    "utf8"
  )
);
const fixtureSha = createHash("sha256").update(JSON.stringify(fixture)).digest("hex");
const db = openDatabase(":memory:"),
  encoder = new LocalMemoryRanker(
    directory,
    60000,
    profile ? { batchSize: 1, intraThreads: 1 } : {}
  );
let index;
try {
  await runMigrations(db);
  if (!(await encoder.warmup())) throw Error("Actual model required, no mock substitute");
  const at = "2026-11-03T12:00:00.000Z";
  for (const id of ["target", "history", "cjk-target", "cjk-source"])
    db.sqlite
      .prepare(
        "INSERT INTO general_chats(id,owner_id,title,created_at,updated_at) VALUES(?,'evaluation',?,?,?)"
      )
      .run(id, id, at, at);
  const message = (id, text, chat, date) =>
    db.sqlite
      .prepare(
        "INSERT INTO general_chat_messages(id,chat_id,owner_id,role,content_type,content,status,created_at,updated_at) VALUES(?,?,'evaluation','user','text',?,'completed',?,?)"
      )
      .run(id, chat, text, date, date);
  for (const doc of fixture.documents)
    message(doc.id, doc.text, "history", "2020-01-01T00:00:00.000Z");
  for (let n = 0; n < 80; n++)
    message(
      "zz-noise-" + n,
      "Служебная запись " + n + ": описание несвязанного примера, без решений по текущим вопросам.",
      "history",
      at
    );
  const a = new ContextMemoryStore(db.sqlite),
    target = { kind: "chat", id: "target" };
  a.updateSettings(
    target,
    {
      enabled: true,
      use_personal: false,
      source_chat_ids: ["history"],
      project_ids: [],
      expected_version: 0
    },
    "evaluation"
  );
  a.semanticRanker = encoder;
  index = new SemanticHistoryIndex(db.sqlite, encoder, { queryMs: 1000 });
  const started = performance.now();
  let batches = 0;
  for (; batches < 1000; batches++) {
    const p = index.store.progress(target, "evaluation", index.format);
    if (p.state === "ready") break;
    if (p.state !== "building") throw Error("Unexpected backfill limit: " + p.state);
    await index.buildOnce(target, "evaluation");
  }
  if (batches === 1000) throw Error("Backfill did not complete");
  const buildMs = performance.now() - started,
    cases = [];
  for (const q of fixture.queries) {
    const t = performance.now(),
      before = await a.resolveAsync(target, "evaluation", q.text),
      oldMs = performance.now() - t;
    a.indexedRecall = index;
    const begin = performance.now(),
      after = await a.resolveAsync(target, "evaluation", q.text),
      indexedMs = performance.now() - begin;
    a.indexedRecall = undefined;
    if (
      after.retrieval !== "hybrid" ||
      after.semantic_retrieval.index.state !== "ready" ||
      after.semantic_retrieval.limited
    )
      throw Error("Incomplete index cannot count as a successful full-history test");
    const rank = (b) => {
      const n = [...new Set(b.items.map((e) => e.reference))].indexOf("H:g:" + q.gold);
      return n < 0 ? null : n + 1;
    };
    cases.push({
      query: q.text,
      gold: q.gold,
      bounded_rank: rank(before),
      indexed_rank: rank(after),
      bounded_ms: oldMs,
      indexed_ms: indexedMs
    });
  }
  const cjk = { kind: "chat", id: "cjk-target" },
    body = "你".repeat(1800);
  message("cjk", body, "cjk-source", at);
  a.updateSettings(
    cjk,
    {
      enabled: true,
      use_personal: false,
      source_chat_ids: ["cjk-source"],
      project_ids: [],
      expected_version: 0
    },
    "evaluation"
  );
  for (let n = 0; n < 100; n++) {
    const p = index.store.progress(cjk, "evaluation", index.format);
    if (p.state === "ready") break;
    await index.buildOnce(cjk, "evaluation");
  }
  const ranges = db.sqlite
    .prepare(
      "SELECT v.start_utf16,v.end_utf16 FROM semantic_index_chunks v JOIN semantic_index_sources s ON s.id=v.source_id WHERE s.reference='H:g:cjk' ORDER BY v.start_utf16"
    )
    .all();
  let covered = 0;
  for (const r of ranges) {
    if (r.start_utf16 > covered) throw Error("Lost text at token boundary");
    covered = Math.max(covered, r.end_utf16);
  }
  if (covered !== body.length) throw Error("CJK text not fully covered");
  const metric = (field) => ({
    top1: cases.filter((c) => c[field] === 1).length,
    top3: cases.filter((c) => c[field] && c[field] <= 3).length,
    mrr: cases.reduce((sum, c) => sum + (c[field] ? 1 / c[field] : 0), 0) / cases.length
  });
  const median = (field) =>
    cases.map((c) => c[field]).sort((x, y) => x - y)[Math.floor(cases.length / 2)];
  const report = {
    fixture_sha256: fixtureSha,
    noise_generator: "v1-80-newer-independent-notes",
    documents: 96,
    queries: cases.length,
    encoder: encoder.encoder,
    runtime_profile: encoder.runtimeProfile,
    build_batches: batches,
    build_ms: buildMs,
    bounded: metric("bounded_rank"),
    indexed: metric("indexed_rank"),
    median_bounded_ms: median("bounded_ms"),
    median_indexed_ms: median("indexed_ms"),
    cjk: { characters: body.length, covered, chunks: ranges.length },
    rss_snapshot_mib: process.memoryUsage().rss / 1048576,
    cases
  };
  if (output) await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ ...report, cases: undefined }, null, 2));
} finally {
  await index?.stop();
  await encoder.close();
  db.close();
}
