import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { openDatabase, runMigrations, ContextMemoryStore } from "../packages/db/src/index.ts";
import { LocalMemoryRanker } from "../apps/api/src/semantic-memory/local-ranker.ts";

const [modelDirectory, output] = process.argv.slice(2);
if (!modelDirectory)
  throw new Error("Pass an installed model directory and optional JSON result path");
const fixture = JSON.parse(
  await readFile(
    new URL("../packages/db/test/fixtures/semantic-memory-evaluation.json", import.meta.url),
    "utf8"
  )
);
const digest = createHash("sha256").update(JSON.stringify(fixture)).digest("hex");
const db = openDatabase(":memory:");
const boot = performance.now();
const ranker = new LocalMemoryRanker(modelDirectory, 60000);
try {
  await runMigrations(db);
  if (!(await ranker.warmup()))
    throw new Error("Actual encoder failed to load; no fixture substitute allowed");
  const bootMs = performance.now() - boot;
  const at = "2026-11-03T12:00:00.000Z";
  for (const id of ["target", "history"])
    db.sqlite
      .prepare(
        "INSERT INTO general_chats(id,owner_id,title,created_at,updated_at) VALUES(?,'eval',?,?,?)"
      )
      .run(id, id, at, at);
  for (const doc of fixture.documents)
    db.sqlite
      .prepare(
        "INSERT INTO general_chat_messages(id,chat_id,owner_id,role,content_type,content,status,created_at,updated_at) VALUES(?,'history','eval','user','text',?,'completed',?,?)"
      )
      .run(doc.id, doc.text, at, at);
  const store = new ContextMemoryStore(db.sqlite);
  store.semanticRanker = ranker;
  const target = { kind: "chat", id: "target" };
  store.updateSettings(
    target,
    {
      enabled: true,
      use_personal: false,
      source_chat_ids: ["history"],
      project_ids: [],
      expected_version: 0
    },
    "eval"
  );
  const cases = [];
  for (const query of fixture.queries) {
    const before = store.resolve(target, "eval", query.text);
    const start = performance.now();
    const after = await store.resolveAsync(target, "eval", query.text);
    const ms = performance.now() - start;
    if (after.retrieval !== "hybrid")
      throw new Error("Encoder fallback cannot be counted as semantic evaluation");
    const references = (bundle) => [...new Set(bundle.items.map((e) => e.reference))];
    const gold = "H:g:" + query.gold;
    const rank = (bundle) => {
      const index = references(bundle).indexOf(gold);
      return index < 0 ? null : index + 1;
    };
    cases.push({
      query: query.text,
      gold,
      lexical_rank: rank(before),
      hybrid_rank: rank(after),
      hybrid_top3: references(after).slice(0, 3),
      latency_ms: ms
    });
  }
  const metric = (field) => {
    const ranks = cases.map((c) => c[field]);
    return {
      recall_at_1: ranks.filter((n) => n === 1).length / cases.length,
      recall_at_3: ranks.filter((n) => n && n <= 3).length / cases.length,
      mrr: ranks.reduce((sum, n) => sum + (n ? 1 / n : 0), 0) / cases.length
    };
  };
  const times = cases.map((c) => c.latency_ms).sort((a, b) => a - b);
  const result = {
    fixture_sha256: digest,
    cases: cases.length,
    documents: fixture.documents.length,
    node: process.version,
    encoder_boot_ms: bootMs,
    lexical: metric("lexical_rank"),
    hybrid: metric("hybrid_rank"),
    median_hybrid_ms: times[Math.floor(times.length / 2)],
    p95_hybrid_ms: times[Math.ceil(times.length * 0.95) - 1],
    rss_mib: process.memoryUsage().rss / 1024 / 1024,
    results: cases
  };
  if (output) await writeFile(output, JSON.stringify(result, null, 2) + "\n");
  process.stdout.write(JSON.stringify({ ...result, results: undefined }, null, 2) + "\n");
} finally {
  await ranker.close();
  db.close();
}
