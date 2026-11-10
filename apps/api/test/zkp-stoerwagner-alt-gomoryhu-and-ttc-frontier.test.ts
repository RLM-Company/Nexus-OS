import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

import { SchnorrZkpAndPedersenCommitmentEngine } from "../../../packages/core/src/schnorr-pedersen-zkp-commitment.ts";
import { StoerWagnerGlobalMinCutEngine } from "../../../packages/core/src/stoer-wagner-global-min-cut.ts";
import { AStarLandmarkTriangleInequalityRouter } from "../../../packages/core/src/astar-landmark-alt-router.ts";
import { MisraGriesAndSpaceSavingFrequentItems } from "../../../packages/core/src/misra-gries-space-saving-heavy-hitters.ts";
import { JacobiSymmetricEigenvaluePcaEngine } from "../../../packages/core/src/jacobi-eigenvalue-pca-reducer.ts";
import { TarjanBiconnectedArticulationAnalyzer } from "../../../packages/core/src/tarjan-bridge-articulation-biconnected.ts";
import { KnuthPlassOptimalLineBreaker } from "../../../packages/core/src/knuth-plass-paragraph-line-breaker.ts";
import { UnscentedKalmanSigmaPointFilter } from "../../../packages/core/src/unscented-kalman-sigma-point-filter.ts";
import { LloydMaxAndErrorDiffusionQuantizer } from "../../../packages/core/src/floyd-steinberg-scalar-lloyd-max-quantizer.ts";
import { GomoryHuAllPairsMinCutTreeEngine } from "../../../packages/core/src/edmonds-karp-gomory-hu-cut-tree.ts";
import { ShapleyScarfTopTradingCyclesEngine } from "../../../packages/core/src/gale-top-trading-cycles-housing-market.ts";
import { JaroWinklerAndPhoneticCodeProfiler } from "../../../packages/core/src/jaro-winkler-phonetic-double-metaphone.ts";
import { ObservedRemoveSetDeltaCrdtStore } from "../../../packages/db/src/or-set-observed-remove-crdt-store.ts";
import { HierarchicalCostAttributionLedger } from "../../../packages/db/src/hierarchical-quota-cost-attribution-ledger.ts";

test("Phase 19: Schnorr ZKP & Pedersen Commitments, Stoer-Wagner Global Min-Cut, ALT Landmark A*, Misra-Gries, Jacobi PCA, Tarjan Bridges, Knuth-Plass, UKF, Gomory-Hu Cut Tree, Top Trading Cycles & OR-Set CRDT Frontier (Modules 189-202)", () => {
  // 1. Schnorr Non-Interactive Zero-Knowledge Proof & Homomorphic Pedersen Commitments (Module 189)
  const proof = SchnorrZkpAndPedersenCommitmentEngine.createSchnorrProof(
    1234567890123n,
    9876543210987n,
    "kosmora-vault-auth"
  );
  assert.equal(
    SchnorrZkpAndPedersenCommitmentEngine.verifySchnorrProof(proof, "kosmora-vault-auth"),
    true
  );
  assert.equal(
    SchnorrZkpAndPedersenCommitmentEngine.verifySchnorrProof(proof, "wrong-context"),
    false
  );

  const c1 = SchnorrZkpAndPedersenCommitmentEngine.commitPedersen(250n, 11111n);
  const c2 = SchnorrZkpAndPedersenCommitmentEngine.commitPedersen(750n, 22222n);
  const combined = SchnorrZkpAndPedersenCommitmentEngine.combineHomomorphicCommitments(c1, c2);
  assert.equal(combined.verifiedEqual, true);
  assert.equal(combined.combinedCommitment.valueV, 1000n);

  // 2. Stoer-Wagner Deterministic Global Minimum Cut (Module 190)
  // Two triangles (A-B-C weight 10) and (D-E-F weight 10) connected by a weak 2-edge cut (C-D=1, B-E=2 => cut=3)
  const swCut = StoerWagnerGlobalMinCutEngine.computeGlobalMinCut(
    ["A", "B", "C", "D", "E", "F"],
    [
      { u: "A", v: "B", weight: 10 },
      { u: "B", v: "C", weight: 10 },
      { u: "A", v: "C", weight: 10 },
      { u: "D", v: "E", weight: 10 },
      { u: "E", v: "F", weight: 10 },
      { u: "D", v: "F", weight: 10 },
      { u: "C", v: "D", weight: 1 },
      { u: "B", v: "E", weight: 2 }
    ]
  );
  assert.equal(swCut.minCutWeight, 3);
  assert.equal(swCut.partitionA.length, 3);
  assert.equal(swCut.partitionB.length, 3);

  // 3. Goldberg & Harrelson ALT (A* + Landmarks + Triangle Inequality) Router (Module 191)
  const altRouter = new AStarLandmarkTriangleInequalityRouter(
    ["N0", "N1", "N2", "N3", "N4"],
    [
      { from: "N0", to: "N1", weight: 2 },
      { from: "N1", to: "N2", weight: 2 },
      { from: "N2", to: "N3", weight: 2 },
      { from: "N3", to: "N4", weight: 2 },
      { from: "N0", to: "N4", weight: 10 }
    ],
    2
  );
  const altPath = altRouter.findShortestPath("N0", "N4");
  assert.equal(altPath.reachable, true);
  assert.equal(altPath.totalDistance, 8);
  assert.deepEqual(altPath.path, ["N0", "N1", "N2", "N3", "N4"]);

  // 4. Misra-Gries & Space-Saving Heavy Hitters (Module 192)
  const hh = new MisraGriesAndSpaceSavingFrequentItems(4);
  for (const item of ["sql", "sql", "sql", "sql", "sql", "rpc", "rpc", "io", "net"]) {
    hh.ingest(item);
  }
  const topSs = hh.getSpaceSavingTopK();
  assert.equal(topSs[0]!.item, "sql");
  assert.equal(topSs[0]!.estimatedCount, 5);
  const mg = hh.getMisraGriesCandidates();
  assert.equal(mg[0]!.item, "sql");

  // 5. Jacobi Symmetric Eigenvalue & PCA Dimensionality Reducer (Module 193)
  // Symmetric matrix [[2, 1], [1, 2]] has exact eigenvalues 3 and 1
  const eigen = JacobiSymmetricEigenvaluePcaEngine.solveSymmetricEigen([
    [2, 1],
    [1, 2]
  ]);
  assert.deepEqual(eigen.eigenvalues, [3, 1]);
  const pca = JacobiSymmetricEigenvaluePcaEngine.computePcaProjection(
    [
      [1, 1],
      [2, 2],
      [3, 3],
      [4, 4]
    ],
    1
  );
  // Perfectly collinear points along y = x => PC1 explains 100% of variance!
  assert.equal(pca.explainedVarianceRatio[0], 1);

  // 6. Tarjan Bridge & Biconnected Articulation Analyzer (Module 194)
  // Path A - B - C: B is an articulation point, (A,B) and (B,C) are bridges
  const biconn = TarjanBiconnectedArticulationAnalyzer.analyzeTopology(
    ["A", "B", "C"],
    [
      { u: "A", v: "B" },
      { u: "B", v: "C" }
    ]
  );
  assert.deepEqual(biconn.articulationPoints, ["B"]);
  assert.equal(biconn.bridgeEdges.length, 2);
  assert.equal(biconn.isTwoEdgeConnected, false);

  // 7. Knuth-Plass DP Optimal Paragraph Line Breaker (Module 195)
  const kp = KnuthPlassOptimalLineBreaker.breakParagraph("aaa bb cc ddddd", 6);
  // Greedy puts "aaa bb" (len 6), "cc" (len 2, slack 4 -> 64), "ddddd" => badness 64
  // Optimal puts "aaa" (len 3, slack 3 -> 27), "bb cc" (len 5, slack 1 -> 1), "ddddd" => badness 28!
  assert.ok(kp.optimalBadnessScore < kp.greedyBadnessScore);
  assert.equal(kp.optimalBadnessScore, 28);

  // 8. Unscented Kalman Sigma-Point Filter (UKF) (Module 196)
  const ukf = UnscentedKalmanSigmaPointFilter.stepNonlinear1D({
    prior: { meanX: 2.0, varianceP: 0.5 },
    processNoiseQ: 0.05,
    measurementNoiseR: 0.1,
    observedZ: 9.0, // observing x^2 near x = 3
    transitionFn: (x) => x + 1.0, // predicted mean = 3.0
    observationFn: (x) => x * x
  });
  assert.ok(Math.abs(ukf.posteriorMean - 3.0) < 0.25);
  assert.ok(ukf.posteriorVariance < ukf.predictedVariance);

  // 9. Lloyd-Max Non-Uniform Scalar Quantizer & Error-Diffusion Ditherer (Module 197)
  const lloyd = LloydMaxAndErrorDiffusionQuantizer.fitLloydMaxQuantizer(
    [0.1, 0.2, 0.15, 0.9, 0.85, 0.95],
    2
  );
  assert.equal(lloyd.centroids.length, 2);
  assert.ok(lloyd.meanSquaredError < 0.01);
  const dithered = LloydMaxAndErrorDiffusionQuantizer.dither1DErrorDiffusion(
    [0.5, 0.5, 0.5, 0.5],
    1.0
  );
  // Mean of [0.5, 0.5, 0.5, 0.5] is 0.5; dithered alternates [1, 0, 1, 0] with exact mean 0.5!
  const ditherMean = dithered.reduce((a, b) => a + b, 0) / dithered.length;
  assert.equal(ditherMean, 0.5);

  // 10. Gomory-Hu All-Pairs Minimum s-t Cut Tree (Module 198)
  const gh = GomoryHuAllPairsMinCutTreeEngine.buildGomoryHuCutTree(
    ["v0", "v1", "v2", "v3"],
    [
      { u: "v0", v: "v1", capacity: 10 },
      { u: "v1", v: "v2", capacity: 3 },
      { u: "v2", v: "v3", capacity: 8 }
    ]
  );
  assert.equal(gh.treeEdges.length, 3);
  assert.equal(gh.allPairsMinCutMatrix["v0"]!["v3"], 3);
  assert.equal(gh.allPairsMinCutMatrix["v2"]!["v3"], 8);

  // 11. Gale's Top Trading Cycles (TTC) Indivisible Resource Market (Module 199)
  const ttc = ShapleyScarfTopTradingCyclesEngine.clearMarket([
    { agentId: "A1", initialEndowedItemId: "H1", strictPreferenceOrderItemIds: ["H2", "H1", "H3"] },
    { agentId: "A2", initialEndowedItemId: "H2", strictPreferenceOrderItemIds: ["H3", "H2", "H1"] },
    { agentId: "A3", initialEndowedItemId: "H3", strictPreferenceOrderItemIds: ["H1", "H3", "H2"] }
  ]);
  assert.deepEqual(ttc.finalAllocationByAgent, { A1: "H2", A2: "H3", A3: "H1" });
  assert.equal(ttc.individuallyRationalVerified, true);

  // 12. Jaro-Winkler Similarity & American Soundex Phonetic Profiler (Module 200)
  const jw = JaroWinklerAndPhoneticCodeProfiler.jaroWinklerSimilarity("MARTHA", "MARHTA");
  assert.ok(jw > 0.96);
  assert.equal(
    JaroWinklerAndPhoneticCodeProfiler.americanSoundex("Robert"),
    JaroWinklerAndPhoneticCodeProfiler.americanSoundex("Rupert")
  );

  // 13. Observed-Remove Set (OR-Set / Add-Wins CRDT) Store (Module 201)
  const db = new DatabaseSync(":memory:");
  const orSet = new ObservedRemoveSetDeltaCrdtStore(db, "node_1");
  orSet.add("tool:bash");
  orSet.removeObserved("tool:bash");
  // Concurrent add from node_2 with an unobserved tag wins over node_1's prior remove!
  orSet.mergeRemoteDelta({
    addedTags: [{ elementValue: "tool:bash", uniqueTag: "node_2:1", replicaId: "node_2" }],
    removedTags: []
  });
  assert.deepEqual(orSet.values(), ["tool:bash"]);

  // 14. Hierarchical FinOps Cost & Token Attribution Ledger (Module 202)
  const ledger = new HierarchicalCostAttributionLedger(db, 1_000_000);
  const cOk = ledger.recordCharge({
    entryId: "e1",
    orgId: "org_kosmora",
    teamId: "team_core",
    projectId: "proj_kernel",
    workflowId: "wf_1",
    promptTokens: 1200,
    completionTokens: 400,
    costMicrosUsd: 600_000
  });
  assert.equal(cOk.accepted, true);
  const cOverBudget = ledger.recordCharge({
    entryId: "e2",
    orgId: "org_kosmora",
    teamId: "team_core",
    projectId: "proj_kernel",
    workflowId: "wf_2",
    promptTokens: 2000,
    completionTokens: 800,
    costMicrosUsd: 500_000
  });
  assert.equal(cOverBudget.accepted, false);
  const rollup = ledger.computeOrgRollup("org_kosmora");
  assert.equal(rollup.orgTotalMicrosUsd, 600_000);
});
