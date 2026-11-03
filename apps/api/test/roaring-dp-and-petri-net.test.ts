import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  RoaringBitmap32,
  RoaringPositionalInvertedIndex
} from "../../../packages/db/src/roaring-positional-inverted-index.js";
import { DifferentialPrivacyTelemetryEngine } from "../../../packages/core/src/differential-privacy-telemetry.js";
import { PetriNetWorkflowVerifier } from "../../../packages/core/src/petri-net-workflow-verifier.js";

test("RoaringBitmap32 compresses contiguous runs and executes exact intersect/union/difference across 16-bit chunks", () => {
  const bmA = new RoaringBitmap32();
  bmA.addRange(100, 150); // 51 contiguous items in chunk 0 -> Run-Length container
  bmA.add(65536 + 7); // chunk 1
  bmA.add(65536 + 42); // chunk 1

  const bmB = new RoaringBitmap32([120, 121, 122, 65536 + 42, 131072 + 9]);

  assert.equal(bmA.cardinality, 53);
  assert.equal(bmA.has(125), true);
  assert.equal(bmA.has(999), false);

  const serializedA = bmA.serialize();
  assert.equal(serializedA.containers["0"]?.type, "runs");
  assert.equal(serializedA.containers["1"]?.type, "array");

  const roundTripA = RoaringBitmap32.deserialize(serializedA);
  assert.deepEqual(roundTripA.toArray(), bmA.toArray());

  const inter = RoaringBitmap32.intersect(bmA, bmB);
  assert.deepEqual(inter.toArray(), [120, 121, 122, 65536 + 42]);

  const diff = RoaringBitmap32.difference(bmB, bmA);
  assert.deepEqual(diff.toArray(), [131072 + 9]);

  const uni = RoaringBitmap32.union(inter, diff);
  assert.deepEqual(uni.toArray(), bmB.toArray());
});

test("RoaringPositionalInvertedIndex executes exact phrase, proximity slop, tag filter & SQLite persistence", () => {
  const sqlite = new DatabaseSync(":memory:");
  const idx = new RoaringPositionalInvertedIndex("owner_roaring_1", "vault_docs");

  idx.indexDocument({
    externalDocId: "doc_apollo",
    title: "Project Apollo Architecture",
    content:
      "The Project Apollo quantum encryption gateway secures distributed neural memory states across nodes.",
    tags: ["architecture", "security"]
  });

  idx.indexDocument({
    externalDocId: "doc_gemini",
    title: "Apollo Telemetry Notes",
    content:
      "Apollo telemetry uses quantum key rotation and advanced encryption for edge gateway links.",
    tags: ["telemetry", "security"]
  });

  idx.indexDocument({
    externalDocId: "doc_draft",
    title: "Legacy Draft",
    content: "Unrelated notes about old billing spreadsheets.",
    tags: ["draft"]
  });

  // 1. Exact phrase match ("quantum encryption" appears adjacent only in doc_apollo)
  const exactHits = idx.queryPhrase("quantum encryption", { maxSlop: 0 });
  assert.equal(exactHits.length, 1);
  assert.equal(exactHits[0]?.externalDocId, "doc_apollo");

  // 2. Proximity phrase match ("quantum ... encryption" within 4 words matches both doc_apollo and doc_gemini)
  const slopHits = idx.queryPhrase("quantum encryption", {
    maxSlop: 4,
    requiredTags: ["security"]
  });
  assert.equal(slopHits.length, 2);

  // 3. Boolean filter with mustTerms, requiredTags, mustNotTerms
  const boolHits = idx.queryBooleanFilter({
    mustTerms: ["apollo", "gateway"],
    requiredTags: ["security"],
    mustNotTerms: ["telemetry"]
  });
  assert.equal(boolHits.length, 1);
  assert.equal(boolHits[0]?.externalDocId, "doc_apollo");

  // 4. SQLite Snapshot Round-Trip
  idx.saveToSqlite(sqlite);
  const loaded = RoaringPositionalInvertedIndex.loadFromSqlite(
    sqlite,
    "owner_roaring_1",
    "vault_docs"
  );
  assert.ok(loaded);
  const postLoadHits = loaded.queryPhrase("project apollo", { maxSlop: 0 });
  assert.equal(postLoadHits.length, 1);
  assert.equal(postLoadHits[0]?.externalDocId, "doc_apollo");
  sqlite.close();
});

test("DifferentialPrivacyTelemetryEngine enforces (epsilon, delta) budget, Laplace/Gaussian bounds & Randomized Response", () => {
  const dp = new DifferentialPrivacyTelemetryEngine({
    ownerId: "owner_dp_1",
    maxEpsilon: 2.0,
    maxDelta: 1e-4,
    deterministicSeed: 424242
  });

  // Sensitivity clipping
  assert.equal(DifferentialPrivacyTelemetryEngine.clipContribution(150, 0, 100), 100);
  assert.equal(DifferentialPrivacyTelemetryEngine.clipContribution(-10, 0, 100), 0);

  // Laplace mechanism (pure epsilon-DP)
  const lap = dp.releaseLaplaceMetric({
    metricName: "daily_active_workflows",
    trueValue: 500,
    l1Sensitivity: 1,
    epsilon: 0.5
  });
  assert.equal(dp.remainingEpsilon, 1.5);
  assert.equal(dp.remainingDelta, 1e-4);
  assert.ok(lap.confidenceInterval95[0] < lap.privatizedValue);
  assert.ok(lap.confidenceInterval95[1] > lap.privatizedValue);

  // Analytic Gaussian mechanism ((epsilon, delta)-DP)
  const gauss = dp.releaseGaussianMetric({
    metricName: "mean_latency_ms",
    trueValue: 120,
    l2Sensitivity: 2.0,
    epsilon: 1.0,
    delta: 5e-5
  });
  assert.equal(dp.remainingEpsilon, 0.5);
  assert.equal(dp.remainingDelta, 5e-5);
  assert.ok(gauss.scaleParameter > 0);

  // Randomized Response local DP
  const rr = dp.releaseRandomizedResponseBoolean({
    metricName: "used_voice_mode",
    truth: true,
    epsilon: 0.4
  });
  assert.equal(typeof rr.privatizedFlag, "boolean");
  assert.equal(dp.remainingEpsilon, 0.1);

  // Exhaustion guard: requesting 0.25 epsilon when only 0.10 remains must throw PRIVACY_BUDGET_EXHAUSTED
  assert.throws(() => {
    dp.releaseLaplaceMetric({
      metricName: "overflow_query",
      trueValue: 10,
      l1Sensitivity: 1,
      epsilon: 0.25
    });
  }, /PRIVACY_BUDGET_EXHAUSTED/);

  // Unbiased Randomized Response proportion estimator
  const syntheticReports = Array.from({ length: 400 }, (_, i) => i < 300); // 75% observed true
  const est = DifferentialPrivacyTelemetryEngine.estimateTrueProportionFromRandomizedResponses(
    syntheticReports,
    2.0
  );
  assert.ok(est >= 0.7 && est <= 0.85);
});

test("PetriNetWorkflowVerifier proves deadlock-freedom on valid lock ordering and catches Coffman circular wait deadlocks", () => {
  // 1. Deadlock-prone Petri Net: Agent 1 locks Vault then Browser; Agent 2 locks Browser then Vault
  const deadlockingNet = new PetriNetWorkflowVerifier({
    places: [
      { id: "p_a1_start", initialTokens: 1 },
      { id: "p_a2_start", initialTokens: 1 },
      { id: "mutex_vault", initialTokens: 1 },
      { id: "mutex_browser", initialTokens: 1 },
      { id: "p_a1_has_vault", initialTokens: 0 },
      { id: "p_a2_has_browser", initialTokens: 0 },
      { id: "p_goal", initialTokens: 0, isTerminalGoal: true }
    ],
    transitions: [
      {
        id: "t_a1_lock_vault",
        name: "Agent 1 acquires Vault lock",
        inputs: [{ placeId: "p_a1_start" }, { placeId: "mutex_vault" }],
        outputs: [{ placeId: "p_a1_has_vault" }]
      },
      {
        id: "t_a2_lock_browser",
        name: "Agent 2 acquires Browser lock",
        inputs: [{ placeId: "p_a2_start" }, { placeId: "mutex_browser" }],
        outputs: [{ placeId: "p_a2_has_browser" }]
      },
      {
        id: "t_a1_lock_browser_and_finish",
        name: "Agent 1 acquires Browser lock and finishes",
        inputs: [{ placeId: "p_a1_has_vault" }, { placeId: "mutex_browser" }],
        outputs: [{ placeId: "mutex_vault" }, { placeId: "mutex_browser" }, { placeId: "p_goal" }]
      },
      {
        id: "t_a2_lock_vault_and_finish",
        name: "Agent 2 acquires Vault lock and finishes",
        inputs: [{ placeId: "p_a2_has_browser" }, { placeId: "mutex_vault" }],
        outputs: [{ placeId: "mutex_vault" }, { placeId: "mutex_browser" }, { placeId: "p_goal" }]
      }
    ]
  });

  const badReport = deadlockingNet.verifyReachability();
  assert.equal(badReport.valid, false);
  assert.equal(badReport.isDeadlockFree, false);
  assert.ok(badReport.deadlocks.length >= 1);

  // 2. Well-ordered concurrent fork-join workflow with shared mutex -> deadlock-free, 1-bounded, 0 dead transitions
  const safeNet = new PetriNetWorkflowVerifier({
    places: [
      { id: "p_start", initialTokens: 1 },
      { id: "p_worker_a", initialTokens: 0 },
      { id: "p_worker_b", initialTokens: 0 },
      { id: "mutex_db", initialTokens: 1, capacity: 1 },
      { id: "p_done_a", initialTokens: 0 },
      { id: "p_done_b", initialTokens: 0 },
      { id: "p_goal", initialTokens: 0, isTerminalGoal: true }
    ],
    transitions: [
      {
        id: "t_fork",
        name: "Fork parallel workers",
        inputs: [{ placeId: "p_start" }],
        outputs: [{ placeId: "p_worker_a" }, { placeId: "p_worker_b" }]
      },
      {
        id: "t_run_a",
        name: "Worker A atomic DB step",
        inputs: [{ placeId: "p_worker_a" }, { placeId: "mutex_db" }],
        outputs: [{ placeId: "p_done_a" }, { placeId: "mutex_db" }]
      },
      {
        id: "t_run_b",
        name: "Worker B atomic DB step",
        inputs: [{ placeId: "p_worker_b" }, { placeId: "mutex_db" }],
        outputs: [{ placeId: "p_done_b" }, { placeId: "mutex_db" }]
      },
      {
        id: "t_join",
        name: "Join workers to goal",
        inputs: [{ placeId: "p_done_a" }, { placeId: "p_done_b" }],
        outputs: [{ placeId: "p_goal" }]
      }
    ]
  });

  const safeReport = safeNet.verifyReachability();
  assert.equal(safeReport.valid, true);
  assert.equal(safeReport.isDeadlockFree, true);
  assert.equal(safeReport.isKBounded, true);
  assert.equal(safeReport.deadTransitions.length, 0);
});
