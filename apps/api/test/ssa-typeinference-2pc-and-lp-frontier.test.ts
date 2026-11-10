import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

import { ControlFlowDominatorAndSsaAnalyzer } from "../../../packages/core/src/lengauer-tarjan-dominator-ssa.ts";
import { HindleyMilnerAlgorithmWTypeEngine } from "../../../packages/core/src/hindley-milner-type-inference.ts";
import { TwoPhaseCommitAndWaitForDeadlockEngine } from "../../../packages/db/src/two-phase-commit-and-deadlock-detector.ts";
import { RadixPatriciaCompactTrie } from "../../../packages/core/src/radix-patricia-compact-trie.ts";
import { GaleShapleyStableMatchingEngine } from "../../../packages/core/src/gale-shapley-stable-matching.ts";
import { AllPairsShortestPathAndMinMeanCycleEngine } from "../../../packages/core/src/floyd-warshall-johnson-apsp.ts";
import { AugmentedIntervalOverlapIndex } from "../../../packages/core/src/interval-tree-augmented-avl.ts";
import { DantzigSimplexLinearProgramSolver } from "../../../packages/core/src/simplex-linear-programming-solver.ts";
import { CanonicalHuffmanEntropyCodec } from "../../../packages/core/src/huffman-canonical-ans-entropy-coder.ts";
import { BoyerMooreHorspoolMatcher } from "../../../packages/core/src/boyer-moore-horspool-sunday-matcher.ts";
import { PageHinkleyConceptDriftDetector } from "../../../packages/core/src/page-hinkley-adwin-drift-detector.ts";
import { LazySegmentAndFenwickTreeEngine } from "../../../packages/core/src/fenwick-segment-tree-range-aggregator.ts";
import { HierarchicalTimingWheelStore } from "../../../packages/db/src/hierarchical-timing-wheel-scheduler.ts";
import { ForgyReteRuleEngine } from "../../../packages/core/src/retinal-rete-forward-chaining-engine.ts";

test("Phase 14: Compiler SSA Dominators, Hindley-Milner Type Inference, 2PC + Deadlock WFG, Radix Trie, Simplex LP & Rete Frontier (Modules 109-122)", () => {
  // 1. Control-Flow Dominator Tree, Dominance Frontier & SSA Phi-Node Placement (Module 109)
  // Classic Diamond CFG: B0 -> (B1, B2) -> B3; variable "x" defined in B1 and B2 requires Phi(x) at join block B3!
  const ssaReport = ControlFlowDominatorAndSsaAnalyzer.analyzeCfg("B0", [
    { id: "B0", successors: ["B1", "B2"], defs: ["init"] },
    { id: "B1", successors: ["B3"], defs: ["x"], uses: ["init"] },
    { id: "B2", successors: ["B3"], defs: ["x"], uses: ["init"] },
    { id: "B3", successors: [], uses: ["x"] }
  ]);
  assert.equal(ssaReport.immediateDominators["B3"], "B0");
  assert.deepEqual(ssaReport.dominanceFrontiers["B1"], ["B3"]);
  assert.deepEqual(ssaReport.dominanceFrontiers["B2"], ["B3"]);
  assert.deepEqual(ssaReport.ssaPhiPlacementsByVariable["x"], ["B3"]);
  assert.deepEqual(ssaReport.liveOutByBlock["B0"], ["init"]);

  // 2. Damas-Hindley-Milner Algorithm W Polymorphic Type Inference (Module 110)
  // let id = \x -> x in let a = id(42) in id(true)  ==> Bool!
  const hm = new HindleyMilnerAlgorithmWTypeEngine();
  const polyExpr = {
    kind: "let" as const,
    name: "id",
    value: { kind: "abs" as const, param: "x", body: { kind: "var" as const, name: "x" } },
    body: {
      kind: "let" as const,
      name: "unusedInt",
      value: {
        kind: "app" as const,
        fn: { kind: "var" as const, name: "id" },
        arg: { kind: "lit_int" as const, value: 42 }
      },
      body: {
        kind: "app" as const,
        fn: { kind: "var" as const, name: "id" },
        arg: { kind: "lit_bool" as const, value: true }
      }
    }
  };
  const hmRes = hm.inferExpressionType(polyExpr);
  assert.equal(hmRes.formattedType, "Bool");

  // 3. Two-Phase Commit (2PC) & Wait-For Graph Deadlock Detector (Module 111)
  const db = new DatabaseSync(":memory:");
  const twoPc = new TwoPhaseCommitAndWaitForDeadlockEngine(db);
  const committed = twoPc.executeTwoPhaseCommit({
    txId: "tx-100",
    coordinatorId: "coord-1",
    votes: [
      { participantId: "shard-a", vote: "VOTE_COMMIT" },
      { participantId: "shard-b", vote: "VOTE_COMMIT" }
    ]
  });
  assert.equal(committed.decision, "GLOBAL_COMMIT");

  const deadlock = TwoPhaseCommitAndWaitForDeadlockEngine.detectWaitForDeadlock({
    transactions: [
      { txId: "tx-older", startTimestampMs: 1000 },
      { txId: "tx-younger", startTimestampMs: 2500 }
    ],
    waitForEdges: [
      { waiterTxId: "tx-older", holderTxId: "tx-younger" },
      { waiterTxId: "tx-younger", holderTxId: "tx-older" }
    ]
  });
  assert.equal(deadlock.hasDeadlock, true);
  assert.equal(deadlock.selectedVictimTxId, "tx-younger");

  // 4. Morrison's Radix / Patricia Compact Trie (Module 112)
  const radix = new RadixPatriciaCompactTrie<string>();
  radix.insert("/api/v1/agents", "agents-handler");
  radix.insert("/api/v1/agents/autonomous", "autonomous-handler");
  radix.insert("/api/v2/health", "health-handler");
  assert.equal(radix.get("/api/v1/agents"), "agents-handler");
  const lpm = radix.findLongestPrefixMatch("/api/v1/agents/autonomous/run/123");
  assert.equal(lpm?.matchedPrefix, "/api/v1/agents/autonomous");
  assert.equal(lpm?.value, "autonomous-handler");

  // 5. Gale-Shapley Stable Matching & Zero Blocking-Pair Verification (Module 113)
  const gs = GaleShapleyStableMatchingEngine.computeStableMatching({
    proposerPreferences: {
      a1: ["r1", "r2", "r3"],
      a2: ["r2", "r1", "r3"],
      a3: ["r1", "r2", "r3"]
    },
    reviewerPreferences: {
      r1: ["a2", "a1", "a3"],
      r2: ["a1", "a2", "a3"],
      r3: ["a1", "a2", "a3"]
    }
  });
  assert.equal(gs.isStableZeroBlockingPairs, true);
  assert.equal(Object.keys(gs.proposerToReviewer).length, 3);

  // 6. Floyd-Warshall All-Pairs Shortest Paths & Graph Center/Diameter (Module 114)
  const apsp = AllPairsShortestPathAndMinMeanCycleEngine.analyzeGraph(
    ["n1", "n2", "n3"],
    [
      { from: "n1", to: "n2", weight: 4 },
      { from: "n2", to: "n3", weight: 5 },
      { from: "n1", to: "n3", weight: 15 },
      { from: "n3", to: "n1", weight: 3 }
    ]
  );
  assert.equal(apsp.hasNegativeCycle, false);
  assert.equal(apsp.distanceMatrix["n1"]?.["n3"], 9); // via n2 (4 + 5) < 15

  // 7. CLRS Augmented Interval Tree & Sweep-Line Peak Concurrency (Module 115)
  const ivTree = new AugmentedIntervalOverlapIndex<string>();
  ivTree.insertInterval({ id: "job-1", low: 10, high: 30 });
  ivTree.insertInterval({ id: "job-2", low: 20, high: 40 });
  ivTree.insertInterval({ id: "job-3", low: 25, high: 35 });
  ivTree.insertInterval({ id: "job-4", low: 60, high: 80 });
  const hits = ivTree.queryOverlapping(22, 28);
  assert.equal(hits.length, 3);
  const peak = ivTree.computePeakConcurrency();
  assert.equal(peak.peakConcurrentCount, 3);

  // 8. Dantzig Primal Simplex Linear Programming Solver (Module 116)
  // Maximize 3*x1 + 5*x2 subject to: x1 <= 4, 2*x2 <= 12, 3*x1 + 2*x2 <= 18
  // Optimal: x1 = 2, x2 = 6 -> objective = 3(2) + 5(6) = 36!
  const lp = DantzigSimplexLinearProgramSolver.solveMaximization({
    objectiveCoefficientsC: [3, 5],
    constraintMatrixA: [
      [1, 0],
      [0, 2],
      [3, 2]
    ],
    constraintRhsB: [4, 12, 18]
  });
  assert.equal(lp.status, "OPTIMAL");
  assert.equal(lp.optimalObjectiveValue, 36);
  assert.deepEqual(lp.primalVariables, [2, 6]);

  // 9. Canonical Huffman Entropy Codec (Module 117)
  const huffText = "AAAAABBBBCCCDDE";
  const huffEnc = CanonicalHuffmanEntropyCodec.encode(huffText);
  assert.ok(huffEnc.averageCodeLengthBits >= huffEnc.shannonEntropyBitsPerSymbol);
  assert.equal(CanonicalHuffmanEntropyCodec.decode(huffEnc), huffText);

  // 10. Boyer-Moore-Horspool Sub-Linear String Matcher (Module 118)
  const bmh = BoyerMooreHorspoolMatcher.searchAll(
    "KOSMORA_KERNEL_FAST_SKIP_KOSMORA_KERNEL",
    "KOSMORA_KERNEL"
  );
  assert.deepEqual(bmh.matchIndices, [0, 25]);

  // 11. Page-Hinkley Sequential Concept-Drift Detector (Module 119)
  const pht = new PageHinkleyConceptDriftDetector({
    magnitudeDelta: 0.1,
    thresholdLambda: 10.0
  });
  for (let i = 0; i < 15; i++) {
    assert.equal(pht.observe(1.0).driftDetected, false);
  }
  let drifted = false;
  for (let i = 0; i < 10; i++) {
    if (pht.observe(10.0).driftDetected) drifted = true;
  }
  assert.equal(drifted, true);

  // 12. Lazy-Propagation Segment Tree Range Aggregator (Module 120)
  const seg = new LazySegmentAndFenwickTreeEngine([1, 2, 3, 4, 5]);
  seg.rangeAdd(1, 3, 10); // array becomes [1, 12, 13, 14, 5]
  const q = seg.queryRange(0, 4);
  assert.equal(q.sum, 45);
  assert.equal(q.max, 14);

  // 13. Hashed & Hierarchical Timing Wheel Scheduler (Module 121)
  const wheel = new HierarchicalTimingWheelStore(db, 8, 0);
  wheel.scheduleTimer("timer-short", 2, { action: "retry_rpc" });
  assert.equal(wheel.advanceTick().length, 0); // tick 1
  const dueAtTick2 = wheel.advanceTick(); // tick 2
  assert.equal(dueAtTick2.length, 1);
  assert.equal(dueAtTick2[0]?.timerId, "timer-short");

  // 14. Forgy's Rete Forward-Chaining Production Rule Engine (Module 122)
  const rete = new ForgyReteRuleEngine();
  rete.addFact({ subject: "node-alpha", attribute: "cpu_pct", value: 95 });
  rete.addFact({ subject: "node-alpha", attribute: "role", value: "worker" });
  rete.addRule({
    ruleId: "high-cpu-worker-alert",
    saliencePriority: 10,
    conditions: [
      { subjectVarOrConst: "?n", attribute: "role", valueVarOrConst: "worker" },
      { subjectVarOrConst: "?n", attribute: "cpu_pct", valueVarOrConst: 95 }
    ],
    thenInferFact: (b) => ({
      subject: String(b["?n"]),
      attribute: "status",
      value: "scale_out_required"
    })
  });
  const reteRes = rete.runToFixpoint();
  assert.equal(reteRes.inferredFactsCount, 1);
  assert.ok(
    reteRes.allFacts.some(
      (f) => f.subject === "node-alpha" && f.attribute === "status" && f.value === "scale_out_required"
    )
  );
});
