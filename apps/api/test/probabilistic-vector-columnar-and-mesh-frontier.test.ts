import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

import { FactorGraphBeliefPropagation } from "../../../packages/core/src/factor-graph-belief-propagation.ts";
import { HnswHierarchicalVectorIndex } from "../../../packages/core/src/hnsw-vector-index.ts";
import { ColumnarRleBitPackingStore } from "../../../packages/db/src/columnar-rle-bitpacking-store.ts";
import { EarleyChartParser } from "../../../packages/core/src/earley-chart-parser.ts";
import { HungarianKuhnMunkresAssigner } from "../../../packages/core/src/auction-hungarian-task-assigner.ts";
import { PhiAccrualFailureDetector } from "../../../packages/core/src/swims-phi-accrual-failure-detector.ts";
import { TDigestStreamingQuantiles } from "../../../packages/core/src/t-digest-streaming-quantiles.ts";
import { MinHashLshNearDuplicateIndex } from "../../../packages/core/src/minhash-lsh-deduplicator.ts";
import { EdfAndWeightedRoundRobinScheduler } from "../../../packages/core/src/wrr-edf-realtime-scheduler.ts";
import { AdaptiveReplacementCacheArc } from "../../../packages/core/src/page-replacement-arc-cache.ts";
import { ConsistentHashBoundedLoadRing } from "../../../packages/core/src/consistent-hash-bounded-load.ts";
import { DpllCdclSatSolver } from "../../../packages/core/src/boolean-dpll-cdcl-sat-solver.ts";
import { EventSourcingCqrsProjector } from "../../../packages/db/src/event-sourcing-cqrs-projector.ts";
import { HaarWaveletMultiResolutionAnalyzer } from "../../../packages/core/src/haar-wavelet-multiresolution-analyzer.ts";

test("Phase 11: Probabilistic Graphical Inference, HNSW Vector Index, Columnar RLE Store, Earley Parser & Mesh Frontier (Modules 61-74)", () => {
  // 1. Factor Graph Loopy Belief Propagation (Module 61)
  const fg = new FactorGraphBeliefPropagation();
  fg.addVariable({
    id: "db_overloaded",
    states: ["false", "true"],
    priorPotentials: { false: 0.8, true: 0.2 }
  });
  fg.addVariable({
    id: "latency_spike",
    states: ["false", "true"],
    priorPotentials: { false: 0.01, true: 0.99 } // Observed evidence: latency spike is true
  });
  fg.addFactor({
    id: "f_db_latency",
    scopeVariableIds: ["db_overloaded", "latency_spike"],
    potentialTable: {
      "false,false": 0.9,
      "false,true": 0.1,
      "true,false": 0.05,
      "true,true": 0.95
    }
  });
  const bpRes = fg.runInference();
  assert.equal(bpRes.converged, true);
  assert.equal(bpRes.mapAssignment["db_overloaded"], "true");
  assert.ok((bpRes.marginalsByVariable["db_overloaded"]?.["true"] ?? 0) > 0.65);

  // 2. HNSW Multi-Layer Proximity Vector Index (Module 62)
  const hnsw = new HnswHierarchicalVectorIndex<{ topic: string }>({
    maxConnectionsPerLayer: 6,
    efConstruction: 16
  });
  hnsw.insert({ id: "doc-sql", vector: [0.95, 0.05, 0.0, 0.0], metadata: { topic: "sql" } });
  hnsw.insert({ id: "doc-raft", vector: [0.05, 0.95, 0.0, 0.0], metadata: { topic: "raft" } });
  hnsw.insert({ id: "doc-ui", vector: [0.0, 0.05, 0.95, 0.0], metadata: { topic: "ui" } });
  hnsw.insert({ id: "doc-crypto", vector: [0.0, 0.0, 0.05, 0.95], metadata: { topic: "crypto" } });
  const hits = hnsw.searchKnn([0.92, 0.08, 0.0, 0.0], 2);
  assert.equal(hits[0]?.id, "doc-sql");
  assert.ok((hits[0]?.similarity ?? 0) > 0.98);

  // 3. Columnar RLE + Dictionary + Zone-Map Predicate Pushdown Store (Module 63)
  const db = new DatabaseSync(":memory:");
  const colStore = new ColumnarRleBitPackingStore(db);
  // Stripe 1: low values [10..20]
  colStore.appendColumnStripe("telemetry", "latency_ms", [10, 10, 10, 15, 20, 20]);
  // Stripe 2: high values [200..250]
  const stripe2 = colStore.appendColumnStripe("telemetry", "latency_ms", [200, 200, 200, 250, 250]);
  assert.equal(stripe2.dictionarySize, 2);
  assert.equal(stripe2.rleRunCount, 2);

  const scanRes = colStore.scanNumericRangeWithPushdown({
    tableName: "telemetry",
    columnName: "latency_ms",
    minBound: 180,
    maxBound: 260
  });
  assert.equal(scanRes.stripesPrunedByZoneMap, 1); // Stripe 1 skipped without decoding!
  assert.equal(scanRes.stripesScanned, 1);
  assert.deepEqual(scanRes.matchedValues, [200, 200, 200, 250, 250]);

  // 4. Earley Context-Free Grammar Chart Parser (Module 64)
  const earley = new EarleyChartParser("Expr", [
    { lhs: "Expr", rhs: ["Expr", "+", "Term"] }, // Left-recursive production!
    { lhs: "Expr", rhs: ["Term"] },
    { lhs: "Term", rhs: ["id"] },
    { lhs: "Term", rhs: ["(", "Expr", ")"] }
  ]);
  const parsedValid = earley.parse(["id", "+", "(", "id", "+", "id", ")"]);
  assert.equal(parsedValid.accepted, true);
  const parsedPrefix = earley.parse(["id", "+"]);
  assert.equal(parsedPrefix.accepted, false);
  assert.deepEqual(parsedPrefix.expectedNextSymbols, ["(", "id"]);

  // 5. Kuhn-Munkres (Hungarian) Optimal Bipartite Task Assigner (Module 65)
  const hungarian = HungarianKuhnMunkresAssigner.solveMinimumCostAssignment([
    [10, 19, 8],
    [10, 18, 7],
    [13, 16, 9]
  ]);
  // Optimal: worker 0 -> task 0 (10), worker 1 -> task 2 (7), worker 2 -> task 1 (16) => total = 33
  assert.equal(hungarian.totalMinimumCost, 33);
  assert.equal(hungarian.assignments.length, 3);

  // 6. Hayashibara Phi-Accrual Failure Detector + SWIM Refutation (Module 66)
  const phiDetector = new PhiAccrualFailureDetector({
    suspectPhiThreshold: 2.5,
    deadPhiThreshold: 7.0
  });
  for (let i = 0; i < 6; i++) {
    phiDetector.recordHeartbeat("worker-node-1", 1000 * i, 1);
  }
  assert.equal(phiDetector.evaluateNode("worker-node-1", 5500).status, "ALIVE");
  assert.equal(phiDetector.evaluateNode("worker-node-1", 6300).status, "SUSPECT");
  assert.equal(phiDetector.evaluateNode("worker-node-1", 15000).status, "DEAD");
  const refuted = phiDetector.refuteSuspicion("worker-node-1", 15100);
  assert.equal(refuted.status, "ALIVE");
  assert.equal(refuted.incarnation, 2);

  // 7. Dunning Merging t-Digest Streaming Quantiles (Module 67)
  const tdigest = new TDigestStreamingQuantiles(40);
  for (let i = 1; i <= 200; i++) {
    tdigest.add(i);
  }
  const p50 = tdigest.quantile(0.5);
  const p99 = tdigest.quantile(0.99);
  assert.ok(p50 >= 95 && p50 <= 105);
  assert.ok(p99 >= 195 && p99 <= 200);

  // 8. MinHash + Banded LSH Near-Duplicate Detector (Module 68)
  const lsh = new MinHashLshNearDuplicateIndex({ numBands: 16, rowsPerBand: 4 });
  lsh.indexDocument(
    "doc-1",
    "Kosmora autonomous operating system orchestrates multi-agent workflows with formal verification"
  );
  lsh.indexDocument(
    "doc-2",
    "Completely unrelated recipe for baking traditional sourdough bread in a cast iron oven"
  );
  const dupHits = lsh.queryNearDuplicates(
    "Kosmora autonomous operating system orchestrates multi-agent workflows with formal verification and safety",
    0.4
  );
  assert.equal(dupHits[0]?.docId, "doc-1");

  // 9. EDF Real-Time Scheduler + Smooth Weighted Round-Robin (Module 69)
  const edfReport = EdfAndWeightedRoundRobinScheduler.evaluateEdfSchedule([
    { taskId: "rt-slow", executionTimeMs: 20, periodMs: 100, absoluteDeadlineMs: 90 },
    { taskId: "rt-urgent", executionTimeMs: 10, periodMs: 50, absoluteDeadlineMs: 30 }
  ]);
  assert.equal(edfReport.isSchedulableUnderEdf, true);
  assert.equal(edfReport.orderedSchedule[0]?.taskId, "rt-urgent");

  const swrr = new EdfAndWeightedRoundRobinScheduler();
  swrr.registerWeightedPeer("peer-heavy", 3);
  swrr.registerWeightedPeer("peer-light", 1);
  const picks = [
    swrr.nextSmoothWeightedPeer(),
    swrr.nextSmoothWeightedPeer(),
    swrr.nextSmoothWeightedPeer(),
    swrr.nextSmoothWeightedPeer()
  ];
  assert.equal(picks.filter((p) => p === "peer-heavy").length, 3);
  assert.equal(picks.filter((p) => p === "peer-light").length, 1);

  // 10. Megiddo & Modha Self-Tuning ARC Cache (Module 70)
  const arc = new AdaptiveReplacementCacheArc<string>(3);
  arc.put("k1", "v1");
  arc.put("k2", "v2");
  arc.put("k3", "v3");
  // Access k1 twice so it moves to frequent list T2
  assert.equal(arc.get("k1"), "v1");
  // Insert k4 -> evicts k2 from T1 into ghost B1, keeping k1 in T2
  arc.put("k4", "v4");
  assert.equal(arc.get("k1"), "v1");
  assert.equal(arc.get("k2"), undefined);
  // Re-insert k2 (hit in ghost B1) -> increases targetT1SizeP
  arc.put("k2", "v2-restored");
  assert.ok(arc.getStats().targetT1SizeP >= 1);

  // 11. Consistent Hashing Ring with Bounded Load (1 + epsilon) (Module 71)
  const ring = new ConsistentHashBoundedLoadRing({
    virtualNodesPerShard: 16,
    loadFactorEpsilon: 0.25,
    initialNodes: ["shard-1", "shard-2", "shard-3"]
  });
  for (let i = 0; i < 12; i++) {
    ring.assignKeyWithBoundedLoad(`tenant-key-${i}`);
  }
  const dist = ring.getLoadDistribution();
  // Average load = 12 / 3 = 4; with epsilon = 0.25, max load per node <= ceil(1.25 * 4) = 5
  for (const load of Object.values(dist)) {
    assert.ok(load <= 5);
  }

  // 12. DPLL / CDCL Boolean Satisfiability (SAT) Solver (Module 72)
  // (A OR B) AND (NOT A OR C) AND (NOT B OR C) AND (NOT C) -> UNSAT!
  const unsatRes = DpllCdclSatSolver.solveCnf([
    [{ variable: "A", negated: false }, { variable: "B", negated: false }],
    [{ variable: "A", negated: true }, { variable: "C", negated: false }],
    [{ variable: "B", negated: true }, { variable: "C", negated: false }],
    [{ variable: "C", negated: true }]
  ]);
  assert.equal(unsatRes.satisfiable, false);

  const satRes = DpllCdclSatSolver.solveCnf([
    [{ variable: "A", negated: false }, { variable: "B", negated: false }],
    [{ variable: "A", negated: true }, { variable: "C", negated: false }],
    [{ variable: "C", negated: false }]
  ]);
  assert.equal(satRes.satisfiable, true);
  assert.equal(satRes.assignment?.["C"], true);

  // 13. Event Sourcing & CQRS Materialized Projector with Snapshots (Module 73)
  const projector = new EventSourcingCqrsProjector<{ balance: number; txCount: number }>({
    sqlite: db,
    initialStateFn: () => ({ balance: 0, txCount: 0 }),
    reducerFn: (state, ev) => {
      const delta = Number(ev.payload.amount ?? 0);
      return {
        balance: ev.eventType === "CREDIT" ? state.balance + delta : state.balance - delta,
        txCount: state.txCount + 1
      };
    },
    snapshotInterval: 2
  });
  projector.appendEvent({
    aggregateId: "wallet-1",
    expectedVersion: 0,
    eventType: "CREDIT",
    payload: { amount: 100 }
  });
  projector.appendEvent({
    aggregateId: "wallet-1",
    expectedVersion: 1,
    eventType: "DEBIT",
    payload: { amount: 30 }
  }); // v2 triggers automatic snapshot!
  projector.appendEvent({
    aggregateId: "wallet-1",
    expectedVersion: 2,
    eventType: "CREDIT",
    payload: { amount: 50 }
  });

  const latestProj = projector.projectState("wallet-1");
  assert.equal(latestProj.version, 3);
  assert.equal(latestProj.restoredFromSnapshotVersion, 2);
  assert.equal(latestProj.eventsReplayedCount, 1);
  assert.deepEqual(latestProj.state, { balance: 120, txCount: 3 });

  const historicalV1 = projector.projectState("wallet-1", { upToVersion: 1 });
  assert.deepEqual(historicalV1.state, { balance: 100, txCount: 1 });

  // 14. Discrete Haar Wavelet Multi-Resolution Analyzer & Denoiser (Module 74)
  const noisySignal = [10, 10.1, 9.9, 10.0, 50.0, 50.2, 49.8, 50.0];
  const waveletRes = HaarWaveletMultiResolutionAnalyzer.analyzeAndDenoise(noisySignal, {
    customThresholdLambda: 0.5
  });
  assert.equal(waveletRes.paddedLength, 8);
  assert.equal(waveletRes.denoisedSignal.length, 8);
  assert.ok(Math.abs(waveletRes.denoisedSignal[0]! - 10) < 0.5);
  assert.ok(Math.abs(waveletRes.denoisedSignal[4]! - 50) < 0.5);
});
