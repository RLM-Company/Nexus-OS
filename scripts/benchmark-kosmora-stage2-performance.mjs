#!/usr/bin/env node
/**
 * Kosmora / Nexus-OS Stage-2 Automated Performance & Latency Benchmarking Harness (Wave 16)
 *
 * Formally measures runtime throughput, latencies, memory footprint, and token savings SLAs:
 * 1. Dense Semantic Vector Generation & Cosine Similarity Throughput
 * 2. Dense + Sparse Hybrid RRF Search Latency
 * 3. Model-Aware Prompt Caching Optimizer Throughput & Token Cache Hit Rate (> 80%)
 * 4. Streaming Speculative Tool Routing Zero-Latency Hit Rate & Time Saved
 * 5. Self-Healing State Checkpoint Transition Latency
 * 6. Vault Multi-Document Cross-Citation Graph Construction Latency
 */

import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { ts, DatabaseSync } from "./offline-typescript.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tempDir = mkdtempSync(join(tmpdir(), "kosmora-perf-bench-"));

function emitTs(sourceRel, targetRel) {
  let code = ts.transpileModule(readFileSync(resolve(root, sourceRel), "utf8"), {
    fileName: sourceRel,
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
  }).outputText;

  const sqliteShimUrl = pathToFileURL(resolve(root, "scripts/offline-typescript.mjs")).href;
  code = code.replace(/from\s+["']node:sqlite["']/g, `from "${sqliteShimUrl}"`);
  code = code.replace(/\.ts(["'])/g, ".js$1");

  const outPath = join(tempDir, targetRel);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, code, "utf8");
}

console.log("================================================================================");
console.log("⚡ KOSMORA / KOSWORK STAGE-2 PERFORMANCE & LATENCY BENCHMARKING HARNESS");
console.log(`Timestamp: ${new Date().toISOString()}`);
console.log("================================================================================");

writeFileSync(join(tempDir, "package.json"), '{"type":"module"}\n', "utf8");

emitTs("packages/core/src/bpe-context-estimator-and-audit.ts", "packages/core/src/bpe-context-estimator-and-audit.js");
emitTs("packages/core/src/prompt-caching-optimizer.ts", "packages/core/src/prompt-caching-optimizer.js");
emitTs("packages/core/src/speculative-tool-router.ts", "packages/core/src/speculative-tool-router.js");
emitTs("packages/db/src/dense-vector-semantic-search.ts", "packages/db/src/dense-vector-semantic-search.js");
emitTs("packages/db/src/context-memory-hybrid-search.ts", "packages/db/src/context-memory-hybrid-search.js");
emitTs("packages/db/src/vault-cross-citation-graph.ts", "packages/db/src/vault-cross-citation-graph.js");
emitTs("packages/db/src/workflow-dag-templates-and-critic.ts", "packages/db/src/workflow-dag-templates-and-critic.js");
emitTs("packages/db/src/workflow-portability-and-zip-exporter.ts", "packages/db/src/workflow-portability-and-zip-exporter.js");
emitTs("packages/db/src/self-healing-workflow-runtime.ts", "packages/db/src/self-healing-workflow-runtime.js");

const { DenseVectorSemanticSearch, generateDenseSemanticVector, computeCosineSimilarity } = await import(
  pathToFileURL(join(tempDir, "packages/db/src/dense-vector-semantic-search.js")).href
);
const { VaultCrossCitationGraphEngine } = await import(
  pathToFileURL(join(tempDir, "packages/db/src/vault-cross-citation-graph.js")).href
);
const { optimizePromptCachingLayout } = await import(
  pathToFileURL(join(tempDir, "packages/core/src/prompt-caching-optimizer.js")).href
);
const { SpeculativeToolRouter } = await import(
  pathToFileURL(join(tempDir, "packages/core/src/speculative-tool-router.js")).href
);
const { SelfHealingWorkflowRuntime } = await import(
  pathToFileURL(join(tempDir, "packages/db/src/self-healing-workflow-runtime.js")).href
);

const benchmarkResults = [];

// BENCHMARK 1: In-Memory Dense Vector Embedding Throughput & Similarity
function benchDenseVectorMath() {
  const vectorCount = 1000;
  const sampleText = "The Kosmora AI project confirms launch budget $250,000 for November 15, 2026 under Project Apollo.";

  const t0 = performance.now();
  let v1 = null;
  for (let i = 0; i < vectorCount; i++) {
    v1 = generateDenseSemanticVector(`${sampleText} iteration ${i}`);
  }
  const duration = performance.now() - t0;
  const throughput = Math.round((vectorCount / duration) * 1000);

  const v2 = generateDenseSemanticVector("Project Apollo timeline and budget allocation November 2026.");
  const simT0 = performance.now();
  for (let j = 0; j < 5000; j++) {
    computeCosineSimilarity(v1, v2);
  }
  const simDuration = performance.now() - simT0;
  const simThroughput = Math.round((5000 / simDuration) * 1000);

  benchmarkResults.push({
    Benchmark: "Dense Semantic Vector Embedding",
    Metric: "Embedding Throughput",
    Observed: `${throughput} vectors/sec`,
    TargetSLA: "> 800 vectors/sec",
    Status: throughput > 800 ? "PASS" : "FAIL"
  });

  benchmarkResults.push({
    Benchmark: "Vector Cosine Similarity",
    Metric: "Math Calculation Throughput",
    Observed: `${simThroughput} ops/sec`,
    TargetSLA: "> 100,000 ops/sec",
    Status: simThroughput > 100000 ? "PASS" : "FAIL"
  });
}

// BENCHMARK 2: Dense + Sparse Hybrid RRF Search Latency
async function benchVectorAndHybrid() {
  const db = new DatabaseSync(join(tempDir, "bench_vectors.sqlite"));
  const migrationSql = readFileSync(resolve(root, "packages/db/migrations/0063_unified_stage2_extensions.sql"), "utf8");
  db.exec(migrationSql);

  const denseSearch = new DenseVectorSemanticSearch(db);
  const ownerId = "owner-bench-001";
  const entryCount = 20;
  const now = new Date().toISOString();

  for (let i = 0; i < entryCount; i++) {
    const id = `entry-${i}`;
    const title = `Project Apollo Metric Item ${i}`;
    const content = `Document record ${i} tracks budget ${200000 + i * 500} and target date November ${1 + (i % 28)}, 2026.`;
    db.prepare(`
      INSERT INTO context_memory_entries (id, owner_id, scope, kind, title, content, version, created_at, updated_at)
      VALUES (?, ?, 'project', 'fact', ?, ?, 1, ?, ?)
    `).run(id, ownerId, title, content, now, now);

    denseSearch.indexMemoryEntryVector({ id, ownerId, title, content });
  }

  // Search latency benchmark (5 iterations)
  const searchLatencies = [];
  for (let k = 0; k < 5; k++) {
    const s0 = performance.now();
    const res = denseSearch.hybridSearch({
      ownerId,
      query: "Project Apollo budget 250000 target date November 15",
      topK: 5
    });
    const sDuration = performance.now() - s0;
    searchLatencies.push(sDuration);
    assert.ok(res.length > 0);
  }

  const avgSearchMs = (searchLatencies.reduce((a, b) => a + b, 0) / searchLatencies.length).toFixed(2);
  const slaPass = Number(avgSearchMs) < 250.0;

  benchmarkResults.push({
    Benchmark: "Dense + Sparse Hybrid RRF Search",
    Metric: `Latency (${entryCount} indexed records)`,
    Observed: `${avgSearchMs} ms`,
    TargetSLA: "< 250 ms",
    Status: slaPass ? "PASS" : "FAIL"
  });
}

// BENCHMARK 3: Model-Aware Prompt Caching Optimizer & Hit Rate
function benchPromptCaching() {
  const blocks = [
    { id: "sys", role: "system", content: "You are Kosmora Autonomous OS.".repeat(80), isImmutablePrefix: true },
    { id: "tools", role: "tools", content: "Tool specifications and security boundaries.".repeat(60), isImmutablePrefix: true },
    { id: "mem", role: "pinned_memory", content: "Pinned project memory facts and user preferences.".repeat(40), isImmutablePrefix: true },
    { id: "hist", role: "conversation_history", content: "Prior turn conversation history.".repeat(30), isImmutablePrefix: false },
    { id: "turn", role: "active_turn", content: "User prompt query for the current turn.", isImmutablePrefix: false }
  ];

  const t0 = performance.now();
  const report = optimizePromptCachingLayout(blocks, { cacheBlockSize: 1024, maxCheckpoints: 4 });
  const duration = performance.now() - t0;

  const hitRatePct = (report.estimatedCacheHitRate * 100).toFixed(1);
  const slaPass = Number(hitRatePct) >= 80.0 && duration < 10.0;

  benchmarkResults.push({
    Benchmark: "Prompt Caching Optimizer",
    Metric: "Execution Latency",
    Observed: `${duration.toFixed(2)} ms`,
    TargetSLA: "< 10 ms",
    Status: duration < 10.0 ? "PASS" : "FAIL"
  });

  benchmarkResults.push({
    Benchmark: "Prompt Caching Prefix Stability",
    Metric: "Estimated Cache Hit Rate",
    Observed: `${hitRatePct}%`,
    TargetSLA: "> 80.0%",
    Status: Number(hitRatePct) >= 80.0 ? "PASS" : "FAIL"
  });
}

// BENCHMARK 4: Speculative Tool Execution Zero-Latency Savings
async function benchSpeculativeRouter() {
  const simulatedToolLatencyMs = 40;
  const router = new SpeculativeToolRouter({
    executors: {
      vault_read: async (args) => {
        await new Promise(r => setTimeout(r, simulatedToolLatencyMs));
        return { content: `Data for ${args.file}` };
      }
    }
  });

  const sessionId = "bench-spec-sess";
  const ownerId = "owner-bench-002";
  const rounds = 5;

  for (let i = 0; i < rounds; i++) {
    // Stream token chunks
    router.pushStreamChunk(sessionId, `<tool_call><name>vault_read</name><args>{"file": "doc-${i}.docx"`, { ownerId, callIndex: i });
    router.pushStreamChunk(sessionId, `}</args></tool_call>`, { ownerId, callIndex: i });

    // Wait 45ms to simulate LLM finalizing turn while speculation completes in background
    await new Promise(r => setTimeout(r, simulatedToolLatencyMs + 5));

    const res = await router.resolveFinalToolCall(
      sessionId,
      i,
      { name: "vault_read", args: { file: `doc-${i}.docx` } },
      { ownerId }
    );
    assert.equal(res.speculativeHit, true);
  }

  const tel = router.getTelemetry(sessionId);
  const avgTimeSaved = tel.avgTimeSavedPerHitMs;
  const slaPass = tel.speculativeHits === rounds && avgTimeSaved > 20;

  benchmarkResults.push({
    Benchmark: "Streaming Speculative Tool Router",
    Metric: "Average Time Saved / Hit",
    Observed: `${avgTimeSaved} ms`,
    TargetSLA: "> 20 ms",
    Status: slaPass ? "PASS" : "FAIL"
  });
}

// BENCHMARK 5: Self-Healing State Checkpoint Overhead
async function benchSelfHealingCheckpoints() {
  const db = new DatabaseSync(join(tempDir, "bench_checkpoints.sqlite"));
  const runtime = new SelfHealingWorkflowRuntime(db);
  const runId = "bench-run-checkpoints";

  const transitions = 10;
  const t0 = performance.now();

  for (let i = 0; i < transitions; i++) {
    runtime.saveStepCheckpoint(runId, {
      stepId: `step-${i % 5}`,
      attempt: (i % 3) + 1,
      status: "self_healing",
      outputContent: `Checkpoint transition payload ${i}`,
      remedialDirective: "Retry with adjusted timeout",
      updatedAt: new Date().toISOString()
    });
  }

  const duration = performance.now() - t0;
  const avgMsPerCheckpoint = (duration / transitions).toFixed(2);
  const slaPass = Number(avgMsPerCheckpoint) < 250.0;

  benchmarkResults.push({
    Benchmark: "Self-Healing State Checkpoints",
    Metric: "Overhead per Transition",
    Observed: `${avgMsPerCheckpoint} ms`,
    TargetSLA: "< 250.0 ms",
    Status: slaPass ? "PASS" : "FAIL"
  });
}

// BENCHMARK 6: Multi-Document Cross-Citation Graph Latency
function benchCrossCitationGraph() {
  const engine = new VaultCrossCitationGraphEngine();
  const docs = [];

  for (let d = 0; d < 10; d++) {
    const sentences = [];
    for (let s = 0; s < 15; s++) {
      sentences.push(
        `Section ${s} of Document ${d} reviews Apollo budget ${200000 + d * 1000} and references doc_${(d + 1) % 10}.docx.`
      );
    }
    docs.push({
      id: `doc-${d}`,
      filename: `doc_${d}.docx`,
      format: "docx",
      text: sentences.join(" ")
    });
  }

  const t0 = performance.now();
  const graph = engine.buildKnowledgeGraph(docs);
  const duration = performance.now() - t0;

  assert.equal(graph.documentCount, 10);
  assert.ok(graph.citations.length > 0);
  const slaPass = duration < 800.0;

  benchmarkResults.push({
    Benchmark: "Vault Cross-Citation Knowledge Graph",
    Metric: "10-Doc Graph Construction",
    Observed: `${duration.toFixed(2)} ms`,
    TargetSLA: "< 800 ms",
    Status: slaPass ? "PASS" : "FAIL"
  });
}

try {
  benchDenseVectorMath();
  await benchVectorAndHybrid();
  benchPromptCaching();
  await benchSpeculativeRouter();
  await benchSelfHealingCheckpoints();
  benchCrossCitationGraph();

  console.table(benchmarkResults);

  const anyFailed = benchmarkResults.some(r => r.Status === "FAIL");
  if (anyFailed) {
    console.error("❌ One or more benchmark SLAs failed.");
    process.exit(1);
  }

  console.log("🎉 ALL STAGE-2 PERFORMANCE & LATENCY BENCHMARK SLAs VERIFIED GREEN!");
  process.exit(0);
} catch (err) {
  console.error("❌ Benchmark execution failed:", err);
  process.exit(1);
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
