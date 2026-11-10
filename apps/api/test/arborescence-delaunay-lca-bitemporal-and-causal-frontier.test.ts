import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

import { ChuLiuEdmondsDirectedMstEngine } from "../../../packages/core/src/chu-liu-edmonds-directed-arborescence.ts";
import { BowyerWatsonDelaunayVoronoiEngine } from "../../../packages/core/src/bowyer-watson-delaunay-voronoi-mesh.ts";
import { EulerTourSparseTableLcaEngine } from "../../../packages/core/src/euler-tour-rmq-sparse-table-lca.ts";
import { PolylineTrajectorySimplifier } from "../../../packages/core/src/ramer-douglas-peucker-visvalingam-simplifier.ts";
import { KleinbergHitsHubsAndAuthoritiesEngine } from "../../../packages/core/src/kleinberg-hits-hubs-authorities.ts";
import { BertsekasEpsilonScalingAuctionEngine } from "../../../packages/core/src/bertsekas-epsilon-auction-assigner.ts";
import { ManacherAndZAlgorithmStringKernel } from "../../../packages/core/src/manacher-z-algorithm-string-kernel.ts";
import { BerlekampMasseyLfsrSynthesizer } from "../../../packages/core/src/berlekamp-massey-lfsr-synthesizer.ts";
import { BrentCycleAndPollardRhoEngine } from "../../../packages/core/src/brent-cycle-pollard-rho-factorizer.ts";
import { GearFastContentDefinedChunker } from "../../../packages/core/src/fastcdc-gear-content-defined-chunker.ts";
import { SubmodularMarkovRandomFieldGraphCut } from "../../../packages/core/src/mrf-binary-submodular-graph-cut.ts";
import { Bm25PlusAndSpanProximityRanker } from "../../../packages/core/src/soft-tfidf-bm25-plus-proximity-scorer.ts";
import { BitemporalValidAndTransactionTimeStore } from "../../../packages/db/src/bitemporal-valid-transaction-time-store.ts";
import { CausalBroadcastVectorClockBuffer } from "../../../packages/db/src/birman-schiper-stephenson-causal-broadcast.ts";

test("Phase 20: Chu-Liu/Edmonds Arborescence, Bowyer-Watson Delaunay/Voronoi, Euler-Tour O(1) LCA, RDP/Visvalingam, Kleinberg HITS, Bertsekas Auction, Manacher/Z, Berlekamp-Massey, Brent/Pollard-Rho, FastCDC, MRF Graph-Cut, BM25+, SQLite Bitemporal & Causal Broadcast Frontier (Modules 205-218)", () => {
  // 1. Chu-Liu / Edmonds Directed Minimum Spanning Arborescence (Module 205)
  // Root R has edges to A (10) and B (2). A<->B form a cheap cycle (A->B=1, B->A=1), B->C=3.
  // Optimal arborescence picks R->B (2), B->A (1), B->C (3) => total weight = 6!
  const arb = ChuLiuEdmondsDirectedMstEngine.computeMinDirectedArborescence(
    ["R", "A", "B", "C"],
    "R",
    [
      { from: "R", to: "A", weight: 10 },
      { from: "R", to: "B", weight: 2 },
      { from: "A", to: "B", weight: 1 },
      { from: "B", to: "A", weight: 1 },
      { from: "B", to: "C", weight: 3 },
      { from: "A", to: "C", weight: 9 }
    ]
  );
  assert.equal(arb.reachableAll, true);
  assert.equal(arb.totalArborescenceWeight, 6);

  // 2. Bowyer-Watson Delaunay Triangulation & Dual Voronoi Mesh (Module 206)
  const del = BowyerWatsonDelaunayVoronoiEngine.triangulate([
    { id: "p0", x: 0, y: 0 },
    { id: "p1", x: 10, y: 0 },
    { id: "p2", x: 0, y: 10 },
    { id: "p3", x: 10, y: 10 },
    { id: "p4", x: 5, y: 4 }
  ]);
  assert.equal(del.triangles.length, 4);
  assert.equal(del.emptyCircumcirclePropertyVerified, true);
  assert.equal(del.voronoiDualEdges.length, 4);

  // 3. Euler Tour + Sparse Table O(1) Lowest Common Ancestor (Module 207)
  const lca = new EulerTourSparseTableLcaEngine("root", {
    root: ["a", "b"],
    a: ["a1", "a2"],
    b: ["b1"]
  });
  assert.equal(lca.queryLcaO1("a1", "a2"), "a");
  assert.equal(lca.queryLcaO1("a1", "b1"), "root");
  assert.equal(lca.queryTreeDistanceO1("a1", "b1"), 4);

  // 4. Ramer-Douglas-Peucker & Visvalingam-Whyatt Polyline Simplifier (Module 208)
  const collinearNoise = [
    { x: 0, y: 0 },
    { x: 2, y: 0.01 },
    { x: 5, y: -0.01 },
    { x: 10, y: 0 }
  ];
  const rdp = PolylineTrajectorySimplifier.simplifyRamerDouglasPeucker(collinearNoise, 0.1);
  assert.equal(rdp.length, 2);
  const vw = PolylineTrajectorySimplifier.simplifyVisvalingamWhyatt(collinearNoise, 2);
  assert.equal(vw.length, 2);

  // 5. Kleinberg HITS Hubs & Authorities (Module 209)
  const hits = KleinbergHitsHubsAndAuthoritiesEngine.computeHubsAndAuthorities(
    ["hub_master", "h2", "auth_master", "a2"],
    [
      { from: "hub_master", to: "auth_master" },
      { from: "hub_master", to: "a2" },
      { from: "h2", to: "auth_master" }
    ]
  );
  assert.equal(hits.topHubNode, "hub_master");
  assert.equal(hits.topAuthorityNode, "auth_master");

  // 6. Bertsekas Epsilon-Scaling Auction Assignment (Module 210)
  const auction = BertsekasEpsilonScalingAuctionEngine.solveMaximumBenefitAssignment([
    [10, 2, 1],
    [3, 15, 4],
    [1, 5, 20]
  ]);
  assert.equal(auction.totalBenefitValue, 45);
  assert.deepEqual(auction.agentToItemAssignment, [0, 1, 2]);

  // 7. Manacher O(N) Longest Palindrome & Z-Algorithm Pattern Kernel (Module 211)
  const pal = ManacherAndZAlgorithmStringKernel.longestPalindromicSubstring("xyz_racecar_abc");
  assert.equal(pal.palindrome, "_racecar_");
  const zHits = ManacherAndZAlgorithmStringKernel.findExactPatternOccurrencesZ(
    "kosmora_ab_kosmora",
    "kosmora"
  );
  assert.deepEqual(zHits, [0, 11]);

  // 8. Berlekamp-Massey Shortest LFSR Synthesizer (Module 212)
  // Fibonacci recurrence: s_n = s_{n-1} + s_{n-2} => [1, 1, 2, 3, 5, 8, 13, 21]
  const lfsr = BerlekampMasseyLfsrSynthesizer.synthesizeShortestLfsr(
    [1, 1, 2, 3, 5, 8],
    10007,
    2
  );
  assert.equal(lfsr.linearComplexityL, 2);
  assert.deepEqual(lfsr.predictedNextTerms, [13, 21]);

  // 9. Brent's Cycle Detector & Pollard's Rho Integer Factorizer (Module 213)
  const cycle = BrentCycleAndPollardRhoEngine.detectCycleBrent(0, (x) => {
    const map = [1, 2, 3, 4, 5, 2]; // 0 -> 1 -> 2 -> 3 -> 4 -> 5 -> 2 (mu=2, lambda=4)
    return map[x]!;
  });
  assert.equal(cycle.tailLengthMu, 2);
  assert.equal(cycle.cyclePeriodLambda, 4);
  const factors = BrentCycleAndPollardRhoEngine.factorizePollardRho(10403n); // 101 * 103
  assert.deepEqual(factors, [101n, 103n]);

  // 10. FastCDC Gear-Hash Content-Defined Chunker (Module 214)
  const payload = new Uint8Array(400);
  for (let i = 0; i < 400; i++) payload[i] = (i * 73 + 19) & 0xff;
  const chunks = GearFastContentDefinedChunker.chunkBuffer(payload, {
    minSize: 32,
    normalSize: 64,
    maxSize: 128
  });
  assert.ok(chunks.length >= 4);
  assert.equal(
    chunks.reduce((acc, c) => acc + c.length, 0),
    400
  );

  // 11. Submodular Markov Random Field (MRF) Binary Energy Minimizer (Module 215)
  const mrf = SubmodularMarkovRandomFieldGraphCut.minimizeBinaryEnergy(
    [
      { nodeId: "p1", costLabel0: 0, costLabel1: 10 },
      { nodeId: "p2", costLabel0: 2, costLabel1: 0 }, // prefers 1 slightly, but neighbors p1 & p3 strongly prefer 0!
      { nodeId: "p3", costLabel0: 0, costLabel1: 10 }
    ],
    [
      { u: "p1", v: "p2", disagreementPenaltyLambda: 5 },
      { u: "p2", v: "p3", disagreementPenaltyLambda: 5 }
    ]
  );
  // Smoothing flips p2 to 0 (cost=2) instead of paying 5+5=10 discontinuity penalty!
  assert.deepEqual(mrf.optimalLabelsByNode, { p1: 0, p2: 0, p3: 0 });
  assert.equal(mrf.minimumTotalEnergy, 2);

  // 12. BM25+ & Span Proximity Ranker (Module 216)
  const ranked = Bm25PlusAndSpanProximityRanker.rankDocuments(
    [
      { docId: "far_doc", text: "kosmora system uses many layers before kernel execution" },
      { docId: "adjacent_doc", text: "kosmora kernel execution is deterministic" }
    ],
    "kosmora kernel"
  );
  assert.equal(ranked[0]!.docId, "adjacent_doc");

  // 13. Snodgrass SQL:2011 Bitemporal Valid-Time & Transaction-Time Store (Module 217)
  const db = new DatabaseSync(":memory:");
  const bitemp = new BitemporalValidAndTransactionTimeStore(db);
  // At tx=100, record salary=100k valid for [1000, 3000)
  bitemp.upsertValidPeriod({
    entityKey: "emp:alice",
    payloadValue: "100k",
    validFromMs: 1000,
    validToMs: 3000,
    txNowMs: 100
  });
  // At tx=200, retroactively update salary=120k valid for [2000, 3000)
  bitemp.upsertValidPeriod({
    entityKey: "emp:alice",
    payloadValue: "120k",
    validFromMs: 2000,
    validToMs: 3000,
    txNowMs: 200
  });
  assert.equal(bitemp.queryAsOf("emp:alice", 2500, 150)?.payloadValue, "100k");
  assert.equal(bitemp.queryAsOf("emp:alice", 2500, 250)?.payloadValue, "120k");
  assert.equal(bitemp.queryAsOf("emp:alice", 1500, 250)?.payloadValue, "100k");

  // 14. Birman-Schiper-Stephenson Vector-Clock Causal Broadcast Buffer (Module 218)
  const bss = new CausalBroadcastVectorClockBuffer(db, ["N1", "N2"]);
  // Message m2 (N1=2) arrives BEFORE m1 (N1=1) -> must be buffered!
  const delivEarly = bss.receiveMessage({
    messageId: "m2",
    senderNodeId: "N1",
    vectorClock: { N1: 2, N2: 0 },
    payload: "second"
  });
  assert.equal(delivEarly.length, 0);
  // Now m1 (N1=1) arrives -> delivers m1 AND unblocks m2 in causal order!
  const delivBoth = bss.receiveMessage({
    messageId: "m1",
    senderNodeId: "N1",
    vectorClock: { N1: 1, N2: 0 },
    payload: "first"
  });
  assert.deepEqual(
    delivBoth.map((m) => m.messageId),
    ["m1", "m2"]
  );
});
