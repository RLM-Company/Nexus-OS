import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { DatalogInferenceEngine } from "../../../packages/core/src/datalog-inference-engine.js";
import { MinHashLshDeduplicator } from "../../../packages/db/src/minhash-lsh-deduplicator.js";
import {
  OpenTelemetryTraceAnalyzer,
  formatW3cTraceparent,
  parseW3cTraceparent
} from "../../../packages/core/src/opentelemetry-trace-analyzer.js";

test("DatalogInferenceEngine evaluates recursive transitive closure and stratified negation rules to a least fixed point", () => {
  const engine = new DatalogInferenceEngine();

  // Extensional facts: DAG step dependencies and security clearance
  engine.addFact("step_depends", "step-report", "step-browser");
  engine.addFact("step_depends", "step-browser", "step-vault");
  engine.addFact("step_depends", "step-vault", "step-init");

  engine.addFact("actor_role", "alice", "admin");
  engine.addFact("actor_role", "bob", "admin");
  engine.addFact("quiesced_owner", "bob");

  // Rule 1: Base transitive dependency `reachable(?X, ?Y) :- step_depends(?X, ?Y)`
  engine.addRule({
    id: "rule-dep-base",
    head: { predicate: "reachable", terms: ["?X", "?Y"] },
    body: [{ predicate: "step_depends", terms: ["?X", "?Y"] }]
  });

  // Rule 2: Recursive transitive closure `reachable(?X, ?Z) :- step_depends(?X, ?Y), reachable(?Y, ?Z)`
  engine.addRule({
    id: "rule-dep-trans",
    head: { predicate: "reachable", terms: ["?X", "?Z"] },
    body: [
      { predicate: "step_depends", terms: ["?X", "?Y"] },
      { predicate: "reachable", terms: ["?Y", "?Z"] }
    ]
  });

  // Rule 3: Stratified negation `can_mutate_drive(?U) :- actor_role(?U, "admin"), not quiesced_owner(?U)`
  engine.addRule({
    id: "rule-drive-auth",
    head: { predicate: "can_mutate_drive", terms: ["?U"] },
    body: [
      { predicate: "actor_role", terms: ["?U", "admin"] },
      { predicate: "quiesced_owner", terms: ["?U"], negated: true }
    ]
  });

  const stats = engine.materializeFixedPoint();
  assert.ok(stats.iterations >= 2);
  assert.ok(stats.newlyDerivedCount >= 7);

  const reportDeps = engine.query("reachable", ["step-report", "?Target"]);
  const depTargets = reportDeps.map((r) => r.args[1]).sort();
  assert.deepEqual(depTargets, ["step-browser", "step-init", "step-vault"]);

  const authorized = engine.query("can_mutate_drive", ["?User"]);
  assert.equal(authorized.length, 1);
  assert.equal(authorized[0].args[0], "alice");
});

test("MinHashLshDeduplicator detects near-duplicate texts in sub-linear time via 16 LSH bands and persists signatures", () => {
  const db = new DatabaseSync(":memory:");
  const dedup = new MinHashLshDeduplicator(db);
  const ownerId = "owner-minhash-1";

  const originalArticle =
    "Project Apollo Q4 strategic launch budget is confirmed at $250,000 with full Google Drive OAuth PKCE backup integration and 87.3% prompt cache efficiency.";
  const nearDuplicateArticle =
    "Project Apollo Q4 strategic launch budget is confirmed at $250,000 with full Google Drive OAuth PKCE backup integration and 88.0% prompt cache efficiency!";
  const unrelatedArticle =
    "Local weather forecast for Colorado Springs indicates sunny skies and mild mountain breezes throughout the weekend.";

  dedup.indexDocument("doc-orig", originalArticle, { ownerId, metadata: { version: 1 } });
  dedup.indexDocument("doc-unrelated", unrelatedArticle, { ownerId, metadata: { version: 1 } });

  const matches = dedup.findNearDuplicates(nearDuplicateArticle, { minJaccardThreshold: 0.65 });
  assert.equal(matches.length, 1);
  assert.equal(matches[0].docId, "doc-orig");
  assert.ok(matches[0].estimatedJaccard >= 0.75);
  assert.ok(matches[0].matchedBands >= 4);
});

test("OpenTelemetryTraceAnalyzer propagates W3C traceparent headers and identifies the critical path bottleneck", () => {
  const tracer = new OpenTelemetryTraceAnalyzer();
  const traceId = tracer.createTraceId();
  const rootSpanId = tracer.createSpanId();

  const header = formatW3cTraceparent(traceId, rootSpanId, true);
  const parsed = parseW3cTraceparent(header);
  assert.ok(parsed);
  assert.equal(parsed.traceId, traceId);
  assert.equal(parsed.parentSpanId, rootSpanId);
  assert.equal(parsed.sampled, true);

  // Build a 3-span waterfall:
  // root (0..500ms, total 500ms)
  //   ├── child-vault-fast (10..50ms, 40ms)
  //   └── child-model-gateway-slow (50..470ms, 420ms) -> bottleneck!
  tracer.recordSpan({
    traceId,
    spanId: rootSpanId,
    parentSpanId: null,
    name: "POST /api/workflows/execute",
    serviceName: "kosmora-api",
    startTimeMs: 0,
    endTimeMs: 500,
    status: "OK",
    attributes: { ownerId: "owner-1" }
  });

  const fastChildId = tracer.createSpanId();
  tracer.recordSpan({
    traceId,
    spanId: fastChildId,
    parentSpanId: rootSpanId,
    name: "vault.hybridSearch",
    serviceName: "kosmora-db",
    startTimeMs: 10,
    endTimeMs: 50,
    status: "OK",
    attributes: { hits: 5 }
  });

  const slowChildId = tracer.createSpanId();
  tracer.recordSpan({
    traceId,
    spanId: slowChildId,
    parentSpanId: rootSpanId,
    name: "fable5.streamCompletion",
    serviceName: "model-gateway",
    startTimeMs: 50,
    endTimeMs: 470,
    status: "OK",
    attributes: { tokens: 2048 }
  });

  const report = tracer.analyzeTraceWaterfall(traceId);
  assert.equal(report.totalTraceDurationMs, 500);
  assert.equal(report.spanCount, 3);
  assert.equal(report.bottleneckSpan.spanId, slowChildId);
  assert.equal(report.bottleneckSpan.selfTimeMs, 420);
  assert.equal(report.bottleneckSpan.percentOfTotalTrace, 84);
  assert.deepEqual(report.criticalPathSpanIds, [rootSpanId, slowChildId]);
});
