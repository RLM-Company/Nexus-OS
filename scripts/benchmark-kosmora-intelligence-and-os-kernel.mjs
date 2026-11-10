#!/usr/bin/env node
/**
 * Monumental Benchmark & SLA Verification Harness for the 252-Module Post-Cutoff
 * Kosmora Applied Intelligence, Autonomous OS Kernel & Full Frontier Package.
 */
import { performance } from "node:perf_hooks";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ts } from "./offline-typescript.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temp = mkdtempSync(join(tmpdir(), "kosmora-monumental-bench-"));

function emitTs(sourceRel, targetRel) {
  let code = ts.transpileModule(readFileSync(resolve(root, sourceRel), "utf8"), {
    fileName: sourceRel,
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
  }).outputText;

  const sqliteShimUrl = pathToFileURL(resolve(root, "scripts/offline-typescript.mjs")).href;
  code = code.replace(/from\s+["']node:sqlite["']/g, `from "${sqliteShimUrl}"`);
  code = code.replace(/\.ts(["'])/g, ".js$1");

  const outPath = join(temp, targetRel);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, code, "utf8");
}

try {
  writeFileSync(join(temp, "package.json"), '{"type":"module"}\n', "utf8");

  const sources = [
    "packages/core/src/neuro-symbolic-constraint-solver.ts",
    "packages/core/src/personalized-pagerank-subgraph-extractor.ts",
    "packages/core/src/bpe-vocabulary-trainer.ts",
    "packages/core/src/macaroon-capability-tokens.ts",
    "packages/db/src/suffix-array-substring-index.ts",
    "packages/core/src/aho-corasick-scanner.ts",
    "packages/core/src/hnsw-vector-index.ts",
    "packages/core/src/auction-hungarian-task-assigner.ts",
    "packages/core/src/linucb-contextual-bandit.ts",
    "packages/core/src/reed-solomon-erasure-coder.ts",
    "packages/core/src/bloom-cuckoo-xor-filter.ts",
    "packages/core/src/spectral-fiedler-graph-partitioner.ts",
    "packages/core/src/vickrey-clarke-groves-mechanism.ts",
    "packages/core/src/hindley-milner-type-inference.ts",
    "packages/core/src/simplex-linear-programming-solver.ts",
    "packages/core/src/robdd-binary-decision-diagram.ts",
    "packages/core/src/suffix-automaton-sam-dawg.ts",
    "packages/core/src/cooley-tukey-fft-periodogram.ts",
    "packages/core/src/hopcroft-karp-bipartite-matching.ts",
    "packages/core/src/egraph-equality-saturation-optimizer.ts",
    "packages/core/src/conjugate-gradient-krylov-solver.ts",
    "packages/core/src/shamir-lagrange-secret-sharing.ts",
    "packages/core/src/fractional-cascading-multi-catalog-search.ts",
    "packages/core/src/schnorr-pedersen-zkp-commitment.ts",
    "packages/core/src/stoer-wagner-global-min-cut.ts",
    "packages/core/src/chu-liu-edmonds-directed-arborescence.ts",
    "packages/core/src/bowyer-watson-delaunay-voronoi-mesh.ts",
    "packages/core/src/paillier-additive-homomorphic-crypto.ts",
    "packages/core/src/householder-qr-least-squares-solver.ts",
    "packages/core/src/elgamal-chaum-pedersen-dleq-verifier.ts",
    "packages/core/src/grossi-vitter-wavelet-tree-rank-select.ts"
  ];
  for (const s of sources) {
    emitTs(s, s.replace(/\.ts$/, ".js"));
  }

  const { NeuroSymbolicConstraintSolver } = await import(
    pathToFileURL(join(temp, "packages/core/src/neuro-symbolic-constraint-solver.js")).href
  );
  const { PersonalizedPageRankSubgraphExtractor } = await import(
    pathToFileURL(join(temp, "packages/core/src/personalized-pagerank-subgraph-extractor.js")).href
  );
  const { BpeVocabularyTrainer } = await import(
    pathToFileURL(join(temp, "packages/core/src/bpe-vocabulary-trainer.js")).href
  );
  const { MacaroonCapabilityEngine } = await import(
    pathToFileURL(join(temp, "packages/core/src/macaroon-capability-tokens.js")).href
  );
  const { SuffixArraySubstringIndex } = await import(
    pathToFileURL(join(temp, "packages/db/src/suffix-array-substring-index.js")).href
  );
  const { AhoCorasickAutomaton } = await import(
    pathToFileURL(join(temp, "packages/core/src/aho-corasick-scanner.js")).href
  );
  const { HnswHierarchicalVectorIndex } = await import(
    pathToFileURL(join(temp, "packages/core/src/hnsw-vector-index.js")).href
  );
  const { HungarianKuhnMunkresAssigner } = await import(
    pathToFileURL(join(temp, "packages/core/src/auction-hungarian-task-assigner.js")).href
  );
  const { ReedSolomonGaloisErasureCoder } = await import(
    pathToFileURL(join(temp, "packages/core/src/reed-solomon-erasure-coder.js")).href
  );
  const { XorFilterStaticMembershipIndex } = await import(
    pathToFileURL(join(temp, "packages/core/src/bloom-cuckoo-xor-filter.js")).href
  );
  const { SpectralFiedlerGraphPartitioner } = await import(
    pathToFileURL(join(temp, "packages/core/src/spectral-fiedler-graph-partitioner.js")).href
  );
  const { VcgTruthfulMechanismAuction } = await import(
    pathToFileURL(join(temp, "packages/core/src/vickrey-clarke-groves-mechanism.js")).href
  );
  const { HindleyMilnerAlgorithmWTypeEngine } = await import(
    pathToFileURL(join(temp, "packages/core/src/hindley-milner-type-inference.js")).href
  );
  const { DantzigSimplexLinearProgramSolver } = await import(
    pathToFileURL(join(temp, "packages/core/src/simplex-linear-programming-solver.js")).href
  );
  const { ReducedOrderedBinaryDecisionDiagram } = await import(
    pathToFileURL(join(temp, "packages/core/src/robdd-binary-decision-diagram.js")).href
  );
  const { SuffixAutomatonDirectedWordGraph } = await import(
    pathToFileURL(join(temp, "packages/core/src/suffix-automaton-sam-dawg.js")).href
  );
  const { CooleyTukeyFftAndWelchPeriodogram } = await import(
    pathToFileURL(join(temp, "packages/core/src/cooley-tukey-fft-periodogram.js")).href
  );
  const { HopcroftKarpMaximumMatchingEngine } = await import(
    pathToFileURL(join(temp, "packages/core/src/hopcroft-karp-bipartite-matching.js")).href
  );
  const { EGraphEqualitySaturationEngine } = await import(
    pathToFileURL(join(temp, "packages/core/src/egraph-equality-saturation-optimizer.js")).href
  );
  const { ConjugateGradientKrylovLinearSolver } = await import(
    pathToFileURL(join(temp, "packages/core/src/conjugate-gradient-krylov-solver.js")).href
  );
  const { ShamirLagrangeSecretSharingEngine } = await import(
    pathToFileURL(join(temp, "packages/core/src/shamir-lagrange-secret-sharing.js")).href
  );
  const { FractionalCascadingCatalogIndex } = await import(
    pathToFileURL(join(temp, "packages/core/src/fractional-cascading-multi-catalog-search.js")).href
  );
  const { SchnorrZkpAndPedersenCommitmentEngine } = await import(
    pathToFileURL(join(temp, "packages/core/src/schnorr-pedersen-zkp-commitment.js")).href
  );
  const { StoerWagnerGlobalMinCutEngine } = await import(
    pathToFileURL(join(temp, "packages/core/src/stoer-wagner-global-min-cut.js")).href
  );
  const { ChuLiuEdmondsDirectedMstEngine } = await import(
    pathToFileURL(join(temp, "packages/core/src/chu-liu-edmonds-directed-arborescence.js")).href
  );
  const { BowyerWatsonDelaunayVoronoiEngine } = await import(
    pathToFileURL(join(temp, "packages/core/src/bowyer-watson-delaunay-voronoi-mesh.js")).href
  );
  const { PaillierHomomorphicEncryptionEngine } = await import(
    pathToFileURL(join(temp, "packages/core/src/paillier-additive-homomorphic-crypto.js")).href
  );
  const { HouseholderQrLeastSquaresSolver } = await import(
    pathToFileURL(join(temp, "packages/core/src/householder-qr-least-squares-solver.js")).href
  );
  const { ElGamalAndChaumPedersenDleqEngine } = await import(
    pathToFileURL(join(temp, "packages/core/src/elgamal-chaum-pedersen-dleq-verifier.js")).href
  );
  const { WaveletTreeRankSelectQuantileIndex } = await import(
    pathToFileURL(join(temp, "packages/core/src/grossi-vitter-wavelet-tree-rank-select.js")).href
  );

  const rows = [];

  // 1. Neuro-Symbolic CSP Solver Latency
  const t0 = performance.now();
  const cspRes = NeuroSymbolicConstraintSolver.solve({
    variables: [
      { name: "v1", domain: [1, 2, 3, 4, 5] },
      { name: "v2", domain: [2, 4, 6, 8, 10] },
      { name: "v3", domain: [5, 10, 15, 20] }
    ],
    constraints: [
      { kind: "all_different", variables: ["v1", "v2", "v3"] },
      { kind: "precedence", beforeVar: "v1", afterVar: "v2", minGap: 3 },
      { kind: "precedence", beforeVar: "v2", afterVar: "v3", minGap: 5 }
    ],
    objective: { direction: "minimize", weights: { v3: 1 } }
  });
  const cspMs = performance.now() - t0;
  rows.push({
    Module: "Neuro-Symbolic CSP/SMT Solver",
    Observed: `${cspMs.toFixed(2)} ms`,
    TargetSLA: "< 25.0 ms",
    Status: cspRes.satisfiable && cspMs < 25 ? "PASS" : "FAIL"
  });

  // 2. Personalized PageRank 25-Iteration Power Walk
  const t1 = performance.now();
  const edges = Array.from({ length: 40 }, (_, i) => ({
    source: `node_${i}`,
    target: `node_${(i + 1) % 25}`,
    relation: "links",
    weight: 1.0
  }));
  const pprRes = PersonalizedPageRankSubgraphExtractor.extractSubgraph({
    edges,
    seedNodeIds: ["node_0", "node_10"],
    iterations: 25,
    topK: 6
  });
  const pprMs = performance.now() - t1;
  rows.push({
    Module: "GraphRAG Personalized PageRank (25 iters)",
    Observed: `${pprMs.toFixed(2)} ms`,
    TargetSLA: "< 30.0 ms",
    Status: pprRes.topNodes.length === 6 && pprMs < 30 ? "PASS" : "FAIL"
  });

  // 3. Macaroon Chained HMAC Verification Throughput
  const t2 = performance.now();
  const mac = MacaroonCapabilityEngine.mintRootMacaroon({
    rootSecretKey: "bench_key_2026",
    identifier: "mac_bench",
    initialCaveats: [
      { predicate: "owner_id", value: "owner_1" },
      { predicate: "read_only", value: "true" }
    ]
  });
  for (let i = 0; i < 500; i++) {
    MacaroonCapabilityEngine.verifyMacaroon({
      rootSecretKey: "bench_key_2026",
      token: mac,
      context: {
        ownerId: "owner_1",
        requestedTool: "vault_read",
        isMutatingTool: false,
        nowMs: 1000
      }
    });
  }
  const macOpsPerSec = Math.round(500 / ((performance.now() - t2) / 1000));
  rows.push({
    Module: "Zero-Trust Macaroon HMAC Verifier",
    Observed: `${macOpsPerSec} verifications/sec`,
    TargetSLA: "> 5,000 verifications/sec",
    Status: macOpsPerSec > 5000 ? "PASS" : "FAIL"
  });

  // 4. Suffix Array + Kasai LCP Construction & Search
  const t3 = performance.now();
  const corpus = "function verifyStage2Invariants(sqlite) { return sqlite.prepare(sql).all(); }\n".repeat(
    25
  );
  const sa = new SuffixArraySubstringIndex("bench_corpus", corpus);
  const matches = sa.searchSubstring("sqlite.prepare(sql).all()");
  const saMs = performance.now() - t3;
  rows.push({
    Module: "Suffix Array + Kasai LCP Search",
    Observed: `${saMs.toFixed(2)} ms (${matches.length} hits)`,
    TargetSLA: "< 50.0 ms",
    Status: matches.length === 25 && saMs < 50 ? "PASS" : "FAIL"
  });

  // 5. BPE Subword Training & Lossless Round-Trip
  const t4 = performance.now();
  const bpe = new BpeVocabularyTrainer();
  bpe.train(corpus.slice(0, 600), 20);
  const enc = bpe.encode("verifyStage2Invariants(sqlite)");
  const dec = bpe.decode(enc);
  const bpeMs = performance.now() - t4;
  rows.push({
    Module: "BPE Subword Trainer & Lossless Codec",
    Observed: `${bpeMs.toFixed(2)} ms`,
    TargetSLA: "< 50.0 ms",
    Status: dec === "verifyStage2Invariants(sqlite)" && bpeMs < 50 ? "PASS" : "FAIL"
  });

  // 6. Aho-Corasick Multi-Pattern Automaton Scan (Phase 10)
  const t5 = performance.now();
  const ac = new AhoCorasickAutomaton([
    { id: "p1", keyword: "sqlite.prepare", category: "sql" },
    { id: "p2", keyword: "verifystage2invariants", category: "fn" }
  ]);
  const acHits = ac.scan(corpus);
  const acMs = performance.now() - t5;
  rows.push({
    Module: "Aho-Corasick Multi-Pattern Automaton",
    Observed: `${acMs.toFixed(2)} ms (${acHits.length} hits)`,
    TargetSLA: "< 25.0 ms",
    Status: acHits.length === 50 && acMs < 25 ? "PASS" : "FAIL"
  });

  // 7. HNSW Multi-Layer Proximity Vector Index & Hungarian Assigner (Phase 11)
  const t6 = performance.now();
  const hnsw = new HnswHierarchicalVectorIndex({ maxConnectionsPerLayer: 6, efConstruction: 12 });
  for (let i = 0; i < 40; i++) {
    hnsw.insert({
      id: `vec_${i}`,
      vector: [Math.cos(i * 0.1), Math.sin(i * 0.1), (i % 5) * 0.2, 1.0]
    });
  }
  const knn = hnsw.searchKnn([1.0, 0.0, 0.0, 1.0], 3);
  const hung = HungarianKuhnMunkresAssigner.solveMinimumCostAssignment([
    [10, 19, 8, 15],
    [10, 18, 7, 17],
    [13, 16, 9, 14],
    [12, 19, 8, 18]
  ]);
  const hnswMs = performance.now() - t6;
  rows.push({
    Module: "HNSW Vector ANN + Kuhn-Munkres Assigner",
    Observed: `${hnswMs.toFixed(2)} ms (cost=${hung.totalMinimumCost})`,
    TargetSLA: "< 40.0 ms",
    Status: knn.length === 3 && hung.totalMinimumCost === 49 && hnswMs < 40 ? "PASS" : "FAIL"
  });

  // 8. Reed-Solomon GF(2^8) Erasure Recovery + 16-Bit Xor Filter (Phase 12)
  const t7 = performance.now();
  const rs = new ReedSolomonGaloisErasureCoder(4, 2);
  const rsEncoded = rs.encodePayload(new TextEncoder().encode(corpus));
  const rsRecovered = rs.reconstructPayload(
    [null, rsEncoded.shards[1], null, rsEncoded.shards[3], rsEncoded.shards[4], rsEncoded.shards[5]],
    rsEncoded.originalByteLength
  );
  const xorFilter = new XorFilterStaticMembershipIndex(
    Array.from({ length: 60 }, (_, i) => `key_${i}`)
  );
  const rsMs = performance.now() - t7;
  rows.push({
    Module: "Reed-Solomon GF(2^8) + 16-Bit Xor Filter",
    Observed: `${rsMs.toFixed(2)} ms`,
    TargetSLA: "< 45.0 ms",
    Status:
      rsRecovered.length === rsEncoded.originalByteLength &&
      xorFilter.mightContain("key_42") &&
      rsMs < 45
        ? "PASS"
        : "FAIL"
  });

  // 9. Spectral Fiedler Graph Partitioner + VCG Truthful Auction (Phase 13)
  const t8 = performance.now();
  const specPart = SpectralFiedlerGraphPartitioner.partitionGraph({
    nodes: ["a1", "a2", "a3", "b1", "b2", "b3"],
    undirectedEdges: [
      { u: "a1", v: "a2", weight: 5 },
      { u: "a2", v: "a3", weight: 5 },
      { u: "a1", v: "a3", weight: 5 },
      { u: "b1", v: "b2", weight: 5 },
      { u: "b2", v: "b3", weight: 5 },
      { u: "b1", v: "b3", weight: 5 },
      { u: "a3", v: "b1", weight: 0.2 }
    ]
  });
  const vcgRes = VcgTruthfulMechanismAuction.runTruthfulAuction(
    [
      { bidderId: "b1", unitsRequested: 2, valuationValue: 120 },
      { bidderId: "b2", unitsRequested: 2, valuationValue: 90 }
    ],
    2
  );
  const p13Ms = performance.now() - t8;
  rows.push({
    Module: "Spectral Fiedler Bisection + VCG Auction",
    Observed: `${p13Ms.toFixed(2)} ms (tax=${vcgRes.totalRevenueCollected})`,
    TargetSLA: "< 35.0 ms",
    Status:
      specPart.clusterA.length === 3 &&
      vcgRes.totalRevenueCollected === 90 &&
      p13Ms < 35
        ? "PASS"
        : "FAIL"
  });

  // 10. Hindley-Milner Type Inference + Dantzig Simplex LP Solver (Phase 14)
  const t9 = performance.now();
  const hm = new HindleyMilnerAlgorithmWTypeEngine();
  const hmType = hm.inferExpressionType({
    kind: "let",
    name: "id",
    value: { kind: "abs", param: "x", body: { kind: "var", name: "x" } },
    body: {
      kind: "app",
      fn: { kind: "var", name: "id" },
      arg: { kind: "lit_int", value: 7 }
    }
  });
  const lpRes = DantzigSimplexLinearProgramSolver.solveMaximization({
    objectiveCoefficientsC: [3, 5],
    constraintMatrixA: [
      [1, 0],
      [0, 2],
      [3, 2]
    ],
    constraintRhsB: [4, 12, 18]
  });
  const p14Ms = performance.now() - t9;
  rows.push({
    Module: "Hindley-Milner W + Dantzig Simplex LP",
    Observed: `${p14Ms.toFixed(2)} ms (opt=${lpRes.optimalObjectiveValue})`,
    TargetSLA: "< 30.0 ms",
    Status:
      hmType.formattedType === "Int" &&
      lpRes.optimalObjectiveValue === 36 &&
      p14Ms < 30
        ? "PASS"
        : "FAIL"
  });

  // 11. Canonical ROBDD #SAT + Suffix Automaton SAM (Phase 15)
  const t10 = performance.now();
  const bdd = new ReducedOrderedBinaryDecisionDiagram(["x1", "x2", "x3", "x4"]);
  const bddRoot = bdd.compileFormula({
    kind: "and",
    left: {
      kind: "or",
      left: { kind: "var", name: "x1" },
      right: { kind: "var", name: "x2" }
    },
    right: {
      kind: "or",
      left: { kind: "var", name: "x3" },
      right: { kind: "var", name: "x4" }
    }
  });
  const satCount = bdd.countSatisfyingAssignments(bddRoot); // 3 * 3 = 9
  const sam = new SuffixAutomatonDirectedWordGraph("KOSMORA_KERNEL_SAM_VERIFICATION");
  const distinctSub = sam.countDistinctSubstrings();
  const p15Ms = performance.now() - t10;
  rows.push({
    Module: "Canonical ROBDD #SAT + Suffix Automaton",
    Observed: `${p15Ms.toFixed(2)} ms (#SAT=${satCount}, sub=${distinctSub})`,
    TargetSLA: "< 30.0 ms",
    Status: satCount === 9 && distinctSub > 400 && p15Ms < 30 ? "PASS" : "FAIL"
  });

  // 12. Cooley-Tukey 64-Point FFT/IFFT + Hopcroft-Karp Matching (Phase 16)
  const t11 = performance.now();
  const wave64 = Array.from({ length: 64 }, (_, n) => Math.cos((2 * Math.PI * n) / 8));
  const fft64 = CooleyTukeyFftAndWelchPeriodogram.analyzePeriodicity(wave64);
  const hkRes = HopcroftKarpMaximumMatchingEngine.computeMaximumMatchingAndVertexCover({
    leftNodes: ["u1", "u2", "u3", "u4"],
    rightNodes: ["v1", "v2", "v3", "v4"],
    edges: [
      { left: "u1", right: "v1" },
      { left: "u2", right: "v2" },
      { left: "u3", right: "v3" },
      { left: "u4", right: "v4" }
    ]
  });
  const p16Ms = performance.now() - t11;
  rows.push({
    Module: "Cooley-Tukey FFT + Hopcroft-Karp Matching",
    Observed: `${p16Ms.toFixed(2)} ms (period=${fft64.dominantPeriodSamples}, M=${hkRes.maximumMatchingSize})`,
    TargetSLA: "< 30.0 ms",
    Status:
      fft64.dominantPeriodSamples === 8 &&
      hkRes.maximumMatchingSize === 4 &&
      p16Ms < 30
        ? "PASS"
        : "FAIL"
  });

  // 13. E-Graph Equality Saturation + Preconditioned Krylov PCG (Phase 17)
  const t12 = performance.now();
  const eqRes = EGraphEqualitySaturationEngine.saturateAndExtract({
    kind: "op",
    op: "+",
    args: [
      {
        kind: "op",
        op: "/",
        args: [
          {
            kind: "op",
            op: "*",
            args: [
              { kind: "sym", name: "x" },
              { kind: "num", value: 4 }
            ]
          },
          { kind: "num", value: 4 }
        ]
      },
      {
        kind: "op",
        op: "-",
        args: [
          { kind: "sym", name: "y" },
          { kind: "sym", name: "y" }
        ]
      }
    ]
  });
  const pcgRes = ConjugateGradientKrylovLinearSolver.solveSpdSystem(
    [
      [4, 1],
      [1, 3]
    ],
    [1, 2]
  );
  const p17Ms = performance.now() - t12;
  rows.push({
    Module: "E-Graph EqSat + Preconditioned Krylov PCG",
    Observed: `${p17Ms.toFixed(2)} ms (cost=${eqRes.optimizedCost}, res=${pcgRes.residualNorm.toExponential(1)})`,
    TargetSLA: "< 30.0 ms",
    Status:
      eqRes.formattedExpression === "x" &&
      pcgRes.converged &&
      p17Ms < 30
        ? "PASS"
        : "FAIL"
  });

  // 14. Shamir GF(2^61-1) Secret Sharing + Fractional Cascading (Phase 18)
  const t13 = performance.now();
  const secretVal = 424242424242424242n;
  const shamirSplit = ShamirLagrangeSecretSharingEngine.splitSecret(secretVal, 4, 7);
  const shamirRec = ShamirLagrangeSecretSharingEngine.reconstructSecret(
    shamirSplit.shares.slice(0, 4)
  );
  const fcIndex = new FractionalCascadingCatalogIndex([
    [10, 20, 30, 40, 50],
    [5, 15, 25, 35, 45],
    [12, 22, 32, 42, 52],
    [8, 18, 28, 38, 48]
  ]);
  const fcQuery = fcIndex.queryLowerBounds(26);
  const p18Ms = performance.now() - t13;
  rows.push({
    Module: "Shamir GF(2^61-1) + Fractional Cascading",
    Observed: `${p18Ms.toFixed(2)} ms (k=4/7, layers=${fcQuery.lowerBoundPerCatalog.length})`,
    TargetSLA: "< 30.0 ms",
    Status:
      shamirRec === secretVal &&
      fcQuery.lowerBoundPerCatalog.length === 4 &&
      p18Ms < 30
        ? "PASS"
        : "FAIL"
  });

  // 15. Schnorr ZKP / Pedersen Commitment + Stoer-Wagner Global Min-Cut (Phase 19)
  const t14 = performance.now();
  const zkp = SchnorrZkpAndPedersenCommitmentEngine.createSchnorrProof(
    777777777n,
    999999999n,
    "bench-zkp"
  );
  const zkpOk = SchnorrZkpAndPedersenCommitmentEngine.verifySchnorrProof(zkp, "bench-zkp");
  const swRes = StoerWagnerGlobalMinCutEngine.computeGlobalMinCut(
    ["A", "B", "C", "D"],
    [
      { u: "A", v: "B", weight: 10 },
      { u: "C", v: "D", weight: 10 },
      { u: "B", v: "C", weight: 2 }
    ]
  );
  const p19Ms = performance.now() - t14;
  rows.push({
    Module: "Schnorr ZKP + Stoer-Wagner Global Min-Cut",
    Observed: `${p19Ms.toFixed(2)} ms (zkp=${zkpOk}, cut=${swRes.minCutWeight})`,
    TargetSLA: "< 30.0 ms",
    Status: zkpOk && swRes.minCutWeight === 2 && p19Ms < 30 ? "PASS" : "FAIL"
  });

  // 16. Chu-Liu/Edmonds Arborescence + Bowyer-Watson Delaunay/Voronoi (Phase 20)
  const t15 = performance.now();
  const arbRes = ChuLiuEdmondsDirectedMstEngine.computeMinDirectedArborescence(
    ["R", "A", "B"],
    "R",
    [
      { from: "R", to: "A", weight: 5 },
      { from: "A", to: "B", weight: 1 },
      { from: "B", to: "A", weight: 1 },
      { from: "R", to: "B", weight: 2 }
    ]
  );
  const delRes = BowyerWatsonDelaunayVoronoiEngine.triangulate([
    { id: "p0", x: 0, y: 0 },
    { id: "p1", x: 10, y: 0 },
    { id: "p2", x: 0, y: 10 },
    { id: "p3", x: 10, y: 10 }
  ]);
  const p20Ms = performance.now() - t15;
  rows.push({
    Module: "Chu-Liu Arborescence + Delaunay/Voronoi",
    Observed: `${p20Ms.toFixed(2)} ms (w=${arbRes.totalArborescenceWeight}, tris=${delRes.triangles.length})`,
    TargetSLA: "< 30.0 ms",
    Status:
      arbRes.totalArborescenceWeight === 3 &&
      delRes.emptyCircumcirclePropertyVerified &&
      p20Ms < 30
        ? "PASS"
        : "FAIL"
  });

  // 17. Paillier Homomorphic Crypto + Householder QR Least-Squares (Phase 21)
  const t16 = performance.now();
  const pk = PaillierHomomorphicEncryptionEngine.generateKeyPairFromPrimes(104729n, 104723n);
  const cSum = PaillierHomomorphicEncryptionEngine.homomorphicAddCiphertexts(
    pk,
    PaillierHomomorphicEncryptionEngine.encrypt(pk, 1250n, 19n),
    PaillierHomomorphicEncryptionEngine.encrypt(pk, 3750n, 23n)
  );
  const decSum = PaillierHomomorphicEncryptionEngine.decrypt(pk, cSum);
  const qrRes = HouseholderQrLeastSquaresSolver.solveLeastSquaresQr(
    [
      [1, 0],
      [1, 1],
      [1, 2]
    ],
    [2, 5, 8]
  );
  const p21Ms = performance.now() - t16;
  rows.push({
    Module: "Paillier Homomorphic + Householder QR",
    Observed: `${p21Ms.toFixed(2)} ms (dec=${decSum}, res=${qrRes.residualNormL2})`,
    TargetSLA: "< 30.0 ms",
    Status: decSum === 5000n && qrRes.residualNormL2 < 1e-4 && p21Ms < 30 ? "PASS" : "FAIL"
  });

  // 18. ElGamal / Chaum-Pedersen DLEQ + Grossi-Vitter Wavelet Tree (Phase 22)
  const t17 = performance.now();
  const dleqProof = ElGamalAndChaumPedersenDleqEngine.createChaumPedersenDleqProof(
    9999991n,
    4444441n
  );
  const dleqOk = ElGamalAndChaumPedersenDleqEngine.verifyChaumPedersenDleqProof(dleqProof);
  const wt = new WaveletTreeRankSelectQuantileIndex([9, 1, 8, 2, 7, 3, 6, 4, 5]);
  const medianVal = wt.rangeQuantileKthSmallest(0, 8, 4);
  const p22Ms = performance.now() - t17;
  rows.push({
    Module: "ElGamal DLEQ + Wavelet Tree Quantile",
    Observed: `${p22Ms.toFixed(2)} ms (dleq=${dleqOk}, med=${medianVal})`,
    TargetSLA: "< 30.0 ms",
    Status: dleqOk && medianVal === 5 && p22Ms < 30 ? "PASS" : "FAIL"
  });

  console.table(rows);
  if (rows.some((r) => r.Status !== "PASS")) {
    process.exit(1);
  }
  console.log("✅ All 18 Monumental Intelligence, OS Kernel & Frontier Benchmark SLAs verified GREEN.");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
