import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

import { ShamirLagrangeSecretSharingEngine } from "../../../packages/core/src/shamir-lagrange-secret-sharing.ts";
import { OrderedTreeEditDistanceDiffer } from "../../../packages/core/src/wagner-fischer-zhang-shasha-tree-diff.ts";
import { MerklePatriciaStateTrieStore } from "../../../packages/db/src/merkle-patricia-state-trie-store.ts";
import { MetricTspChristofidesTwoOptRouter } from "../../../packages/core/src/christofides-two-opt-tsp-router.ts";
import { SpragueGrundyNimberGameEngine } from "../../../packages/core/src/sprague-grundy-impartial-game-solver.ts";
import { BirkhoffVonNeumannDecompositionEngine } from "../../../packages/core/src/birkhoff-von-neumann-bistochastic-decomposer.ts";
import { CountSketchAndAmsMomentEstimator } from "../../../packages/core/src/charikar-count-sketch-ams-moments.ts";
import { GeneralizedSuffixTreeIndex } from "../../../packages/core/src/ukkonen-online-suffix-tree.ts";
import { CapacitatedManyToManyBMatchingEngine } from "../../../packages/core/src/capacitated-b-matching-assigner.ts";
import { LamportBakeryTicketArbitrator } from "../../../packages/core/src/lamport-bakery-mutex-fairness-verifier.ts";
import { FractionalCascadingCatalogIndex } from "../../../packages/core/src/fractional-cascading-multi-catalog-search.ts";
import { CatmullRomAndCubicBezierSplinePlanner } from "../../../packages/core/src/cubic-bezier-catmull-rom-trajectory-planner.ts";
import { TransactionalIdempotencyKeyLedger } from "../../../packages/db/src/outbox-idempotency-dedup-ledger.ts";
import { JohnsonReweightedSparseAllPairsRouter } from "../../../packages/core/src/johnsons-all-pairs-reweighted-shortest-path.ts";

test("Phase 18: Shamir Secret Sharing, Merkle-Patricia State Trie, Christofides-2Opt TSP, Birkhoff-von Neumann, Sprague-Grundy, Fractional Cascading & Johnson APSP Frontier (Modules 173-186)", () => {
  // 1. Shamir (k, n) Threshold Secret Sharing over GF(2^61 - 1) & Proactive Share Refresh (Module 173)
  const masterSecret = 987654321012345678n;
  const split = ShamirLagrangeSecretSharingEngine.splitSecret(masterSecret, 3, 5);
  assert.equal(split.shares.length, 5);
  const rec1 = ShamirLagrangeSecretSharingEngine.reconstructSecret([
    split.shares[0]!,
    split.shares[2]!,
    split.shares[4]!
  ]);
  assert.equal(rec1, masterSecret);

  const refreshed = ShamirLagrangeSecretSharingEngine.refreshSharesProactively(
    split.shares,
    3,
    "epoch-2026-11"
  );
  assert.notEqual(refreshed[0]!.shareValueY, split.shares[0]!.shareValueY);
  const recAfterRefresh = ShamirLagrangeSecretSharingEngine.reconstructSecret([
    refreshed[1]!,
    refreshed[2]!,
    refreshed[3]!
  ]);
  assert.equal(recAfterRefresh, masterSecret);

  // 2. Ordered AST Tree Edit Distance Differ (Module 174)
  const treeA = {
    label: "Call",
    children: [{ label: "fn_old" }, { label: "Arg1" }]
  };
  const treeB = {
    label: "Call",
    children: [{ label: "fn_new" }, { label: "Arg1" }, { label: "Arg2" }]
  };
  const treeDiff = OrderedTreeEditDistanceDiffer.computeTreeDiff(treeA, treeB);
  // 1 relabel (fn_old -> fn_new) + 1 insert (Arg2) = distance 2
  assert.equal(treeDiff.editDistance, 2);

  // 3. Cryptographic Hexary Merkle-Patricia State Trie Store (Module 175)
  const db = new DatabaseSync(":memory:");
  const mpt = new MerklePatriciaStateTrieStore(db);
  mpt.put("acct:alice", "1000");
  const rootBefore = mpt.put("acct:bob", "2500");
  const proofAlice = mpt.generateProof("acct:alice");
  assert.equal(proofAlice.rootHash, rootBefore);
  assert.equal(proofAlice.value, "1000");
  assert.equal(MerklePatriciaStateTrieStore.verifyProof(proofAlice), true);

  // 4. Metric TSP Christofides + 2-Opt Local Search Router (Module 176)
  // 4 corners of a 10x10 square: perimeter is 40
  const tsp = MetricTspChristofidesTwoOptRouter.solveMetricTsp([
    { id: "p0", x: 0, y: 0 },
    { id: "p1", x: 10, y: 10 },
    { id: "p2", x: 10, y: 0 },
    { id: "p3", x: 0, y: 10 }
  ]);
  assert.equal(tsp.orderedStopIds.length, 4);
  assert.equal(tsp.optimizedTwoOptCost, 40);

  // 5. Sprague-Grundy Impartial Game Nimber & Bouton XOR Disjunctive Sum (Module 177)
  const game = {
    transitions: {
      S0: [],
      S1: ["S0"],
      S2: ["S0", "S1"],
      S3: ["S0", "S1", "S2"]
    }
  };
  const sg = SpragueGrundyNimberGameEngine.analyzeCompositeDisjunctiveGame(game, ["S3", "S1"]);
  // G(S3)=3, G(S1)=1 => 3 ^ 1 = 2 != 0 (First player wins by moving S3 -> S1 so 1 ^ 1 = 0!)
  assert.equal(sg.compositeXorNimSum, 2);
  assert.equal(sg.firstPlayerHasWinningStrategy, true);
  assert.deepEqual(sg.winningMove, { componentIndex: 0, fromState: "S3", toState: "S1" });

  // 6. Birkhoff-von Neumann Doubly Stochastic Permutation Decomposition (Module 178)
  const bvn = BirkhoffVonNeumannDecompositionEngine.decomposeDoublyStochastic(
    [
      [0.7, 0.3],
      [0.3, 0.7]
    ],
    { balanceFirst: false }
  );
  assert.equal(bvn.terms.length, 2);
  assert.ok(bvn.maxReconstructionErrorLInf < 1e-5);

  // 7. Charikar Count-Sketch & AMS F2 Second Frequency Moment Estimator (Module 179)
  const cs = new CountSketchAndAmsMomentEstimator(7, 128);
  for (let i = 0; i < 50; i++) cs.update("heavy_key", 1);
  for (let i = 0; i < 10; i++) cs.update("medium_key", 1);
  assert.ok(Math.abs(cs.estimateFrequency("heavy_key") - 50) <= 5);
  // True F2 = 50^2 + 10^2 = 2600
  const f2 = cs.estimateSecondMomentF2();
  assert.ok(f2 >= 2000 && f2 <= 3200);

  // 8. Generalized Suffix Tree Index & Multi-Doc Longest Common Substring (Module 180)
  const gst = new GeneralizedSuffixTreeIndex([
    "alpha_kosmora_kernel_omega",
    "beta_kosmora_kernel_delta"
  ]);
  assert.deepEqual(gst.searchOffsets("kosmora_kernel"), [5, 6]);
  assert.equal(gst.longestCommonSubstringAcrossDocs(2), "a_kosmora_kernel_");

  // 9. Capacitated Many-to-Many b-Matching Engine (Module 181)
  const bMatch = CapacitatedManyToManyBMatchingEngine.solveMaximumUtilityBMatching(
    [
      { taskId: "t1", requiredReplicasB: 2 },
      { taskId: "t2", requiredReplicasB: 1 }
    ],
    [
      { agentId: "a1", maxCapacityB: 2 },
      { agentId: "a2", maxCapacityB: 2 }
    ],
    [
      { taskId: "t1", agentId: "a1", utilityScore: 10 },
      { taskId: "t1", agentId: "a2", utilityScore: 9 },
      { taskId: "t2", agentId: "a2", utilityScore: 8 }
    ]
  );
  assert.equal(bMatch.assignments.length, 3);
  assert.equal(bMatch.totalUtility, 27);

  // 10. Lamport Bakery Mutual Exclusion Arbitrator & Jain's Fairness Index (Module 182)
  const bakery = new LamportBakeryTicketArbitrator();
  bakery.requestCriticalSectionTicket("node_B");
  bakery.requestCriticalSectionTicket("node_A");
  const drain = bakery.drainCriticalSectionQueue();
  assert.deepEqual(
    drain.criticalSectionOrder.map((e) => e.nodeId),
    ["node_B", "node_A"]
  );
  assert.equal(drain.jainsFairnessIndex, 1);

  // 11. Chazelle & Guibas Fractional Cascading Multi-Catalog Search (Module 183)
  const fc = new FractionalCascadingCatalogIndex([
    [10, 20, 30, 40],
    [5, 15, 25, 35],
    [12, 18, 22, 28]
  ]);
  const fcRes = fc.queryLowerBounds(16);
  assert.deepEqual(
    fcRes.lowerBoundPerCatalog.map((r) => r.foundKey),
    [20, 25, 18]
  );

  // 12. De Casteljau Cubic Bézier & Catmull-Rom Trajectory Planner (Module 184)
  const bezier = CatmullRomAndCubicBezierSplinePlanner.sampleCubicBezierTrajectory(
    { x: 0, y: 0 },
    { x: 3, y: 0 },
    { x: 6, y: 0 },
    { x: 9, y: 0 },
    10
  );
  assert.equal(bezier.totalArcLength, 9);
  assert.equal(bezier.maxCurvatureKappa, 0);
  const crMid = CatmullRomAndCubicBezierSplinePlanner.evaluateCatmullRomSegment(
    { x: 0, y: 0 },
    { x: 1, y: 2 },
    { x: 3, y: 4 },
    { x: 5, y: 6 },
    0
  );
  assert.deepEqual(crMid, { x: 1, y: 2 });

  // 13. Transactional Idempotency-Key Deduplication Ledger (Module 185)
  const idem = new TransactionalIdempotencyKeyLedger(db);
  const firstTry = idem.beginOrReplay("idem-key-1", { amount: 100 });
  assert.equal(firstTry.alreadyResolved, false);
  const inFlightConflict = idem.beginOrReplay("idem-key-1", { amount: 100 });
  assert.equal(inFlightConflict.outcome?.httpStatusCode, 409);

  idem.completeExecution("idem-key-1", { receiptId: "rcpt_42" });
  const replay = idem.beginOrReplay<{ receiptId: string }>("idem-key-1", { amount: 100 });
  assert.equal(replay.outcome?.status, "replayed_cached");
  assert.equal(replay.outcome?.responseBody?.receiptId, "rcpt_42");

  const mismatch = idem.beginOrReplay("idem-key-1", { amount: 999 });
  assert.equal(mismatch.outcome?.httpStatusCode, 422);

  // 14. Donald Johnson's Sparse Reweighted All-Pairs Shortest Paths (Module 186)
  const johnson = JohnsonReweightedSparseAllPairsRouter.computeAllPairsShortestPaths(
    ["A", "B", "C"],
    [
      { from: "A", to: "B", weight: 4 },
      { from: "B", to: "C", weight: -2 },
      { from: "A", to: "C", weight: 5 }
    ]
  );
  assert.equal(johnson.hasNegativeCycle, false);
  assert.equal(johnson.distanceMatrix["A"]!["C"], 2);
});
