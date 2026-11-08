// Frozen synthetic evaluation of the semantic history index on a larger
// corpus with explicit absent-fact questions: facts that are NOT in the
// corpus must not surface as confident matches. No product code changes are
// required to run this; the index and the store are used as shipped. Results
// are one-machine measurements on synthetic data, not SLA or intelligence
// claims. The shipped retrieval constants that decide whether an absent
// question turns into a claimed match are the fixed cosine gate 0.72, the
// 0.06 first-result margin and the RRF fusion (k=60) of at most eight
// semantic sources.
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { ContextMemoryStore, openDatabase, runMigrations } from "../packages/db/src/index.ts";
import { scoreSemanticVector, vectorBytes } from "../packages/db/src/semantic-index-store.ts";
import { LocalMemoryRanker } from "../apps/api/src/semantic-memory/local-ranker.ts";
import { SemanticHistoryIndex } from "../apps/api/src/semantic-memory/index-service.ts";

const [directory, output, profile] = process.argv.slice(2);
if (!directory) throw Error("Pass a verified local model directory and optional report path");
if (profile && profile !== "--small") throw Error("Unknown runtime profile");
const fixture = JSON.parse(
  await readFile(
    new URL("../packages/db/test/fixtures/semantic-absent-fact-evaluation.json", import.meta.url),
    "utf8"
  )
);
const fixtureSha = createHash("sha256").update(JSON.stringify(fixture)).digest("hex");
const NOISE_COUNT = 240;
const GATE = 0.72;
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
  const now = "2026-11-09T12:00:00.000Z";
  for (const id of ["target", "history"])
    db.sqlite
      .prepare(
        "INSERT INTO general_chats(id,owner_id,title,created_at,updated_at) VALUES(?,'evaluation',?,?,?)"
      )
      .run(id, id, now, now);
  const message = (id, text, chat, date) =>
    db.sqlite
      .prepare(
        "INSERT INTO general_chat_messages(id,chat_id,owner_id,role,content_type,content,status,created_at,updated_at) VALUES(?,?,'evaluation','user','text',?,'completed',?,?)"
      )
      .run(id, chat, text, date, date);
  for (const doc of fixture.documents)
    message(doc.id, doc.text, "history", "2020-01-01T00:00:00.000Z");
  // Deterministic service noise, same role as unrelated history. Three fixed
  // templates keep the volume realistic without pretending to be real data.
  for (let n = 0; n < NOISE_COUNT; n++) {
    const variant = n % 3;
    const body =
      variant === 0
        ? "Служебная запись " +
          n +
          ": описание несвязанного примера, без решений по текущим вопросам."
        : variant === 1
          ? "Служебная запись " +
            n +
            ": повторный черновик договора, помечен как архивный материал."
          : "Служебная запись " + n + ": список файлов закрытого проекта, скрыт из поиска.";
    message("zz-noise-" + n, body, "history", now);
  }
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
  for (; batches < 2000; batches++) {
    const p = index.store.progress(target, "evaluation", index.format);
    if (p.state === "ready") break;
    if (p.state !== "building") throw Error("Unexpected backfill limit: " + p.state);
    await index.buildOnce(target, "evaluation");
  }
  if (batches === 2000) throw Error("Backfill did not complete");
  const buildMs = performance.now() - started;

  const mirrorBestCosine = async (query) => {
    // Measurement-only mirror: the shipped scoring helper against every
    // indexed chunk row, independent of the retrieval page walk, so each
    // question has a strict best-cosine value to compare with the 0.72 gate.
    // The named top references are kept for diagnostics: an absent question
    // is expected to sit near its closest topical distractor, and that
    // context is what makes the measurement interpretable.
    const encoded = await encoder.embed(
      "query",
      [query.slice(0, 2000).replace(/[\uD800-\uDBFF]$/, "")],
      undefined
    );
    const vector = encoded.vectors[0];
    vectorBytes(vector);
    const all = [];
    let after = 0;
    const upper = index.store.summary(target, "evaluation", index.format).upper;
    for (;;) {
      const page = index.store.rows(target, "evaluation", index.format, after, upper);
      if (!page.length) break;
      for (const row of page) {
        after = row.id;
        const score = scoreSemanticVector(row.vector, vector);
        const previous = all.find((v) => v.reference === row.reference);
        if (!previous || previous.score < score) {
          if (previous) previous.score = score;
          else all.push({ reference: row.reference, score });
        }
      }
      if (after >= upper) break;
    }
    all.sort((x, y) => y.score - x.score);
    return {
      best: all[0]?.score ?? -2,
      top: all.slice(0, 3).map((entry) => ({ reference: entry.reference, cosine: entry.score }))
    };
  };

  const presentCases = [],
    absentCases = [];
  for (const q of fixture.queries) {
    const absent = q.kind === "absent";
    const beforeBegin = performance.now(),
      before = await a.resolveAsync(target, "evaluation", q.text),
      boundedMs = performance.now() - beforeBegin;
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
    const beforeRefs = [...new Set(before.items.map((e) => e.reference))];
    const afterRefs = [...new Set(after.items.map((e) => e.reference))];
    const added = afterRefs.filter((reference) => !beforeRefs.includes(reference));
    if (absent) {
      const mirror = await mirrorBestCosine(q.text);
      absentCases.push({
        query: q.text,
        added_semantic_references: added,
        best_cosine_mirror: mirror.best,
        top_references: mirror.top,
        bounded_ms: boundedMs,
        indexed_ms: indexedMs
      });
    } else {
      const rank = (refs) => refs.indexOf("H:g:" + q.gold) + 1 || null;
      presentCases.push({
        query: q.text,
        gold: q.gold,
        bounded_rank: rank(beforeRefs),
        indexed_rank: rank(afterRefs),
        best_cosine_mirror: (await mirrorBestCosine(q.text)).best,
        bounded_ms: boundedMs,
        indexed_ms: indexedMs
      });
    }
  }

  const metric = (field) => ({
    top1: presentCases.filter((c) => c[field] === 1).length,
    top3: presentCases.filter((c) => c[field] && c[field] <= 3).length,
    mrr:
      presentCases.reduce((sum, c) => sum + (c[field] ? 1 / c[field] : 0), 0) / presentCases.length
  });
  const median = (field) => {
    const values = presentCases.map((c) => c[field]).sort((x, y) => x - y);
    return values[Math.floor(values.length / 2)];
  };
  const cosine = (field, list) => {
    const values = list.map((c) => c[field]).sort((x, y) => y - x);
    return {
      p50: values[Math.floor(values.length / 2)],
      max: values.reduce((n, v) => (v > n ? v : n), -2),
      over_gate: values.filter((v) => v >= GATE).length
    };
  };
  const report = {
    fixture_sha256: fixtureSha,
    noise_generator: `v2-${NOISE_COUNT}-three-fixed-templates`,
    documents: fixture.documents.length + NOISE_COUNT,
    present_queries: presentCases.length,
    absent_queries: absentCases.length,
    encoder: encoder.encoder,
    runtime_profile: encoder.runtimeProfile,
    build_batches: batches,
    build_ms: buildMs,
    present: {
      bounded: metric("bounded_rank"),
      indexed: metric("indexed_rank"),
      median_bounded_ms: median("bounded_ms"),
      median_indexed_ms: median("indexed_ms"),
      best_cosine_mirror: cosine("best_cosine_mirror", presentCases)
    },
    absent: {
      gate: GATE,
      false_positive_count: absentCases.filter((c) => c.added_semantic_references.length).length,
      over_gate_count: absentCases.filter((c) => c.best_cosine_mirror >= GATE).length,
      best_cosine_mirror: cosine("best_cosine_mirror", absentCases)
    },
    rss_snapshot_mib: process.memoryUsage().rss / 1048576,
    present_cases: presentCases,
    absent_cases: absentCases
  };
  if (output) await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  console.log(
    JSON.stringify({ ...report, present_cases: undefined, absent_cases: undefined }, null, 2)
  );
} finally {
  await index?.stop();
  await encoder.close();
  db.close();
}
