import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

import { ReedSolomonGaloisErasureCoder } from "../../../packages/core/src/reed-solomon-erasure-coder.ts";
import { PbftByzantineQuorumEngine } from "../../../packages/core/src/pbft-byzantine-quorum-verifier.ts";
import { BPlusTreeMvccIndexEngine } from "../../../packages/db/src/bplus-tree-mvcc-index.ts";
import { IsolationForestAnomalyDetector } from "../../../packages/core/src/isolation-forest-anomaly-detector.ts";
import { LubyTransformFountainCodec } from "../../../packages/core/src/raptorq-fountain-luby-transform.ts";
import { DinicMaxFlowMinCutEngine } from "../../../packages/core/src/dinic-max-flow-min-cut.ts";
import { TarjanSccAndTwoSatEngine } from "../../../packages/core/src/tarjan-scc-and-2sat-solver.ts";
import { GaussianProcessBayesianOptimizer } from "../../../packages/core/src/thompson-contextual-gaussian-process.ts";
import { HierarchicalTokenBucketShaper } from "../../../packages/core/src/token-bucket-hierarchical-htb-shaper.ts";
import { SmithWatermanLocalAligner } from "../../../packages/core/src/smith-waterman-local-aligner.ts";
import { SavitzkyGolayAndRtsSmoother } from "../../../packages/core/src/savitzky-golay-kalman-smoother.ts";
import { XorFilterStaticMembershipIndex } from "../../../packages/core/src/bloom-cuckoo-xor-filter.ts";
import { FencingTokenLeaseManager } from "../../../packages/db/src/distributed-lock-fencing-lease-manager.ts";
import { RegexNfaToMinDfaCompiler } from "../../../packages/core/src/hopcroft-dfa-minimizer.ts";

test("Phase 12: Reed-Solomon Erasure Coding, PBFT Byzantine Quorum, B+Tree MVCC, Isolation Forest & Automata Frontier (Modules 77-90)", () => {
  // 1. Reed-Solomon GF(2^8) Erasure Coder (Module 77)
  const rs = new ReedSolomonGaloisErasureCoder(4, 2);
  const originalText = "Kosmora GF(2^8) Reed-Solomon Erasure Resilient Payload Verification!";
  const originalBytes = new TextEncoder().encode(originalText);
  const encoded = rs.encodePayload(originalBytes);
  assert.equal(encoded.shards.length, 6);

  // Erase data shard #0 and data shard #2 (lose 2 shards out of 6)
  const damagedShards: Array<Uint8Array | null> = [
    null,
    encoded.shards[1]!,
    null,
    encoded.shards[3]!,
    encoded.shards[4]!,
    encoded.shards[5]!
  ];
  const recoveredBytes = rs.reconstructPayload(damagedShards, encoded.originalByteLength);
  const recoveredText = new TextDecoder().decode(recoveredBytes);
  assert.equal(recoveredText, originalText);

  // 2. PBFT Practical Byzantine Fault Tolerance Quorum Engine (Module 78)
  const pbft = new PbftByzantineQuorumEngine(4); // f = 1, quorum = 2f + 1 = 3
  const cmdPayload = "EXECUTE_CRITICAL_DEPLOYMENT_V12";
  const digest = PbftByzantineQuorumEngine.computeDigest(cmdPayload);

  pbft.ingestMessage({
    type: "PRE-PREPARE",
    viewNumber: 1,
    sequenceNumber: 10,
    digest,
    replicaId: "replica-0",
    payload: cmdPayload
  });
  pbft.ingestMessage({
    type: "PREPARE",
    viewNumber: 1,
    sequenceNumber: 10,
    digest,
    replicaId: "replica-1"
  });
  const prepStatus = pbft.ingestMessage({
    type: "PREPARE",
    viewNumber: 1,
    sequenceNumber: 10,
    digest,
    replicaId: "replica-2"
  });
  assert.equal(prepStatus.prepareQuorumReached, true);

  pbft.ingestMessage({ type: "COMMIT", viewNumber: 1, sequenceNumber: 10, digest, replicaId: "replica-0" });
  pbft.ingestMessage({ type: "COMMIT", viewNumber: 1, sequenceNumber: 10, digest, replicaId: "replica-1" });
  const commitStatus = pbft.ingestMessage({
    type: "COMMIT",
    viewNumber: 1,
    sequenceNumber: 10,
    digest,
    replicaId: "replica-2"
  });
  assert.equal(commitStatus.phase, "COMMITTED");
  assert.equal(pbft.committedCommands.length, 1);

  // 3. B+Tree Multi-Version Concurrency Control (MVCC) Snapshot Index (Module 79)
  const db = new DatabaseSync(":memory:");
  const mvcc = new BPlusTreeMvccIndexEngine<{ status: string }>(db, "tasks_idx");
  const tx1 = mvcc.beginTransaction(); // tx 1
  mvcc.upsertKey(tx1, "task:01", { status: "pending" });
  mvcc.upsertKey(tx1, "task:02", { status: "running" });

  const tx2 = mvcc.beginTransaction(); // tx 2 updates task:01 to completed
  mvcc.upsertKey(tx2, "task:01", { status: "completed" });

  // Reader at snapshot tx1 still sees "pending"!
  const snap1 = mvcc.scanRangeAtSnapshot({ startKey: "task:00", endKey: "task:99", snapshotTxId: tx1 });
  assert.equal(snap1.find((r) => r.key === "task:01")?.value.status, "pending");

  // Reader at snapshot tx2 sees "completed"
  const snap2 = mvcc.scanRangeAtSnapshot({ startKey: "task:00", endKey: "task:99", snapshotTxId: tx2 });
  assert.equal(snap2.find((r) => r.key === "task:01")?.value.status, "completed");

  const vacuumed = mvcc.vacuumObsoleteVersions(tx2);
  assert.equal(vacuumed, 1);

  // 4. Isolation Forest Unsupervised Anomaly Detector (Module 80)
  const iforest = new IsolationForestAnomalyDetector({ numTrees: 30, seed: 42 });
  const normalCluster: number[][] = [];
  for (let i = 0; i < 40; i++) {
    normalCluster.push([10 + (i % 3) * 0.2, 20 + (i % 4) * 0.2]);
  }
  normalCluster.push([500, 500]); // Extreme outlier
  iforest.fit(normalCluster);
  const normalScore = iforest.scorePoint([10.2, 20.2]);
  const outlierScore = iforest.scorePoint([500, 500]);
  assert.ok(outlierScore.anomalyScore > normalScore.anomalyScore);
  assert.equal(outlierScore.isAnomaly, true);

  // 5. Luby Transform (LT) Rateless Fountain Codec with Peeling Decoder (Module 81)
  const blocks = [
    new Uint8Array([1, 2, 3, 4]),
    new Uint8Array([5, 6, 7, 8]),
    new Uint8Array([9, 10, 11, 12])
  ];
  const bundle = LubyTransformFountainCodec.encodeDroplets(blocks, [
    { dropletId: 1, sourceBlockIndices: [0] }, // Degree 1 (ripple)
    { dropletId: 2, sourceBlockIndices: [0, 1] }, // Peels to [1] once 0 is solved
    { dropletId: 3, sourceBlockIndices: [1, 2] } // Peels to [2] once 1 is solved
  ]);
  const peeled = LubyTransformFountainCodec.peelDecode(bundle);
  assert.equal(peeled.decodedAll, true);
  assert.deepEqual(Array.from(peeled.recoveredBlocks[2]!), [9, 10, 11, 12]);

  // 6. Dinic's Maximum Network Flow & Minimum Cut Solver (Module 82)
  const dinic = new DinicMaxFlowMinCutEngine();
  dinic.addDirectedEdge("source", "ingest", 10);
  dinic.addDirectedEdge("source", "parse", 10);
  dinic.addDirectedEdge("ingest", "verify", 4);
  dinic.addDirectedEdge("parse", "verify", 3);
  dinic.addDirectedEdge("verify", "sink", 20);
  const flowRes = dinic.computeMaxFlowAndMinCut("source", "sink");
  assert.equal(flowRes.maxFlowValue, 7);
  assert.equal(flowRes.minCutBottleneckEdges.length, 2);

  // 7. Tarjan Strongly Connected Components & Linear-Time 2-SAT Solver (Module 83)
  // (x OR y) AND (~x OR y) AND (x OR ~z) -> y must be true!
  const twoSat = TarjanSccAndTwoSatEngine.solveTwoSat([
    { first: { variable: "x", negated: false }, second: { variable: "y", negated: false } },
    { first: { variable: "x", negated: true }, second: { variable: "y", negated: false } },
    { first: { variable: "x", negated: false }, second: { variable: "z", negated: true } }
  ]);
  assert.equal(twoSat.satisfiable, true);
  assert.equal(twoSat.assignment?.["y"], true);

  // 8. Gaussian Process Regression & Bayesian Optimization (Module 84)
  const gp = new GaussianProcessBayesianOptimizer({ lengthScaleL: 1.0, betaUcb: 1.96 });
  gp.recordObservation([0.0], 0.1);
  gp.recordObservation([1.0], 0.95);
  gp.recordObservation([2.0], 0.2);
  const preds = gp.evaluateCandidates([[1.02], [0.05], [5.0]]);
  const nearPeak = preds.find((p) => p.candidatePoint[0] === 1.02)!;
  assert.ok(nearPeak.mean > 0.85);

  // 9. Hierarchical Token Bucket (HTB) Shaper with Parent Borrowing (Module 85)
  const htb = new HierarchicalTokenBucketShaper({
    parentRefillPerSec: 100,
    parentMaxBurst: 100,
    initialTimestampMs: 0
  });
  htb.registerClass({
    classId: "realtime-voice",
    assuredRateTokensPerSec: 20,
    ceilRateTokensPerSec: 80,
    burstCapacity: 30,
    priority: 0
  });
  // Request 45 tokens: consumes 30 from assured and borrows 15 from parent!
  const charge = htb.requestTokens("realtime-voice", 45, 0);
  assert.equal(charge.allowed, true);
  assert.equal(charge.consumedFromAssured, 30);
  assert.equal(charge.borrowedFromParent, 15);

  // 10. Smith-Waterman Local Sequence Alignment (Module 86)
  const aligned = SmithWatermanLocalAligner.alignStrings(
    "noise_prefix_SELECT_FROM_USERS_WHERE_ID_noise_suffix",
    "other_SELECT_FROM_USERS_WHERE_ID_tail"
  );
  assert.equal(aligned.alignedSubsequenceA, "_SELECT_FROM_USERS_WHERE_ID_");

  // 11. Savitzky-Golay Polynomial Filter & Rauch-Tung-Striebel Kalman Smoother (Module 87)
  const smoothed = SavitzkyGolayAndRtsSmoother.smoothAndDifferentiate([10, 20, 30, 40, 50]);
  assert.equal(smoothed.savitzkyGolaySmoothed.length, 5);
  assert.ok(Math.abs(smoothed.firstDerivativeVelocity[2]! - 10) < 0.01);

  // 12. Graf & Lemire 16-Bit Xor Filter Static Membership Index (Module 88)
  const memberKeys = Array.from({ length: 40 }, (_, i) => `revoked-jwt-${i}`);
  const xorFilter = new XorFilterStaticMembershipIndex(memberKeys);
  for (const k of memberKeys) {
    assert.equal(xorFilter.mightContain(k), true); // Zero false negatives!
  }

  // 13. Distributed Lock Manager with Monotonic Fencing Tokens (Module 89)
  const leaseMgr = new FencingTokenLeaseManager(db);
  const lease1 = leaseMgr.acquireOrRenewLease({
    resourceKey: "shard-leader-lock",
    holderId: "worker-old",
    ttlMs: 500,
    nowMs: 1000
  });
  assert.equal(lease1.granted, true);
  // Lease expires at 1500ms; worker-new acquires at 1600ms with higher fencing token
  const lease2 = leaseMgr.acquireOrRenewLease({
    resourceKey: "shard-leader-lock",
    holderId: "worker-new",
    ttlMs: 500,
    nowMs: 1600
  });
  assert.equal(lease2.granted, true);
  assert.ok(lease2.fencingToken > lease1.fencingToken);
  leaseMgr.verifyFencedWrite("shard-leader-lock", lease2.fencingToken);
  assert.throws(() => {
    leaseMgr.verifyFencedWrite("shard-leader-lock", lease1.fencingToken);
  }, /STALE_FENCING_TOKEN_REJECTED/);

  // 14. Hopcroft Partition-Refinement DFA Minimizer (Module 90)
  // s1 and s2 have identical transitions on a,b and neither is accept -> Hopcroft merges them!
  const minDfaRes = RegexNfaToMinDfaCompiler.minimizeDfa({
    states: ["s0", "s1", "s2", "s3"],
    alphabet: ["a", "b"],
    startState: "s0",
    acceptStates: ["s3"],
    transitions: {
      s0: { a: "s1", b: "s2" },
      s1: { a: "s3", b: "s3" },
      s2: { a: "s3", b: "s3" },
      s3: { a: "s3", b: "s3" }
    }
  });
  assert.equal(minDfaRes.originalStateCount, 4);
  assert.equal(minDfaRes.minimizedStateCount, 3);
  assert.equal(RegexNfaToMinDfaCompiler.executeLinearDfa(minDfaRes.minimizedDfa, ["a", "b"]), true);
});
