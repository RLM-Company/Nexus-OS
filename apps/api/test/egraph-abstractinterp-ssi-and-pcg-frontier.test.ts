import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

import { EGraphEqualitySaturationEngine } from "../../../packages/core/src/egraph-equality-saturation-optimizer.ts";
import { CousotIntervalAbstractInterpreter } from "../../../packages/core/src/abstract-interpretation-interval-domain.ts";
import { CahillSerializableSnapshotIsolationManager } from "../../../packages/db/src/ssi-serializable-snapshot-isolation.ts";
import { PrattTopDownOperatorPrecedenceParser } from "../../../packages/core/src/pratt-tdop-parser-compiler.ts";
import { ForwardBackwardPosteriorHmmEngine } from "../../../packages/core/src/baum-welch-forward-backward-hmm.ts";
import { KarmarkarKarpAndBinPackingScheduler } from "../../../packages/core/src/karmarkar-karp-multiprocessor-binpacking.ts";
import { GeneralGraphMaximumMatchingEngine } from "../../../packages/core/src/edmonds-blossom-general-matching.ts";
import { ConjugateGradientKrylovLinearSolver } from "../../../packages/core/src/conjugate-gradient-krylov-solver.ts";
import { LinearScanAndGraphColoringAllocator } from "../../../packages/core/src/chaitin-linear-scan-register-allocator.ts";
import { HampelIdentifierAndTukeyFenceFilter } from "../../../packages/core/src/tukey-iqr-hampel-outlier-filter.ts";
import { VoseAliasMethodO1DiscreteSampler } from "../../../packages/core/src/knuth-shuffle-alias-method-sampler.ts";
import { DgimSlidingWindowBitCounter } from "../../../packages/core/src/exponential-histogram-dgim-counter.ts";
import { DataflowWatermarkWindowAggregator } from "../../../packages/db/src/out-of-order-watermark-window-aggregator.ts";
import { UkkonenApproximateStringAndNGramProfiler } from "../../../packages/core/src/jaccard-sorensen-dice-ngram-profiler.ts";

test("Phase 17: E-Graph Equality Saturation, Cousot Abstract Interpretation, Cahill SSI, Pratt TDOP, Edmonds Blossom & Krylov PCG Frontier (Modules 157-170)", () => {
  // 1. E-Graph Equality Saturation & Congruence Closure Optimizer (Module 157)
  // Simplify ((x * 4) / 4) + (y - y) -> x!
  const rawAst = {
    kind: "op" as const,
    op: "+" as const,
    args: [
      {
        kind: "op" as const,
        op: "/" as const,
        args: [
          {
            kind: "op" as const,
            op: "*" as const,
            args: [
              { kind: "sym" as const, name: "x" },
              { kind: "num" as const, value: 4 }
            ]
          },
          { kind: "num" as const, value: 4 }
        ]
      },
      {
        kind: "op" as const,
        op: "-" as const,
        args: [
          { kind: "sym" as const, name: "y" },
          { kind: "sym" as const, name: "y" }
        ]
      }
    ]
  };
  const egraphRes = EGraphEqualitySaturationEngine.saturateAndExtract(rawAst);
  assert.equal(egraphRes.formattedExpression, "x");
  assert.ok(egraphRes.optimizedCost < egraphRes.originalCost);

  // 2. Cousot Interval Abstract Interpretation (Widening, Narrowing & Safety Proofs) (Module 158)
  const iv0 = CousotIntervalAbstractInterpreter.interval(0, 0);
  const iv1 = CousotIntervalAbstractInterpreter.interval(0, 1);
  // Widening [0, 0] nabla [0, 1] jumps upper bound to +Infinity!
  const widened = CousotIntervalAbstractInterpreter.widen(iv0, iv1);
  assert.equal(widened.high, Infinity);
  // Narrowing with loop guard [0, 9] refines [0, +Infinity] -> [0, 9]
  const narrowed = CousotIntervalAbstractInterpreter.narrow(
    widened,
    CousotIntervalAbstractInterpreter.interval(0, 9)
  );
  assert.deepEqual(narrowed, { isBottom: false, low: 0, high: 9 });
  assert.equal(
    CousotIntervalAbstractInterpreter.verifyArrayBoundsSafety(narrowed, 10).guaranteedInBounds,
    true
  );
  assert.equal(
    CousotIntervalAbstractInterpreter.verifyDivisionSafety(
      CousotIntervalAbstractInterpreter.interval(2, 10)
    ).safeNeverZero,
    true
  );

  // 3. Cahill Serializable Snapshot Isolation (SSI) Write-Skew Detector (Module 159)
  const db = new DatabaseSync(":memory:");
  const ssi = new CahillSerializableSnapshotIsolationManager(db);
  // Classic Write Skew: T1 reads R1, T2 reads R2; then T1 writes R2 (creating R2: T2 --rw--> T1)
  // and T2 writes R1 (creating R1: T1 --rw--> T2). Both have incoming + outgoing rw edges!
  ssi.recordRead("T1", "oncall:alice");
  ssi.recordRead("T2", "oncall:bob");
  ssi.recordWrite("T1", "oncall:bob");
  ssi.recordWrite("T2", "oncall:alice");
  const commitT1 = ssi.tryCommitTransaction("T1");
  assert.equal(commitT1.committed, false);
  assert.equal(commitT1.errorCode, "SQLSTATE_40001_SERIALIZATION_FAILURE");

  // 4. Vaughan Pratt Top-Down Operator Precedence (TDOP) Parser (Module 160)
  const pratt = new PrattTopDownOperatorPrecedenceParser();
  const ast = pratt.parse("x > 5 ? 2 ^ 3 + 1 : 0");
  assert.equal(PrattTopDownOperatorPrecedenceParser.evaluateAst(ast, { x: 10 }), 9);
  assert.equal(PrattTopDownOperatorPrecedenceParser.evaluateAst(ast, { x: 2 }), 0);

  // 5. Rabiner Forward-Backward (Alpha-Beta) Posterior HMM Marginals (Module 161)
  const fb = ForwardBackwardPosteriorHmmEngine.computeForwardBackwardPosteriors({
    states: ["healthy", "degraded"],
    initialProbabilities: { healthy: 0.8, degraded: 0.2 },
    transitionMatrix: {
      healthy: { healthy: 0.9, degraded: 0.1 },
      degraded: { healthy: 0.2, degraded: 0.8 }
    },
    emissionMatrix: {
      healthy: { ok: 0.9, timeout: 0.1 },
      degraded: { ok: 0.1, timeout: 0.9 }
    },
    observations: ["timeout", "timeout", "timeout"]
  });
  assert.ok((fb.posteriorGammaByStep[2]?.["degraded"] ?? 0) > 0.95);

  // 6. Karmarkar-Karp Differencing & Best-Fit Decreasing Bin Packing (Module 162)
  const kkDiff = KarmarkarKarpAndBinPackingScheduler.computeKarmarkarKarpDiscrepancy([
    10, 8, 7, 6, 5
  ]);
  assert.equal(kkDiff, 2);
  const packed = KarmarkarKarpAndBinPackingScheduler.packBestFitDecreasing(
    [
      { id: "i1", size: 6 },
      { id: "i2", size: 5 },
      { id: "i3", size: 5 },
      { id: "i4", size: 4 }
    ],
    10
  );
  // Optimal packing into capacity 10: Bin 0 = [6, 4], Bin 1 = [5, 5] => 2 bins!
  assert.equal(packed.totalBinsUsed, 2);

  // 7. Edmonds Blossom General Graph Maximum Matching (Module 163)
  // Odd 5-cycle (pentagon) plus a tail edge (n5 - n6): max matching has 3 disjoint edges covering all 6 vertices!
  const blossomRes = GeneralGraphMaximumMatchingEngine.computeMaximumMatching(
    ["n1", "n2", "n3", "n4", "n5", "n6"],
    [
      { u: "n1", v: "n2" },
      { u: "n2", v: "n3" },
      { u: "n3", v: "n4" },
      { u: "n4", v: "n5" },
      { u: "n5", v: "n1" },
      { u: "n5", v: "n6" }
    ]
  );
  assert.equal(blossomRes.matchedEdgeCount, 3);
  assert.equal(blossomRes.unmatchedNodes.length, 0);

  // 8. Preconditioned Conjugate Gradient (PCG) Krylov SPD Solver (Module 164)
  // Solve [[4, 1], [1, 3]] * [x1, x2] = [1, 2] => x1 = 1/11 = 0.090909, x2 = 7/11 = 0.636364
  const pcg = ConjugateGradientKrylovLinearSolver.solveSpdSystem(
    [
      [4, 1],
      [1, 3]
    ],
    [1, 2]
  );
  assert.equal(pcg.converged, true);
  assert.ok(Math.abs(pcg.solutionX[0]! - 1 / 11) < 1e-4);
  assert.ok(Math.abs(pcg.solutionX[1]! - 7 / 11) < 1e-4);

  // 9. Poletto & Sarkar Linear-Scan Register Allocator (Module 165)
  // 3 mutually overlapping intervals with K = 2 registers -> 1 variable must spill!
  const regAlloc = LinearScanAndGraphColoringAllocator.allocateLinearScan(
    [
      { varId: "v1", startStep: 1, endStep: 10 },
      { varId: "v2", startStep: 2, endStep: 8 },
      { varId: "v3", startStep: 3, endStep: 6 }
    ],
    2
  );
  assert.equal(regAlloc.registersUsedCount, 2);
  assert.deepEqual(regAlloc.spilledVariableIds, ["v1"]); // v1 has furthest endStep (10), so v1 spills!

  // 10. Hampel Identifier & Tukey IQR Fence Outlier Filter (Module 166)
  const hampel = HampelIdentifierAndTukeyFenceFilter.filterSeries([
    10, 11, 10, 500, 10, 11, 10
  ]);
  assert.equal(hampel.hampelSpikesReplacedCount, 1);
  assert.equal(hampel.hampelCleanedSeries[3], 11);

  // 11. Vose's Alias Method O(1) Discrete Sampler & Vitter Reservoir (Module 167)
  const aliasSampler = new VoseAliasMethodO1DiscreteSampler([
    { item: "rare", weight: 1 },
    { item: "dominant", weight: 99 }
  ]);
  let dominantHits = 0;
  for (let i = 0; i < 20; i++) {
    if (aliasSampler.sampleO1(i / 20, 0.5) === "dominant") dominantHits++;
  }
  assert.ok(dominantHits >= 18);
  const reservoir = VoseAliasMethodO1DiscreteSampler.reservoirSample(
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    3
  );
  assert.equal(reservoir.length, 3);

  // 12. DGIM Logarithmic-Space Sliding-Window Bit Counter (Module 168)
  const dgim = new DgimSlidingWindowBitCounter(10);
  for (const b of [1, 0, 1, 1, 0, 1, 1, 1] as const) {
    dgim.recordBit(b);
  }
  const dgimEst = dgim.estimateOnesInWindow();
  // True count of 1s is 6; DGIM guarantees <= 50% relative error (in [4..8])
  assert.ok(dgimEst.estimatedOnes >= 4 && dgimEst.estimatedOnes <= 8);

  // 13. Dataflow Low-Watermark Out-of-Order Window Aggregator (Module 169)
  const wmAgg = new DataflowWatermarkWindowAggregator(db, {
    windowSizeMs: 1000,
    allowedLatenessMs: 200
  });
  wmAgg.ingestEvent(1100, 10);
  wmAgg.ingestEvent(1500, 20);
  wmAgg.advanceWatermark(2500); // Window [1000, 2000) + 200ms lateness = 2200 <= 2500 -> closed!
  const lateEvent = wmAgg.ingestEvent(1200, 99);
  assert.equal(lateEvent.routedToLateSideOutput, true);
  assert.equal(wmAgg.lateSideOutputEvents.length, 1);

  // 14. Sorensen-Dice Bigram Similarity & Ukkonen Banded Edit Distance (Module 170)
  const dice = UkkonenApproximateStringAndNGramProfiler.sorensenDiceBigramSimilarity(
    "night",
    "nacht"
  );
  assert.equal(dice, 0.25);
  const ukkWithin = UkkonenApproximateStringAndNGramProfiler.boundedEditDistance(
    "kosmora-kernel",
    "kosmora_kernel",
    2
  );
  assert.equal(ukkWithin.withinThreshold, true);
  assert.equal(ukkWithin.distance, 1);
  const ukkExceeded = UkkonenApproximateStringAndNGramProfiler.boundedEditDistance(
    "kosmora-kernel",
    "completely-different-string",
    2
  );
  assert.equal(ukkExceeded.withinThreshold, false);
});
