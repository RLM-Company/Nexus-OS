import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

import { PaillierHomomorphicEncryptionEngine } from "../../../packages/core/src/paillier-additive-homomorphic-crypto.ts";
import { YenKShortestLooplessPathsRouter } from "../../../packages/core/src/yens-k-shortest-loopless-paths.ts";
import { HeavyLightDecompositionTreeEngine } from "../../../packages/core/src/heavy-light-decomposition-tree-path.ts";
import { ConvexHullAndRotatingCalipersEngine } from "../../../packages/core/src/monotone-chain-convex-hull-calipers.ts";
import { HouseholderQrLeastSquaresSolver } from "../../../packages/core/src/householder-qr-least-squares-solver.ts";
import { BitapShiftOrApproximateMatcher } from "../../../packages/core/src/bitap-shift-or-fuzzy-matcher.ts";
import { DuvalLyndonFactorizationEngine } from "../../../packages/core/src/duval-lyndon-word-factorization.ts";
import { EfraimidisSpirakisWeightedReservoir } from "../../../packages/core/src/efraimidis-spirakis-weighted-reservoir.ts";
import { VolderCordicVectorRotationEngine } from "../../../packages/core/src/cordic-hyperbolic-trig-evaluator.ts";
import { DulmageMendelsohnCanonicalDecomposer } from "../../../packages/core/src/dulmage-mendelsohn-structural-decomposer.ts";
import { CheegerConductanceAndSweepCutAuditor } from "../../../packages/core/src/cheeger-conductance-expander-auditor.ts";
import { LinearBottleneckAssignmentSolver } from "../../../packages/core/src/bottleneck-minmax-linear-assigner.ts";
import { DecorrelatedJitterDlqRetryStore } from "../../../packages/db/src/exponential-backoff-dlq-retry-store.ts";
import { TimeTravelSnapshotDiffInspector } from "../../../packages/db/src/mvcc-time-travel-snapshot-differ.ts";

test("Phase 21: Paillier Homomorphic Crypto, Yen's K-Shortest Paths, Heavy-Light Decomposition, Convex Hull + Rotating Calipers, Householder QR, Bitap Shift-Or, Duval Lyndon Words, Weighted Reservoir, CORDIC, Dulmage-Mendelsohn, Cheeger Conductance, Bottleneck Assignment, DLQ Retry & Time-Travel Differ Frontier (Modules 221-234)", () => {
  // 1. Paillier Additive Homomorphic Encryption over Z_{n^2}^* (Module 221)
  const key = PaillierHomomorphicEncryptionEngine.generateKeyPairFromPrimes(104729n, 104723n);
  const c1 = PaillierHomomorphicEncryptionEngine.encrypt(key, 4200n, 17n);
  const c2 = PaillierHomomorphicEncryptionEngine.encrypt(key, 5800n, 29n);
  const cSum = PaillierHomomorphicEncryptionEngine.homomorphicAddCiphertexts(key, c1, c2);
  assert.equal(PaillierHomomorphicEncryptionEngine.decrypt(key, cSum), 10000n);

  const cScaled = PaillierHomomorphicEncryptionEngine.homomorphicScalarMultiply(key, c1, 3n);
  assert.equal(PaillierHomomorphicEncryptionEngine.decrypt(key, cScaled), 12600n);

  // 2. Yen's K-Shortest Loopless Paths Router (Module 222)
  const kPaths = YenKShortestLooplessPathsRouter.findKShortestPaths(
    ["S", "A", "B", "T"],
    [
      { from: "S", to: "A", weight: 1 },
      { from: "A", to: "T", weight: 1 }, // path 1: S->A->T (2)
      { from: "S", to: "B", weight: 2 },
      { from: "B", to: "T", weight: 2 }, // path 2: S->B->T (4)
      { from: "A", to: "B", weight: 2 } // path 3: S->A->B->T (5)
    ],
    "S",
    "T",
    3
  );
  assert.equal(kPaths.length, 3);
  assert.deepEqual(
    kPaths.map((p) => p.totalWeight),
    [2, 4, 5]
  );

  // 3. Sleator & Tarjan Heavy-Light Decomposition (HLD) Tree Path Aggregator (Module 223)
  const hld = new HeavyLightDecompositionTreeEngine(
    "r",
    {
      r: ["a", "b"],
      a: ["a1", "a2"],
      b: ["b1"]
    },
    { r: 10, a: 20, a1: 5, a2: 7, b: 30, b1: 15 }
  );
  // Path a1 -> a -> r -> b -> b1 has sum = 5 + 20 + 10 + 30 + 15 = 80, max = 30
  const agg1 = hld.queryPathAggregate("a1", "b1");
  assert.equal(agg1.pathSum, 80);
  assert.equal(agg1.pathMax, 30);
  hld.updateNodeValue("r", 100);
  assert.equal(hld.queryPathAggregate("a1", "b1").pathSum, 170);

  // 4. Monotone Chain Convex Hull & Rotating Calipers Antipodal Diameter (Module 224)
  // 3x4 rectangle [0,3] x [0,4] with interior point (1,1): area = 12, perimeter = 14, diameter = 5
  const hullRes = ConvexHullAndRotatingCalipersEngine.computeConvexHullAndDiameter([
    { x: 0, y: 0 },
    { x: 3, y: 0 },
    { x: 3, y: 4 },
    { x: 0, y: 4 },
    { x: 1, y: 1 }
  ]);
  assert.equal(hullRes.hullVerticesCcw.length, 4);
  assert.equal(hullRes.hullArea, 12);
  assert.equal(hullRes.hullPerimeter, 14);
  assert.equal(hullRes.maxDiameterDistance, 5);

  // 5. Householder Orthogonal QR Least-Squares Solver (Module 225)
  // Fit line y = c0 + c1 * t through (0, 1), (1, 3), (2, 5) => exact solution c0 = 1, c1 = 2
  const qr = HouseholderQrLeastSquaresSolver.solveLeastSquaresQr(
    [
      [1, 0],
      [1, 1],
      [1, 2]
    ],
    [1, 3, 5]
  );
  assert.ok(Math.abs(qr.leastSquaresSolutionX[0]! - 1) < 1e-4);
  assert.ok(Math.abs(qr.leastSquaresSolutionX[1]! - 2) < 1e-4);
  assert.ok(qr.residualNormL2 < 1e-4);

  // 6. Bitap Shift-Or Approximate String Matcher (Module 226)
  const bitapHits = BitapShiftOrApproximateMatcher.searchApproximate(
    "run kosmXra kernel",
    "kosmora",
    1
  );
  assert.ok(bitapHits.some((h) => h.editDistance <= 1));

  // 7. Duval's Lyndon Word Factorization & Minimal Cyclic Rotation (Module 227)
  const lyndon = DuvalLyndonFactorizationEngine.factorizeLyndonWords("abacaba");
  assert.equal(lyndon.join(""), "abacaba");
  const minRot = DuvalLyndonFactorizationEngine.minimalCyclicRotation("bbaacca");
  assert.equal(minRot.canonicalRotation, "aaccabb");

  // 8. Efraimidis-Spirakis Weighted Reservoir Sampler (Module 228)
  const resSampler = new EfraimidisSpirakisWeightedReservoir<string>(2);
  resSampler.offer("low_weight", 1, 0.5); // key = 0.5^1 = 0.5
  resSampler.offer("high_weight_1", 100, 0.5); // key = 0.5^0.01 = 0.993
  resSampler.offer("high_weight_2", 50, 0.5); // key = 0.5^0.02 = 0.986
  assert.deepEqual(
    resSampler.getSample().map((e) => e.item),
    ["high_weight_1", "high_weight_2"]
  );

  // 9. Volder's CORDIC Trigonometric & Vectoring Evaluator (Module 229)
  const trig = VolderCordicVectorRotationEngine.evaluateSinCos(Math.PI / 6);
  assert.ok(Math.abs(trig.sin - 0.5) < 1e-4);
  assert.ok(Math.abs(trig.cos - Math.sqrt(3) / 2) < 1e-4);
  const vec = VolderCordicVectorRotationEngine.vectoringMagnitudeAndAtan2(4, 3);
  assert.ok(Math.abs(vec.magnitude - 5) < 1e-4);

  // 10. Dulmage-Mendelsohn Structural Decomposition (Module 230)
  // Under-constrained: v1, v2 both appear in eq1 (2 vars, 1 eq)
  // Well-constrained: v3 appears in eq2 (1 var, 1 eq)
  const dm = DulmageMendelsohnCanonicalDecomposer.decomposeBipartiteSystem(
    ["v1", "v2", "v3"],
    ["eq1", "eq2"],
    [
      { variable: "v1", equation: "eq1" },
      { variable: "v2", equation: "eq1" },
      { variable: "v3", equation: "eq2" }
    ]
  );
  assert.deepEqual(dm.underConstrainedVariables, ["v1", "v2"]);
  assert.deepEqual(dm.wellConstrainedVariables, ["v3"]);

  // 11. Cheeger Conductance & Sweep-Cut Expander Auditor (Module 231)
  // Barbell of two triangles connected by a single bridge of weight 1:
  // vol(triangle) = 2*(10+10+10) + 1 = 61, cut = 1 => Phi = 1 / 61 ≈ 0.016393
  const cheeger = CheegerConductanceAndSweepCutAuditor.auditSweepCutConductance(
    ["a1", "a2", "a3", "b1", "b2", "b3"],
    [
      { u: "a1", v: "a2", weight: 10 },
      { u: "a2", v: "a3", weight: 10 },
      { u: "a1", v: "a3", weight: 10 },
      { u: "b1", v: "b2", weight: 10 },
      { u: "b2", v: "b3", weight: 10 },
      { u: "b1", v: "b3", weight: 10 },
      { u: "a3", v: "b1", weight: 1 }
    ]
  );
  assert.deepEqual(cheeger.optimalSweepCutSetS, ["a1", "a2", "a3"]);
  assert.ok(cheeger.minimumConductancePhi < 0.02);

  // 12. Linear Bottleneck Min-Max Assignment Solver (Module 232)
  const lbap = LinearBottleneckAssignmentSolver.solveMinMaxBottleneck([
    [3, 10, 10],
    [10, 5, 2],
    [4, 6, 10]
  ]);
  // Optimal assignment: row0 -> col0 (3), row1 -> col2 (2), row2 -> col1 (6) => max bottleneck = 6
  assert.equal(lbap.minMaxBottleneckCost, 6);

  // 13. Decorrelated Jitter Exponential Backoff & DLQ Store (Module 233)
  const db = new DatabaseSync(":memory:");
  const dlq = new DecorrelatedJitterDlqRetryStore(db, { baseDelayMs: 100, capDelayMs: 5000 });
  dlq.enqueueTask("job_1", 2);
  const f1 = dlq.recordFailure("job_1", "timeout_1", 0.5);
  assert.equal(f1.status, "BACKOFF_SCHEDULED");
  assert.ok(f1.nextRetryDelayMs >= 100);
  const f2 = dlq.recordFailure("job_1", "timeout_2", 0.5);
  assert.equal(f2.status, "DEAD_LETTER_QUARANTINED");

  // 14. Time-Travel Multi-Version Snapshot Differ (Module 234)
  const differ = new TimeTravelSnapshotDiffInspector(db);
  differ.commitSnapshot(1, { k1: "v1", k2: "v2" });
  differ.commitSnapshot(2, { k1: "v1_updated", k3: "v3" });
  const diff = differ.diffRevisions(1, 2);
  assert.deepEqual(diff.addedKeys, { k3: "v3" });
  assert.deepEqual(diff.modifiedKeys, { k1: { before: "v1", after: "v1_updated" } });
  assert.deepEqual(diff.deletedKeys, ["k2"]);
});
