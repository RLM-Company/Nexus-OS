import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

import { ElGamalAndChaumPedersenDleqEngine } from "../../../packages/core/src/elgamal-chaum-pedersen-dleq-verifier.ts";
import { SleatorTarjanSelfAdjustingSplayTree } from "../../../packages/core/src/sleator-tarjan-splay-tree-sequence.ts";
import { KdTreeAndSweepLineClosestPairEngine } from "../../../packages/core/src/kd-tree-closest-pair-spatial-index.ts";
import { TruncatedSvdAndPseudoinverseEngine } from "../../../packages/core/src/golub-kahan-truncated-svd-low-rank.ts";
import { SchleimerWinnowingPlagiarismFingerprinter } from "../../../packages/core/src/schleimer-winnowing-document-fingerprint.ts";
import { WaveletTreeRankSelectQuantileIndex } from "../../../packages/core/src/grossi-vitter-wavelet-tree-rank-select.ts";
import { MahalanobisMultivariateAnomalyDetector } from "../../../packages/core/src/mahalanobis-ewma-covariance-detector.ts";
import { ActiveSetQuadraticProgramSolver } from "../../../packages/core/src/active-set-quadratic-programming-kkt.ts";
import { GabowPathBasedSccAndDagCondenser } from "../../../packages/core/src/gabow-path-based-scc-condensation.ts";
import { BoykovVekslerAlphaExpansionOptimizer } from "../../../packages/core/src/alpha-expansion-multilabel-graph-cut.ts";
import { DeBruijnEulerianSequenceAssembler } from "../../../packages/core/src/de-bruijn-eulerian-sequence-assembler.ts";
import { NeumaierAndPairwiseCompensatedArithmetic } from "../../../packages/core/src/kahan-babuska-neumaier-compensated-sum.ts";
import { ChandyLamportDagBarrierCheckpointStore } from "../../../packages/db/src/dag-workflow-checkpoint-barrier-store.ts";
import { DistributedBarrierAndTokenRingStore } from "../../../packages/db/src/token-ring-quorum-barrier-coordinator.ts";

test("Phase 22: ElGamal Multiplicative Homomorphic & Chaum-Pedersen DLEQ, Sleator-Tarjan Splay Tree, k-d Tree + Sweep-Line Closest Pair, Truncated SVD, Winnowing, Wavelet Tree, Mahalanobis, KKT QP, Gabow SCC, Alpha-Expansion, de Bruijn, Neumaier Sum, DAG Barrier & Token-Ring Frontier (Modules 237-250)", () => {
  // 1. ElGamal Multiplicative Homomorphic Encryption & Chaum-Pedersen DLEQ Proof (Module 237)
  const sk = 123456789n;
  const pk = ElGamalAndChaumPedersenDleqEngine.derivePublicKey(sk);
  const ctA = ElGamalAndChaumPedersenDleqEngine.encrypt(pk, 250n, 1111n);
  const ctB = ElGamalAndChaumPedersenDleqEngine.encrypt(pk, 40n, 2222n);
  const ctProd = ElGamalAndChaumPedersenDleqEngine.homomorphicMultiplyCiphertexts(ctA, ctB);
  assert.equal(ElGamalAndChaumPedersenDleqEngine.decrypt(sk, ctProd), 10000n);

  const dleq = ElGamalAndChaumPedersenDleqEngine.createChaumPedersenDleqProof(sk, 777777n);
  assert.equal(ElGamalAndChaumPedersenDleqEngine.verifyChaumPedersenDleqProof(dleq), true);

  // 2. Sleator & Tarjan Self-Adjusting Splay Tree (Module 238)
  const splay = new SleatorTarjanSelfAdjustingSplayTree();
  splay.upsert(10, 100);
  splay.upsert(20, 200);
  splay.upsert(30, 300);
  assert.equal(splay.getAndSplayToRoot(20), 200);
  assert.equal(splay.getRootKey(), 20);
  assert.equal(splay.queryRangeSum(10, 25), 300);

  // 3. Bentley 2D k-d Tree Nearest Neighbor & Shamos-Hoey Sweep-Line Closest Pair (Module 239)
  const pts = [
    { id: "p1", x: 0, y: 0 },
    { id: "p2", x: 10, y: 10 },
    { id: "p3", x: 3, y: 4 },
    { id: "p4", x: 3.3, y: 4.4 } // dist(p3, p4) = hypot(0.3, 0.4) = 0.5
  ];
  const kdtree = new KdTreeAndSweepLineClosestPairEngine(pts);
  const nn = kdtree.findNearestNeighbor({ x: 2.9, y: 3.9 });
  assert.equal(nn.nearestPoint?.id, "p3");
  const closest = KdTreeAndSweepLineClosestPairEngine.findClosestPairSweepLine(pts);
  assert.equal(closest.minDistance, 0.5);

  // 4. Truncated SVD & Moore-Penrose Pseudoinverse (Module 240)
  const svd = TruncatedSvdAndPseudoinverseEngine.computeTruncatedSvd([
    [3, 0],
    [0, 2]
  ]);
  assert.deepEqual(svd.singularValues, [3, 2]);
  assert.ok(Math.abs(svd.moorePenrosePseudoinverse[0]![0]! - 1 / 3) < 1e-4);
  assert.ok(Math.abs(svd.moorePenrosePseudoinverse[1]![1]! - 1 / 2) < 1e-4);

  // 5. Schleimer Winnowing Plagiarism & Local Document Fingerprinter (Module 241)
  const winnow = SchleimerWinnowingPlagiarismFingerprinter.computeContainmentOverlap(
    "Kosmora autonomous kernel executes formal verification checks",
    "The Kosmora autonomous kernel executes formal verification checks deterministically"
  );
  assert.equal(winnow.containmentInA, 1);

  // 6. Grossi-Vitter Wavelet Tree O(log sigma) Rank & Range Quantile Index (Module 242)
  const wt = new WaveletTreeRankSelectQuantileIndex([7, 2, 9, 2, 5, 8, 2]);
  assert.equal(wt.rank(2, 7), 3);
  // In subarray [1..5] = [2, 9, 2, 5, 8], sorted is [2, 2, 5, 8, 9] => median (k=2) is 5!
  assert.equal(wt.rangeQuantileKthSmallest(1, 5, 2), 5);

  // 7. Mahalanobis Multivariate Covariance & Precision Matrix Anomaly Detector (Module 243)
  const maha = new MahalanobisMultivariateAnomalyDetector([
    [10, 20],
    [11, 21],
    [9, 19],
    [10, 21],
    [10, 19]
  ]);
  assert.equal(maha.evaluateSample([10, 20]).isAnomalyAtChiSquareThreshold, false);
  assert.equal(maha.evaluateSample([50, 80]).isAnomalyAtChiSquareThreshold, true);

  // 8. Karush-Kuhn-Tucker (KKT) Equality-Constrained Quadratic Program Solver (Module 244)
  // Minimize 0.5 * (x1^2 + x2^2) subject to x1 + x2 = 4 => x1 = 2, x2 = 2, min obj = 4
  const qp = ActiveSetQuadraticProgramSolver.solveEqualityConstrainedQp({
    hessianQ: [
      [1, 0],
      [0, 1]
    ],
    linearCostC: [0, 0],
    equalityMatrixA: [[1, 1]],
    equalityRhsB: [4]
  });
  assert.deepEqual(qp.primalSolutionX, [2, 2]);
  assert.equal(qp.optimalObjectiveValue, 4);

  // 9. Gabow Path-Based Strongly Connected Components & Condensation DAG (Module 245)
  const gabow = GabowPathBasedSccAndDagCondenser.computeSccAndCondensationDag(
    ["A", "B", "C"],
    [
      { from: "A", to: "B" },
      { from: "B", to: "A" },
      { from: "B", to: "C" }
    ]
  );
  assert.equal(gabow.stronglyConnectedComponents.length, 2);
  assert.equal(gabow.condensationDagEdges.length, 1);

  // 10. Boykov-Veksler Alpha-Expansion Multi-Label MRF Optimizer (Module 246)
  const alphaExp = BoykovVekslerAlphaExpansionOptimizer.optimizeMultiLabelPottsMrf({
    nodes: ["n1", "n2", "n3"],
    numLabelsL: 3,
    unaryCostByNodeAndLabel: {
      n1: [10, 10, 0], // prefers label 2
      n2: [1, 10, 3], // slightly prefers 0, but neighbors n1 & n3 strongly prefer 2
      n3: [10, 10, 0] // prefers label 2
    },
    edges: [
      { u: "n1", v: "n2", pottsPenaltyLambda: 5 },
      { u: "n2", v: "n3", pottsPenaltyLambda: 5 }
    ]
  });
  assert.deepEqual(alphaExp.optimalLabelsByNode, { n1: 2, n2: 2, n3: 2 });
  assert.equal(alphaExp.finalEnergy, 3);

  // 11. de Bruijn Cyclic Sequence B(2, 3) & Eulerian k-mer Assembler (Module 247)
  const dbSeq = DeBruijnEulerianSequenceAssembler.generateDeBruijnSequence("01", 3);
  assert.equal(dbSeq.length, 8);
  const assembled = DeBruijnEulerianSequenceAssembler.assembleKmersEulerian([
    "KOS",
    "OSM",
    "SMO",
    "MOR",
    "ORA"
  ]);
  assert.equal(assembled, "KOSMORA");

  // 12. Neumaier Improved Kahan-Babuska Compensated Summation (Module 248)
  // Standard IEEE-754 loses the two 1.0 terms in [1, 1e100, 1, -1e100] -> 0, while Neumaier recovers 2!
  const neu = NeumaierAndPairwiseCompensatedArithmetic.neumaierSum([1, 1e100, 1, -1e100]);
  assert.equal(neu.compensatedSum, 2);

  // 13. Chandy-Lamport / Flink DAG Checkpoint Barrier Alignment Store (Module 249)
  const db = new DatabaseSync(":memory:");
  const abs = new ChandyLamportDagBarrierCheckpointStore(db);
  const b1 = abs.recordBarrierArrival({
    operatorId: "op_join",
    epochId: 7,
    channelId: "ch_left",
    requiredChannels: ["ch_left", "ch_right"],
    operatorStateSnapshot: { watermark: 1000 }
  });
  assert.equal(b1.checkpointCommitted, false);
  const b2 = abs.recordBarrierArrival({
    operatorId: "op_join",
    epochId: 7,
    channelId: "ch_right",
    requiredChannels: ["ch_left", "ch_right"],
    operatorStateSnapshot: { watermark: 1000 }
  });
  assert.equal(b2.checkpointCommitted, true);

  // 14. Distributed Sense-Reversing Barrier & Token-Ring Coordinator (Module 250)
  const ring = new DistributedBarrierAndTokenRingStore(db);
  const r0 = ring.initRing("ring_alpha", ["node_1", "node_2", "node_3"]);
  assert.equal(r0.currentHolderNodeId, "node_1");
  const r1 = ring.passTokenToNext("ring_alpha");
  assert.equal(r1.currentHolderNodeId, "node_2");
  assert.equal(r1.epochSequence, 2);

  assert.equal(ring.arriveAtBarrier("bar_1", 1, "w1", 2).barrierReleased, false);
  assert.equal(ring.arriveAtBarrier("bar_1", 1, "w2", 2).barrierReleased, true);
});
