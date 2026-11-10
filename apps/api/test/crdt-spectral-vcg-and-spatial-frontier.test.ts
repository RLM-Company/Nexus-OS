import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

import { RgaSequenceTextCrdt } from "../../../packages/core/src/rga-woot-sequence-crdt.ts";
import { ProbabilisticSkipListIndex } from "../../../packages/core/src/skip-list-concurrent-index.ts";
import { SpectralFiedlerGraphPartitioner } from "../../../packages/core/src/spectral-fiedler-graph-partitioner.ts";
import { ChandyLamportSnapshotCoordinator } from "../../../packages/core/src/chandy-lamport-distributed-snapshot.ts";
import { NelderMeadSimplexOptimizer } from "../../../packages/core/src/nelder-mead-simplex-optimizer.ts";
import { PidAntiWindupController } from "../../../packages/core/src/pid-autoscaler-controller.ts";
import { BurrowsWheelerTransformCodec } from "../../../packages/core/src/burrows-wheeler-fm-index.ts";
import { DamerauLevenshteinFuzzyAutomaton } from "../../../packages/core/src/wagner-fischer-damerau-levenshtein.ts";
import { VcgTruthfulMechanismAuction } from "../../../packages/core/src/vickrey-clarke-groves-mechanism.ts";
import { WelfordHigherOrderMomentsTracker } from "../../../packages/core/src/kahan-compensated-online-moments.ts";
import { TamperEvidentAuditLedger } from "../../../packages/db/src/merkle-bplus-audit-ledger.ts";
import { SpatialRTreeBoundingBoxIndex } from "../../../packages/db/src/spatial-rtree-bounding-index.ts";
import { DeterministicBinaryWireCodec } from "../../../packages/core/src/cbor-varint-wire-codec.ts";
import { KmpAndRabinKarpChunker } from "../../../packages/core/src/knuth-morris-pratt-rabin-karp.ts";

test("Phase 13: RGA Sequence CRDT, SkipList, Spectral Fiedler Partitioning, Chandy-Lamport, VCG Auction & Spatial R-Tree Frontier (Modules 93-106)", () => {
  // 1. RGA Sequence CRDT Commutative Convergence (Module 93)
  const docA = new RgaSequenceTextCrdt("replica-A");
  const docB = new RgaSequenceTextCrdt("replica-B");

  const op1 = docA.localInsertAtVisibleIndex(0, "K");
  const op2 = docA.localInsertAtVisibleIndex(1, "O");
  docB.applyInsert(op1);
  docB.applyInsert(op2);

  // Concurrent insertions after "O": replica-A inserts "S", replica-B inserts "M"
  const opA = docA.localInsertAtVisibleIndex(2, "S");
  const opB = docB.localInsertAtVisibleIndex(2, "M");

  // Apply in opposite orders on replica-A and replica-B
  docA.applyInsert(opB);
  docB.applyInsert(opA);
  assert.equal(docA.toString(), docB.toString());
  assert.equal(docA.toString().length, 4);

  // 2. Probabilistic Skip List Ordered Index (Module 94)
  const skip = new ProbabilisticSkipListIndex<number>(10);
  skip.set("k20", 20);
  skip.set("k10", 10);
  skip.set("k40", 40);
  skip.set("k30", 30);
  assert.equal(skip.get("k30"), 30);
  const range = skip.rangeScan("k15", "k35");
  assert.deepEqual(range.map((r) => r.key), ["k20", "k30"]);
  assert.equal(skip.delete("k20"), true);
  assert.equal(skip.get("k20"), undefined);

  // 3. Spectral Graph Partitioner via Laplacian Fiedler Vector (Module 95)
  // Two triangles (a1,a2,a3) and (b1,b2,b3) connected by a single weak bridge (a3-b1)
  const part = SpectralFiedlerGraphPartitioner.partitionGraph({
    nodes: ["a1", "a2", "a3", "b1", "b2", "b3"],
    undirectedEdges: [
      { u: "a1", v: "a2", weight: 5 },
      { u: "a2", v: "a3", weight: 5 },
      { u: "a1", v: "a3", weight: 5 },
      { u: "b1", v: "b2", weight: 5 },
      { u: "b2", v: "b3", weight: 5 },
      { u: "b1", v: "b3", weight: 5 },
      { u: "a3", v: "b1", weight: 0.2 }
    ]
  });
  assert.equal(part.clusterA.length, 3);
  assert.equal(part.clusterB.length, 3);
  assert.equal(part.cutEdgeWeight, 0.2);

  // 4. Chandy-Lamport Distributed Global Snapshot (Module 96)
  const clSnap = new ChandyLamportSnapshotCoordinator<{ balance: number }>(
    "snap-01",
    ["node-1", "node-2"],
    [
      { from: "node-1", to: "node-2" },
      { from: "node-2", to: "node-1" }
    ]
  );
  // Node-1 initiates snapshot with balance=90, having sent "+10" in transit on node-2 -> node-1
  clSnap.initiateSnapshotAtNode("node-1", { balance: 90 });
  // Before marker from node-2 arrives at node-1, in-flight message "+10" arrives from node-2 -> node-1
  clSnap.onApplicationMessageReceived("node-2", "node-1", "TRANSFER_10");
  // Marker from node-1 arrives at node-2 (records node-2 state = 100)
  clSnap.onMarkerReceived("node-1", "node-2", { balance: 100 });
  // Marker from node-2 arrives at node-1 (closes channel node-2 -> node-1)
  clSnap.onMarkerReceived("node-2", "node-1", { balance: 100 });

  const cut = clSnap.getSnapshotCut();
  assert.equal(cut.complete, true);
  assert.deepEqual(cut.inFlightChannelMessages["node-2->node-1"], ["TRANSFER_10"]);

  // 5. Nelder-Mead Downhill Simplex Optimizer (Module 97)
  // Minimize (x - 3)^2 + (y + 2)^2 -> minimum at (3, -2) with value 0
  const nm = NelderMeadSimplexOptimizer.minimize({
    objectiveFn: ([x, y]) => (x! - 3) * (x! - 3) + (y! + 2) * (y! + 2),
    initialGuess: [0, 0],
    maxIterations: 200,
    tolerance: 1e-7
  });
  assert.ok(Math.abs(nm.optimalPoint[0]! - 3) < 0.05);
  assert.ok(Math.abs(nm.optimalPoint[1]! - -2) < 0.05);

  // 6. PID Autoscaler Controller with Anti-Windup (Module 98)
  const pid = new PidAntiWindupController({
    kp: 2.0,
    ki: 0.5,
    kd: 0.1,
    minOutput: 1,
    maxOutput: 20
  });
  const step1 = pid.computeControl(100, 10, 1.0);
  assert.equal(step1.controlOutput, 20);
  assert.equal(step1.saturated, true);

  // 7. Burrows-Wheeler Transform (BWT) + Move-To-Front (MTF) Lossless Codec (Module 99)
  const bwtInput = "BANANA_BANANA_KOSMORA_KERNEL";
  const bwtEncoded = BurrowsWheelerTransformCodec.encodeBwtAndMtf(bwtInput);
  const bwtDecoded = BurrowsWheelerTransformCodec.decodeBwtAndMtf(bwtEncoded);
  assert.equal(bwtDecoded, bwtInput);

  // 8. Damerau-Levenshtein Fuzzy Automaton & BK-Tree (Module 100)
  // "komsroa" has 2 adjacent transpositions from "kosmora" -> distance = 2
  assert.equal(DamerauLevenshteinFuzzyAutomaton.distance("kosmora", "kosmroa"), 1);
  const bk = new DamerauLevenshteinFuzzyAutomaton();
  bk.addWord("kosmora");
  bk.addWord("postgres");
  bk.addWord("sqlite");
  const fuzzyHits = bk.searchWithinDistance("kosmroa", 1);
  assert.equal(fuzzyHits[0]?.word, "kosmora");

  // 9. Vickrey-Clarke-Groves (VCG) Truthful Combinatorial Auction (Module 101)
  // Single item capacity = 1: bidderA values at 100, bidderB values at 75 -> A wins and pays B's bid (75)!
  const vcg = VcgTruthfulMechanismAuction.runTruthfulAuction(
    [
      { bidderId: "agent-A", unitsRequested: 1, valuationValue: 100 },
      { bidderId: "agent-B", unitsRequested: 1, valuationValue: 75 }
    ],
    1
  );
  assert.equal(vcg.totalSocialWelfare, 100);
  assert.equal(vcg.winners[0]?.bidderId, "agent-A");
  assert.equal(vcg.winners[0]?.vcgClarkeTaxPayment, 75);
  assert.equal(vcg.winners[0]?.netUtilitySurplus, 25);

  // 10. Kahan-Babuska Compensated Summation & Welford Higher Moments (Module 102)
  const moments = new WelfordHigherOrderMomentsTracker();
  for (const val of [2, 4, 4, 4, 5, 5, 7, 9]) {
    moments.observe(val);
  }
  const summary = moments.getSummary();
  assert.equal(summary.count, 8);
  assert.equal(summary.kahanCompensatedSum, 40);
  assert.equal(summary.mean, 5);

  // 11. Tamper-Evident Cryptographic Hash-Chained Audit Ledger (Module 103)
  const db = new DatabaseSync(":memory:");
  const ledger = new TamperEvidentAuditLedger(db, "sec_audit");
  ledger.appendAuditEntry({
    actorId: "admin-1",
    actionType: "GRANT_ROLE",
    payload: { target: "u2", role: "engineer" }
  });
  ledger.appendAuditEntry({
    actorId: "u2",
    actionType: "DEPLOY_MODULE",
    payload: { module: "raft" }
  });
  const verifyOk = ledger.verifyLedgerIntegrity();
  assert.equal(verifyOk.valid, true);
  assert.equal(verifyOk.totalEntriesVerified, 2);

  // 12. 2D Spatial R-Tree Minimum Bounding Rectangle Index (Module 104)
  const rtree = new SpatialRTreeBoundingBoxIndex<{ label: string }>(db, "diagram_layer");
  rtree.upsertItem({
    itemId: "node-api",
    bbox: { minX: 10, minY: 10, maxX: 50, maxY: 50 },
    metadata: { label: "API Gateway" }
  });
  rtree.upsertItem({
    itemId: "node-db",
    bbox: { minX: 200, minY: 200, maxX: 260, maxY: 260 },
    metadata: { label: "SQLite Store" }
  });
  const overlapping = rtree.searchIntersectingBox({ minX: 40, minY: 40, maxX: 80, maxY: 80 });
  assert.equal(overlapping.length, 1);
  assert.equal(overlapping[0]?.itemId, "node-api");
  const nearest = rtree.searchNearestNeighbors(195, 195, 1);
  assert.equal(nearest[0]?.itemId, "node-db");

  // 13. LEB128 / ZigZag Varint & Deterministic TLV Binary Wire Codec (Module 105)
  const originalRec = {
    actor: "kernel-supervisor",
    deltaSteps: -42,
    healthy: true,
    seq: 9001
  };
  const wireBytes = DeterministicBinaryWireCodec.encodeRecord(originalRec);
  const decodedRec = DeterministicBinaryWireCodec.decodeRecord(wireBytes);
  assert.deepEqual(decodedRec, originalRec);

  // 14. Knuth-Morris-Pratt (KMP) & Rolling Rabin-Karp Content-Defined Chunking (Module 106)
  const kmpHits = KmpAndRabinKarpChunker.kmpSearchAll(
    "ABABDABACDABABCABAB_ABABCABAB",
    "ABABCABAB"
  );
  assert.deepEqual(kmpHits, [10, 20]);

  const cdcPayload = "Kosmora-Content-Defined-Chunking-Block-".repeat(5);
  const cdcChunks = KmpAndRabinKarpChunker.splitContentDefinedChunks(cdcPayload, {
    minChunkSize: 16,
    maxChunkSize: 48
  });
  assert.ok(cdcChunks.length >= 4);
  assert.equal(cdcChunks.map((c) => c.content).join(""), cdcPayload);
});
