import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

import { DifferenceBoundMatrixTimedVerifier } from "../../../packages/core/src/dbm-timed-automata-verifier.ts";
import { HopcroftKarpMaximumMatchingEngine } from "../../../packages/core/src/hopcroft-karp-bipartite-matching.ts";
import { CooleyTukeyFftAndWelchPeriodogram } from "../../../packages/core/src/cooley-tukey-fft-periodogram.ts";
import { FreundSchapireAdaBoostClassifier } from "../../../packages/core/src/adaboost-decision-stump-ensemble.ts";
import { LevinsonDurbinArForecastEngine } from "../../../packages/core/src/levinson-durbin-burg-autoregression.ts";
import { GoldbergTarjanPushRelabelMaxFlow } from "../../../packages/core/src/push-relabel-goldberg-tarjan.ts";
import { EdgeDisjointFaultTolerantRouter } from "../../../packages/core/src/suurballe-edge-disjoint-paths.ts";
import { BronKerboschPivotCliqueEnumerator } from "../../../packages/core/src/bron-kerbosch-maximal-cliques.ts";
import { IntegerRangeEntropyCodec } from "../../../packages/core/src/arithmetic-range-ans-coder.ts";
import { WalrasianMarketClearingEquilibrium } from "../../../packages/core/src/walrasian-tatonnement-market-clearing.ts";
import { OrderStatisticTreapStore } from "../../../packages/db/src/persistent-treap-order-statistic-store.ts";
import { AriesWriteAheadRedoUndoRecoveryEngine } from "../../../packages/db/src/write-ahead-redo-undo-aries-recovery.ts";
import { ProbabilisticCykGrammarParser } from "../../../packages/core/src/earley-cyk-probabilistic-pcfg.ts";
import { HilbertCurveSpatialIndexer } from "../../../packages/core/src/hilbert-space-filling-curve-index.ts";

test("Phase 16: DBM Timed Automata, Hopcroft-Karp Matching, Cooley-Tukey FFT, ARIES WAL Recovery & CYK PCFG Frontier (Modules 141-154)", () => {
  // 1. Difference-Bound Matrix (DBM) Timed Automata Verifier (Module 141)
  const dbm = new DifferenceBoundMatrixTimedVerifier(["x", "y"]);
  dbm.elapseTimeUp();
  // Constrain 2 <= x <= 5 (i.e. x - 0 <= 5 and 0 - x <= -2) and x - y <= 1
  assert.equal(dbm.addConstraint("x", "0", 5), true);
  assert.equal(dbm.addConstraint("0", "x", -2), true);
  assert.equal(dbm.addConstraint("x", "y", 1), true);
  const zone = dbm.inspectZone();
  assert.equal(zone.consistent, true);
  assert.ok(zone.minDifferenceBetween("y", "0") >= 1); // Since x >= 2 and x - y <= 1 => y >= 1!
  // Contradiction check: require x <= 1 when x >= 2
  assert.equal(dbm.addConstraint("x", "0", 1), false);

  // 2. Hopcroft-Karp Bipartite Matching & König Minimum Vertex Cover (Module 142)
  const hk = HopcroftKarpMaximumMatchingEngine.computeMaximumMatchingAndVertexCover({
    leftNodes: ["u1", "u2", "u3"],
    rightNodes: ["v1", "v2", "v3"],
    edges: [
      { left: "u1", right: "v1" },
      { left: "u1", right: "v2" },
      { left: "u2", right: "v1" },
      { left: "u3", right: "v2" }
    ]
  });
  // König's Theorem: max matching size == min vertex cover size == 2!
  assert.equal(hk.maximumMatchingSize, 2);
  assert.equal(hk.minimumVertexCoverSize, 2);

  // 3. Cooley-Tukey FFT & Periodicity Analyzer (Module 143)
  // Pure sine wave of period 4 samples over N = 16 samples => dominant bin index = 16 / 4 = 4!
  const periodicSignal = Array.from({ length: 16 }, (_, n) =>
    Math.cos((2 * Math.PI * n) / 4)
  );
  const fftReport = CooleyTukeyFftAndWelchPeriodogram.analyzePeriodicity(periodicSignal);
  assert.equal(fftReport.dominantBinIndex, 4);
  assert.equal(fftReport.dominantPeriodSamples, 4);
  assert.ok(fftReport.reconstructedSignalMaxError < 1e-6);

  // 4. Freund & Schapire AdaBoost Decision Stump Ensemble (Module 144)
  const ada = new FreundSchapireAdaBoostClassifier();
  ada.fit(
    [
      [1, 1],
      [2, 2],
      [8, 8],
      [9, 9]
    ],
    [-1, -1, 1, 1],
    6
  );
  assert.equal(ada.predict([1.5, 1.5]).label, -1);
  assert.equal(ada.predict([8.5, 8.5]).label, 1);

  // 5. Levinson-Durbin AR(p) Time-Series Forecasting (Module 145)
  const arSeries = Array.from({ length: 20 }, (_, i) => 10 + 0.8 * Math.pow(-1, i));
  const arRes = LevinsonDurbinArForecastEngine.fitAndForecast(arSeries, 2, 2);
  assert.equal(arRes.forecasts.length, 2);
  assert.ok(arRes.arCoefficientsPhi.length === 2);

  // 6. Goldberg-Tarjan Preflow Push-Relabel Max-Flow (Module 146)
  const pr = new GoldbergTarjanPushRelabelMaxFlow();
  pr.addDirectedEdge("s", "a", 10);
  pr.addDirectedEdge("s", "b", 5);
  pr.addDirectedEdge("a", "b", 15);
  pr.addDirectedEdge("a", "t", 5);
  pr.addDirectedEdge("b", "t", 10);
  assert.equal(pr.computeMaxFlow("s", "t"), 15);

  // 7. Edge-Disjoint Fault-Tolerant Multi-Path Router (Module 147)
  const disjoint = EdgeDisjointFaultTolerantRouter.findEdgeDisjointPaths({
    nodes: ["s", "a", "b", "t"],
    directedEdges: [
      { from: "s", to: "a", cost: 2 },
      { from: "a", to: "t", cost: 2 },
      { from: "s", to: "b", cost: 5 },
      { from: "b", to: "t", cost: 5 }
    ],
    sourceId: "s",
    targetId: "t",
    maxPathsK: 2
  });
  assert.equal(disjoint.paths.length, 2);
  assert.equal(disjoint.totalCombinedCost, 14);

  // 8. Bron-Kerbosch Maximal Cliques & Matula-Beck k-Core Decomposition (Module 148)
  const cliqueReport = BronKerboschPivotCliqueEnumerator.analyzeCliquesAndCores(
    ["c1", "c2", "c3", "c4", "tail"],
    [
      { u: "c1", v: "c2" },
      { u: "c1", v: "c3" },
      { u: "c1", v: "c4" },
      { u: "c2", v: "c3" },
      { u: "c2", v: "c4" },
      { u: "c3", v: "c4" },
      { u: "c4", v: "tail" }
    ]
  );
  assert.equal(cliqueReport.maximumCliqueOmega, 4); // 4-clique {c1,c2,c3,c4}
  assert.equal(cliqueReport.graphDegeneracyKMax, 3); // 3-core

  // 9. Fractional Interval Arithmetic / Range Entropy Codec (Module 149)
  const arithText = "KOSMORA_ARITHMETIC_RANGE_CODEC_VERIFICATION";
  const arithEnc = IntegerRangeEntropyCodec.encode(arithText);
  const arithDec = IntegerRangeEntropyCodec.decode(arithEnc);
  assert.equal(arithDec, arithText);

  // 10. Walrasian Tâtonnement Market-Clearing Equilibrium (Module 150)
  const walras = WalrasianMarketClearingEquilibrium.computeEquilibrium({
    resourceSupplies: { gpu: 10, cpu: 20 },
    agents: [
      { agentId: "ag-1", budgetEndowment: 100, utilityWeightsByResource: { gpu: 0.6, cpu: 0.4 } },
      { agentId: "ag-2", budgetEndowment: 100, utilityWeightsByResource: { gpu: 0.4, cpu: 0.6 } }
    ]
  });
  // Total spending on gpu = 60 + 40 = 100 for supply 10 => equilibrium price p_gpu = 10!
  // Total spending on cpu = 40 + 60 = 100 for supply 20 => equilibrium price p_cpu = 5!
  assert.equal(walras.converged, true);
  assert.ok(Math.abs((walras.equilibriumPricesByResource["gpu"] ?? 0) - 10) < 1e-3);
  assert.ok(Math.abs((walras.equilibriumPricesByResource["cpu"] ?? 0) - 5) < 1e-3);

  // 11. Order-Statistic Treap Store (Module 151)
  const db = new DatabaseSync(":memory:");
  const treap = new OrderStatisticTreapStore<string>(db, "latencies");
  treap.insert(50, "p50");
  treap.insert(10, "p10");
  treap.insert(90, "p90");
  treap.insert(30, "p30");
  assert.equal(treap.selectByRank(0)?.key, 10);
  assert.equal(treap.selectByRank(2)?.key, 50);
  assert.equal(treap.rankOfKey(50), 2); // 10 and 30 are strictly smaller than 50

  // 12. ARIES Write-Ahead Log 3-Phase Crash Recovery Engine (Module 152)
  const aries = new AriesWriteAheadRedoUndoRecoveryEngine(db);
  aries.appendWalRecord({ txId: "tx-winner", type: "BEGIN" });
  aries.appendWalRecord({
    txId: "tx-winner",
    type: "UPDATE",
    pageId: "page-1",
    beforeImage: "v0",
    afterImage: "v1-committed"
  });
  aries.appendWalRecord({ txId: "tx-winner", type: "COMMIT" });

  aries.appendWalRecord({ txId: "tx-loser", type: "BEGIN" });
  aries.appendWalRecord({
    txId: "tx-loser",
    type: "UPDATE",
    pageId: "page-2",
    beforeImage: "clean-before",
    afterImage: "dirty-uncommitted"
  });
  // Crash occurs before tx-loser commits!
  const recovery = aries.runCrashRecovery();
  assert.deepEqual(recovery.committedTransactions, ["tx-winner"]);
  assert.deepEqual(recovery.loserTransactionsRolledBack, ["tx-loser"]);
  assert.equal(recovery.recoveredPageState["page-1"], "v1-committed");
  assert.equal(recovery.recoveredPageState["page-2"], "clean-before");
  assert.equal(recovery.undoClrRecordsWritten, 1);

  // 13. CYK Probabilistic Context-Free Grammar (PCFG) Inside-Viterbi Parser (Module 153)
  const pcfg = new ProbabilisticCykGrammarParser("S", [
    { kind: "binary", lhs: "S", rightA: "NP", rightB: "VP", probability: 1.0 },
    { kind: "binary", lhs: "VP", rightA: "V", rightB: "NP", probability: 0.8 },
    { kind: "terminal", lhs: "NP", terminal: "agent", probability: 0.6 },
    { kind: "terminal", lhs: "NP", terminal: "quorum", probability: 0.4 },
    { kind: "terminal", lhs: "V", terminal: "verifies", probability: 1.0 }
  ]);
  const cykRes = pcfg.parseMostLikelyTree(["agent", "verifies", "quorum"]);
  assert.equal(cykRes.accepted, true);
  // Prob = 1.0 * 0.6 * (0.8 * 1.0 * 0.4) = 0.192
  assert.equal(cykRes.bestProbability, 0.192);

  // 14. 2D Hilbert Space-Filling Curve Spatial Indexer (Module 154)
  for (let x = 0; x < 8; x++) {
    for (let y = 0; y < 8; y++) {
      const h = HilbertCurveSpatialIndexer.xyToHilbertDistance(3, x, y);
      const xy = HilbertCurveSpatialIndexer.hilbertDistanceToXy(3, h);
      assert.deepEqual(xy, { x, y });
    }
  }
});
