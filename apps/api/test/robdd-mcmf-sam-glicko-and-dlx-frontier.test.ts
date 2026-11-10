import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

import { ReducedOrderedBinaryDecisionDiagram } from "../../../packages/core/src/robdd-binary-decision-diagram.ts";
import { SuccessiveShortestPathMinCostMaxFlow } from "../../../packages/core/src/min-cost-max-flow-spfa.ts";
import { SuffixAutomatonDirectedWordGraph } from "../../../packages/core/src/suffix-automaton-sam-dawg.ts";
import { Glicko2AndBradleyTerrySkillEngine } from "../../../packages/core/src/glicko2-bradley-terry-rating.ts";
import { LempelZivWelchDictionaryCodec } from "../../../packages/core/src/lzw-lz77-dictionary-compressor.ts";
import { DisjointSetAndSteinerMstEngine } from "../../../packages/core/src/disjoint-set-kruskal-mst.ts";
import { NaturalCubicSplineAndPchipInterpolator } from "../../../packages/core/src/cubic-spline-hermite-interpolator.ts";
import { TheilSenAndMannKendallTrendAnalyzer } from "../../../packages/core/src/mann-kendall-theil-sen-trend.ts";
import { EntropicOptimalTransportSinkhorn } from "../../../packages/core/src/sinkhorn-knopp-earth-mover-ot.ts";
import { KnuthAlgorithmXExactCoverSolver } from "../../../packages/core/src/dancing-links-exact-cover-dlx.ts";
import { LexoRankFractionalOrderStore } from "../../../packages/db/src/fractional-indexing-lexorank-store.ts";
import { SlidingWindowLogAndCounterGovernor } from "../../../packages/db/src/sliding-window-rate-governor-store.ts";
import { KarpMillerPetriNetReachabilityAnalyzer } from "../../../packages/core/src/petri-karp-miller-coverability.ts";
import { DijkstraShuntingYardAndAstEvaluator } from "../../../packages/core/src/shunting-yard-pratt-expression-evaluator.ts";

test("Phase 15: Canonical ROBDD, Min-Cost Max-Flow, Suffix Automaton, Glicko-2, LZW, Sinkhorn OT & Algorithm X DLX Frontier (Modules 125-138)", () => {
  // 1. Canonical Reduced Ordered Binary Decision Diagram (ROBDD) (Module 125)
  // Verify De Morgan's Law: ~(A & B) <=> (~A | ~B) compile to the exact same ROBDD root ID!
  const bdd = new ReducedOrderedBinaryDecisionDiagram(["A", "B", "C"]);
  const deMorganLeft = {
    kind: "not" as const,
    inner: {
      kind: "and" as const,
      left: { kind: "var" as const, name: "A" },
      right: { kind: "var" as const, name: "B" }
    }
  };
  const deMorganRight = {
    kind: "or" as const,
    left: { kind: "not" as const, inner: { kind: "var" as const, name: "A" } },
    right: { kind: "not" as const, inner: { kind: "var" as const, name: "B" } }
  };
  assert.equal(bdd.areEquivalent(deMorganLeft, deMorganRight), true);
  // Over 3 variables (A, B, C), ~(A & B) is true whenever (A,B) != (1,1) => 3 * 2 = 6 satisfying assignments!
  const rootId = bdd.compileFormula(deMorganLeft);
  assert.equal(bdd.countSatisfyingAssignments(rootId), 6);

  // 2. Successive Shortest Path Min-Cost Max-Flow (MCMF) (Module 126)
  const mcmf = new SuccessiveShortestPathMinCostMaxFlow();
  mcmf.addEdge("src", "fast_cheap", 3, 2); // cap 3, cost 2
  mcmf.addEdge("src", "slow_expensive", 3, 10); // cap 3, cost 10
  mcmf.addEdge("fast_cheap", "sink", 3, 1); // cap 3, cost 1 (total unit cost = 3)
  mcmf.addEdge("slow_expensive", "sink", 3, 1); // cap 3, cost 1 (total unit cost = 11)
  // Request 4 units of flow: 3 units take fast_cheap (3 * 3 = 9), 1 unit takes slow_expensive (1 * 11 = 11) => total cost = 20!
  const flowRes = mcmf.computeMinCostMaxFlow("src", "sink", 4);
  assert.equal(flowRes.maxFlow, 4);
  assert.equal(flowRes.minTotalCost, 20);

  // 3. Linear-Time Suffix Automaton (SAM) (Module 127)
  const sam = new SuffixAutomatonDirectedWordGraph("ABAB");
  // Distinct non-empty substrings of "ABAB": "A", "B", "AB", "BA", "ABA", "BAB", "ABAB" => 7!
  assert.equal(sam.countDistinctSubstrings(), 7);
  assert.equal(sam.containsSubstring("BAB"), true);
  assert.equal(sam.findLongestCommonSubstring("XXBABYY"), "BAB");

  // 4. Glicko-2 Bayesian Skill Rating Engine (Module 128)
  const glicko = new Glicko2AndBradleyTerrySkillEngine();
  glicko.ensurePlayer("model-alpha", 1500, 200);
  glicko.ensurePlayer("model-beta", 1500, 200);
  const updatedAlpha = glicko.recordRatingPeriod("model-alpha", [
    { opponentId: "model-beta", score: 1 },
    { opponentId: "model-beta", score: 1 }
  ]);
  assert.ok(updatedAlpha.ratingR > 1580);
  assert.ok(updatedAlpha.ratingDeviationRd < 200);

  // 5. Lempel-Ziv-Welch (LZW) Adaptive Dictionary Compressor (Module 129)
  const rawLzw = "TOBEORNOTTOBEORTOBEORNOT_KOSMORA_KERNEL_KOSMORA_KERNEL";
  const lzwCodes = LempelZivWelchDictionaryCodec.compress(rawLzw);
  assert.ok(lzwCodes.length < rawLzw.length);
  assert.equal(LempelZivWelchDictionaryCodec.decompress(lzwCodes), rawLzw);

  // 6. Disjoint-Set Union-Find & Kruskal Minimum Spanning Tree (Module 130)
  const mst = DisjointSetAndSteinerMstEngine.computeMinimumSpanningTree(
    ["A", "B", "C", "D"],
    [
      { u: "A", v: "B", weight: 1 },
      { u: "B", v: "C", weight: 2 },
      { u: "C", v: "D", weight: 3 },
      { u: "A", v: "D", weight: 10 },
      { u: "A", v: "C", weight: 5 }
    ]
  );
  assert.equal(mst.totalWeight, 6);
  assert.equal(mst.mstEdges.length, 3);
  assert.equal(mst.connectedComponentsCount, 1);

  // 7. Natural Cubic Spline Interpolator via Thomas TDMA (Module 131)
  const spline = new NaturalCubicSplineAndPchipInterpolator([
    { x: 0, y: 0 },
    { x: 1, y: 2 },
    { x: 2, y: 4 },
    { x: 3, y: 6 }
  ]);
  const evalMid = spline.evaluateAt(1.5);
  assert.ok(Math.abs(evalMid.value - 3.0) < 1e-4);
  assert.ok(Math.abs(evalMid.firstDerivative - 2.0) < 1e-4);

  // 8. Mann-Kendall Trend Test & Theil-Sen Robust Median Slope (Module 132)
  const trend = TheilSenAndMannKendallTrendAnalyzer.analyzeSeries([
    { t: 1, y: 10 },
    { t: 2, y: 20 },
    { t: 3, y: 30 },
    { t: 4, y: 40 },
    { t: 5, y: 50 },
    { t: 6, y: 9999 } // Corrupted outlier at t=6! Theil-Sen median slope stays 10!
  ]);
  assert.equal(trend.trendDirection, "INCREASING");
  assert.equal(trend.theilSenMedianSlope, 10);

  // 9. Sinkhorn-Knopp Entropic Optimal Transport (Wasserstein Distance) (Module 133)
  const ot = EntropicOptimalTransportSinkhorn.computeOptimalTransport({
    sourceDistributionP: [0.5, 0.5],
    targetDistributionQ: [0.5, 0.5],
    groundCostMatrixC: [
      [0, 10],
      [10, 0]
    ],
    entropicEpsilon: 0.5
  });
  assert.equal(ot.converged, true);
  assert.ok(ot.wassersteinCost < 0.05);

  // 10. Knuth's Algorithm X / Dancing Links Exact Cover Solver (Module 134)
  const dlx = KnuthAlgorithmXExactCoverSolver.solveExactCover(
    ["e1", "e2", "e3", "e4"],
    [
      { rowId: "r1", coveredElements: ["e1", "e3"] },
      { rowId: "r2", coveredElements: ["e1", "e2", "e4"] },
      { rowId: "r3", coveredElements: ["e2", "e4"] }
    ]
  );
  assert.equal(dlx.satisfiable, true);
  assert.deepEqual(dlx.selectedRowIds?.sort(), ["r1", "r3"]);

  // 11. LexoRank Base-62 Fractional Indexing Store (Module 135)
  const db = new DatabaseSync(":memory:");
  const lexo = new LexoRankFractionalOrderStore(db, "backlog");
  const first = lexo.upsertItemBetween({
    itemId: "task-1",
    prevRank: null,
    nextRank: null,
    payload: { title: "First" }
  });
  const third = lexo.upsertItemBetween({
    itemId: "task-3",
    prevRank: first.lexoRank,
    nextRank: null,
    payload: { title: "Third" }
  });
  // Insert task-2 strictly between task-1 and task-3 in O(1) without touching task-1 or task-3!
  lexo.upsertItemBetween({
    itemId: "task-2",
    prevRank: first.lexoRank,
    nextRank: third.lexoRank,
    payload: { title: "Second" }
  });
  const ordered = lexo.listOrderedItems();
  assert.deepEqual(ordered.map((x) => x.itemId), ["task-1", "task-2", "task-3"]);

  // 12. Hybrid Sliding-Window Rate Governor (Module 136)
  const gov = new SlidingWindowLogAndCounterGovernor(db, {
    windowDurationMs: 1000,
    limitMaxRequests: 10
  });
  assert.equal(gov.checkAndConsume("user-1", 1000, 8).allowed, true);
  // At 1500ms (halfway through next window [2000..3000)? wait: 1000 is window 1, 2500 is 50% into window 2):
  // weighted previous count = 8 * (1 - 0.5) = 4. Requesting 5 => 4 + 5 = 9 <= 10 (allowed)!
  assert.equal(gov.checkAndConsume("user-1", 2500, 5).allowed, true);
  // Requesting 2 more at 2500ms => 4 + 5 + 2 = 11 > 10 (blocked)!
  assert.equal(gov.checkAndConsume("user-1", 2500, 2).allowed, false);

  // 13. Karp-Miller Petri Net Reachability & Token Conservation Analyzer (Module 137)
  const petri = KarpMillerPetriNetReachabilityAnalyzer.analyzeReachability({
    initialMarking: { idle: 2, busy: 0 },
    transitions: [
      { id: "start_work", consumeFromPlaces: { idle: 1 }, produceToPlaces: { busy: 1 } },
      { id: "finish_work", consumeFromPlaces: { busy: 1 }, produceToPlaces: { idle: 1 } }
    ]
  });
  assert.equal(petri.isDeadlockFree, true);
  assert.equal(petri.conservedTokenSumInvariantHolds, true);
  assert.equal(petri.reachableStatesCount, 3); // (2,0), (1,1), (0,2)

  // 14. Dijkstra's Shunting-Yard Expression Parser & Safe AST Evaluator (Module 138)
  const exprRes = DijkstraShuntingYardAndAstEvaluator.evaluateExpression(
    "max(10, 2 ^ 3 * base + sqrt(16))",
    { base: 5 }
  );
  // 2^3 * 5 + 4 = 8 * 5 + 4 = 44
  assert.equal(exprRes.result, 44);
});
