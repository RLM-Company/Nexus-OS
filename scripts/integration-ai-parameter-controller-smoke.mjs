#!/usr/bin/env node
/**
 * Offline smoke verification runner for the Monumental 252-Module Post-Cutoff
 * Kosmora Applied Intelligence, Autonomous OS Kernel & Full Frontier Package.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ts } from "./offline-typescript.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temp = mkdtempSync(join(tmpdir(), "kosmora-ai-intelligence-core-smoke-"));

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
  console.log("==> [1/3] Running 19 Desktop Workspace & Protocol Suites (.tex, .svg/.mmd/.dot, .openapi.json, MCP 2.0, SARIF 2.1.0, RTF 1.9.1, iCal/vCard, JUnit/TAP, SBOM, HAR/cURL, Prometheus/OTLP, W3C PROV/BibTeX, OASIS STIX/YARA, AsyncAPI/CloudEvents, GraphQL/JSON-LD, Protobuf/gRPC, OPA Rego/Cedar, Wasm WAT/WIT & RFC 7517 JWKS/OIDC)");
  const winRes = spawnSync(
    process.execPath,
    [
      "--test",
      resolve(root, "desktop/windows/test/latex-technical-spec-builder.test.cjs"),
      resolve(root, "desktop/windows/test/architecture-diagram-svg-builder.test.cjs"),
      resolve(root, "desktop/windows/test/openapi-contract-bundle-builder.test.cjs"),
      resolve(root, "desktop/windows/test/mcp-tool-server-bridge.test.cjs"),
      resolve(root, "desktop/windows/test/sarif-and-patch-bundle-builder.test.cjs"),
      resolve(root, "desktop/windows/test/rtf-and-markdown-bundle-builder.test.cjs"),
      resolve(root, "desktop/windows/test/ical-and-vcard-bundle-builder.test.cjs"),
      resolve(root, "desktop/windows/test/junit-and-tap-report-builder.test.cjs"),
      resolve(root, "desktop/windows/test/sbom-cyclonedx-and-spdx-builder.test.cjs"),
      resolve(root, "desktop/windows/test/har-and-curl-replay-builder.test.cjs"),
      resolve(root, "desktop/windows/test/prometheus-and-otlp-bundle-builder.test.cjs"),
      resolve(root, "desktop/windows/test/prov-lineage-and-citation-builder.test.cjs"),
      resolve(root, "desktop/windows/test/stix-taxii-threat-intel-builder.test.cjs"),
      resolve(root, "desktop/windows/test/asyncapi-and-cloudevents-bundle-builder.test.cjs"),
      resolve(root, "desktop/windows/test/graphql-sdl-and-jsonld-bundle-builder.test.cjs"),
      resolve(root, "desktop/windows/test/protobuf-v3-and-grpc-bundle-builder.test.cjs"),
      resolve(root, "desktop/windows/test/opa-rego-and-cedar-policy-builder.test.cjs"),
      resolve(root, "desktop/windows/test/wasm-wat-and-wit-component-builder.test.cjs"),
      resolve(root, "desktop/windows/test/jwks-and-oidc-discovery-bundle-builder.test.cjs")
    ],
    { cwd: root, stdio: "inherit" }
  );
  if (winRes.status !== 0) {
    process.exit(winRes.status ?? 1);
  }

  console.log("==> [2/3] Running Kosmora Applied Intelligence, Autonomous OS Kernel & Frontier (252 Modules) tests");
  writeFileSync(join(temp, "package.json"), '{"type":"module"}\n', "utf8");

  const modules = [
    "packages/core/src/adaptive-ai-parameter-controller.ts",
    "packages/core/src/adaptive-persona-and-prompt-composer.ts",
    "packages/core/src/test-time-compute-self-refine.ts",
    "packages/core/src/uncertainty-and-clarification-gate.ts",
    "packages/core/src/working-memory-scratchpad.ts",
    "packages/core/src/dynamic-few-shot-selector.ts",
    "packages/core/src/tree-of-thoughts-beam-search.ts",
    "packages/core/src/lost-in-the-middle-context-reranker.ts",
    "packages/core/src/neuro-symbolic-constraint-solver.ts",
    "packages/core/src/multi-hop-query-decomposer.ts",
    "packages/core/src/code-and-sql-preflight-verifier.ts",
    "packages/core/src/bayesian-confidence-calibrator.ts",
    "packages/core/src/semantic-tool-chain-synthesizer.ts",
    "packages/core/src/personalized-pagerank-subgraph-extractor.ts",
    "packages/core/src/adversarial-counterexample-generator.ts",
    "packages/core/src/semantic-ab-response-judge.ts",
    "packages/core/src/analogical-case-based-reasoner.ts",
    "packages/core/src/information-gain-active-prober.ts",
    "packages/core/src/dialectical-debate-synthesizer.ts",
    "packages/core/src/pal-symbolic-math-verifier.ts",
    "packages/core/src/actor-mailbox-microkernel.ts",
    "packages/core/src/htn-symbolic-goal-planner.ts",
    "packages/core/src/pareto-frontier-optimizer.ts",
    "packages/core/src/bpe-vocabulary-trainer.ts",
    "packages/core/src/bm25f-and-cross-encoder-reranker.ts",
    "packages/core/src/conversation-goal-drift-tracker.ts",
    "packages/core/src/macaroon-capability-tokens.ts",
    "packages/core/src/raft-consensus-state-machine.ts",
    "packages/core/src/ltl-temporal-model-checker.ts",
    "packages/core/src/simulated-annealing-tabu-optimizer.ts",
    "packages/core/src/linucb-contextual-bandit.ts",
    "packages/core/src/viterbi-intent-decoder.ts",
    "packages/core/src/dempster-shafer-evidence-fusion.ts",
    "packages/core/src/aho-corasick-scanner.ts",
    "packages/core/src/myers-diff-engine.ts",
    "packages/core/src/speculative-decoding-verifier.ts",
    "packages/core/src/ring-buffer-backpressure-controller.ts",
    "packages/core/src/rbac-abac-policy-engine.ts",
    "packages/core/src/drf-fair-share-scheduler.ts",
    "packages/core/src/factor-graph-belief-propagation.ts",
    "packages/core/src/hnsw-vector-index.ts",
    "packages/core/src/earley-chart-parser.ts",
    "packages/core/src/auction-hungarian-task-assigner.ts",
    "packages/core/src/swims-phi-accrual-failure-detector.ts",
    "packages/core/src/t-digest-streaming-quantiles.ts",
    "packages/core/src/minhash-lsh-deduplicator.ts",
    "packages/core/src/wrr-edf-realtime-scheduler.ts",
    "packages/core/src/page-replacement-arc-cache.ts",
    "packages/core/src/consistent-hash-bounded-load.ts",
    "packages/core/src/boolean-dpll-cdcl-sat-solver.ts",
    "packages/core/src/haar-wavelet-multiresolution-analyzer.ts",
    "packages/core/src/reed-solomon-erasure-coder.ts",
    "packages/core/src/pbft-byzantine-quorum-verifier.ts",
    "packages/core/src/isolation-forest-anomaly-detector.ts",
    "packages/core/src/raptorq-fountain-luby-transform.ts",
    "packages/core/src/dinic-max-flow-min-cut.ts",
    "packages/core/src/tarjan-scc-and-2sat-solver.ts",
    "packages/core/src/thompson-contextual-gaussian-process.ts",
    "packages/core/src/token-bucket-hierarchical-htb-shaper.ts",
    "packages/core/src/smith-waterman-local-aligner.ts",
    "packages/core/src/savitzky-golay-kalman-smoother.ts",
    "packages/core/src/bloom-cuckoo-xor-filter.ts",
    "packages/core/src/hopcroft-dfa-minimizer.ts",
    "packages/core/src/rga-woot-sequence-crdt.ts",
    "packages/core/src/skip-list-concurrent-index.ts",
    "packages/core/src/spectral-fiedler-graph-partitioner.ts",
    "packages/core/src/chandy-lamport-distributed-snapshot.ts",
    "packages/core/src/nelder-mead-simplex-optimizer.ts",
    "packages/core/src/pid-autoscaler-controller.ts",
    "packages/core/src/burrows-wheeler-fm-index.ts",
    "packages/core/src/wagner-fischer-damerau-levenshtein.ts",
    "packages/core/src/vickrey-clarke-groves-mechanism.ts",
    "packages/core/src/kahan-compensated-online-moments.ts",
    "packages/core/src/cbor-varint-wire-codec.ts",
    "packages/core/src/knuth-morris-pratt-rabin-karp.ts",
    "packages/core/src/lengauer-tarjan-dominator-ssa.ts",
    "packages/core/src/hindley-milner-type-inference.ts",
    "packages/core/src/radix-patricia-compact-trie.ts",
    "packages/core/src/gale-shapley-stable-matching.ts",
    "packages/core/src/floyd-warshall-johnson-apsp.ts",
    "packages/core/src/interval-tree-augmented-avl.ts",
    "packages/core/src/simplex-linear-programming-solver.ts",
    "packages/core/src/huffman-canonical-ans-entropy-coder.ts",
    "packages/core/src/boyer-moore-horspool-sunday-matcher.ts",
    "packages/core/src/page-hinkley-adwin-drift-detector.ts",
    "packages/core/src/fenwick-segment-tree-range-aggregator.ts",
    "packages/core/src/retinal-rete-forward-chaining-engine.ts",
    "packages/core/src/robdd-binary-decision-diagram.ts",
    "packages/core/src/min-cost-max-flow-spfa.ts",
    "packages/core/src/suffix-automaton-sam-dawg.ts",
    "packages/core/src/glicko2-bradley-terry-rating.ts",
    "packages/core/src/lzw-lz77-dictionary-compressor.ts",
    "packages/core/src/disjoint-set-kruskal-mst.ts",
    "packages/core/src/cubic-spline-hermite-interpolator.ts",
    "packages/core/src/mann-kendall-theil-sen-trend.ts",
    "packages/core/src/sinkhorn-knopp-earth-mover-ot.ts",
    "packages/core/src/dancing-links-exact-cover-dlx.ts",
    "packages/core/src/petri-karp-miller-coverability.ts",
    "packages/core/src/shunting-yard-pratt-expression-evaluator.ts",
    "packages/core/src/dbm-timed-automata-verifier.ts",
    "packages/core/src/hopcroft-karp-bipartite-matching.ts",
    "packages/core/src/cooley-tukey-fft-periodogram.ts",
    "packages/core/src/adaboost-decision-stump-ensemble.ts",
    "packages/core/src/levinson-durbin-burg-autoregression.ts",
    "packages/core/src/push-relabel-goldberg-tarjan.ts",
    "packages/core/src/suurballe-edge-disjoint-paths.ts",
    "packages/core/src/bron-kerbosch-maximal-cliques.ts",
    "packages/core/src/arithmetic-range-ans-coder.ts",
    "packages/core/src/walrasian-tatonnement-market-clearing.ts",
    "packages/core/src/earley-cyk-probabilistic-pcfg.ts",
    "packages/core/src/hilbert-space-filling-curve-index.ts",
    "packages/core/src/egraph-equality-saturation-optimizer.ts",
    "packages/core/src/abstract-interpretation-interval-domain.ts",
    "packages/core/src/pratt-tdop-parser-compiler.ts",
    "packages/core/src/baum-welch-forward-backward-hmm.ts",
    "packages/core/src/karmarkar-karp-multiprocessor-binpacking.ts",
    "packages/core/src/edmonds-blossom-general-matching.ts",
    "packages/core/src/conjugate-gradient-krylov-solver.ts",
    "packages/core/src/chaitin-linear-scan-register-allocator.ts",
    "packages/core/src/tukey-iqr-hampel-outlier-filter.ts",
    "packages/core/src/knuth-shuffle-alias-method-sampler.ts",
    "packages/core/src/exponential-histogram-dgim-counter.ts",
    "packages/core/src/jaccard-sorensen-dice-ngram-profiler.ts",
    "packages/core/src/shamir-lagrange-secret-sharing.ts",
    "packages/core/src/wagner-fischer-zhang-shasha-tree-diff.ts",
    "packages/core/src/christofides-two-opt-tsp-router.ts",
    "packages/core/src/sprague-grundy-impartial-game-solver.ts",
    "packages/core/src/birkhoff-von-neumann-bistochastic-decomposer.ts",
    "packages/core/src/charikar-count-sketch-ams-moments.ts",
    "packages/core/src/ukkonen-online-suffix-tree.ts",
    "packages/core/src/capacitated-b-matching-assigner.ts",
    "packages/core/src/lamport-bakery-mutex-fairness-verifier.ts",
    "packages/core/src/fractional-cascading-multi-catalog-search.ts",
    "packages/core/src/cubic-bezier-catmull-rom-trajectory-planner.ts",
    "packages/core/src/johnsons-all-pairs-reweighted-shortest-path.ts",
    "packages/core/src/schnorr-pedersen-zkp-commitment.ts",
    "packages/core/src/stoer-wagner-global-min-cut.ts",
    "packages/core/src/astar-landmark-alt-router.ts",
    "packages/core/src/misra-gries-space-saving-heavy-hitters.ts",
    "packages/core/src/jacobi-eigenvalue-pca-reducer.ts",
    "packages/core/src/tarjan-bridge-articulation-biconnected.ts",
    "packages/core/src/knuth-plass-paragraph-line-breaker.ts",
    "packages/core/src/unscented-kalman-sigma-point-filter.ts",
    "packages/core/src/floyd-steinberg-scalar-lloyd-max-quantizer.ts",
    "packages/core/src/edmonds-karp-gomory-hu-cut-tree.ts",
    "packages/core/src/gale-top-trading-cycles-housing-market.ts",
    "packages/core/src/jaro-winkler-phonetic-double-metaphone.ts",
    "packages/core/src/chu-liu-edmonds-directed-arborescence.ts",
    "packages/core/src/bowyer-watson-delaunay-voronoi-mesh.ts",
    "packages/core/src/euler-tour-rmq-sparse-table-lca.ts",
    "packages/core/src/ramer-douglas-peucker-visvalingam-simplifier.ts",
    "packages/core/src/kleinberg-hits-hubs-authorities.ts",
    "packages/core/src/bertsekas-epsilon-auction-assigner.ts",
    "packages/core/src/manacher-z-algorithm-string-kernel.ts",
    "packages/core/src/berlekamp-massey-lfsr-synthesizer.ts",
    "packages/core/src/brent-cycle-pollard-rho-factorizer.ts",
    "packages/core/src/fastcdc-gear-content-defined-chunker.ts",
    "packages/core/src/mrf-binary-submodular-graph-cut.ts",
    "packages/core/src/soft-tfidf-bm25-plus-proximity-scorer.ts",
    "packages/core/src/paillier-additive-homomorphic-crypto.ts",
    "packages/core/src/yens-k-shortest-loopless-paths.ts",
    "packages/core/src/heavy-light-decomposition-tree-path.ts",
    "packages/core/src/monotone-chain-convex-hull-calipers.ts",
    "packages/core/src/householder-qr-least-squares-solver.ts",
    "packages/core/src/bitap-shift-or-fuzzy-matcher.ts",
    "packages/core/src/duval-lyndon-word-factorization.ts",
    "packages/core/src/efraimidis-spirakis-weighted-reservoir.ts",
    "packages/core/src/cordic-hyperbolic-trig-evaluator.ts",
    "packages/core/src/dulmage-mendelsohn-structural-decomposer.ts",
    "packages/core/src/cheeger-conductance-expander-auditor.ts",
    "packages/core/src/bottleneck-minmax-linear-assigner.ts",
    "packages/core/src/elgamal-chaum-pedersen-dleq-verifier.ts",
    "packages/core/src/sleator-tarjan-splay-tree-sequence.ts",
    "packages/core/src/kd-tree-closest-pair-spatial-index.ts",
    "packages/core/src/golub-kahan-truncated-svd-low-rank.ts",
    "packages/core/src/schleimer-winnowing-document-fingerprint.ts",
    "packages/core/src/grossi-vitter-wavelet-tree-rank-select.ts",
    "packages/core/src/mahalanobis-ewma-covariance-detector.ts",
    "packages/core/src/active-set-quadratic-programming-kkt.ts",
    "packages/core/src/gabow-path-based-scc-condensation.ts",
    "packages/core/src/alpha-expansion-multilabel-graph-cut.ts",
    "packages/core/src/de-bruijn-eulerian-sequence-assembler.ts",
    "packages/core/src/kahan-babuska-neumaier-compensated-sum.ts",
    "packages/core/src/cognitive-turn-orchestrator.ts",
    "packages/db/src/ai-intelligence-settings-store.ts",
    "packages/db/src/implicit-feedback-preference-learner.ts",
    "packages/db/src/ebbinghaus-memory-consolidator.ts",
    "packages/db/src/hyperloglog-and-count-min-sketch.ts",
    "packages/db/src/suffix-array-substring-index.ts",
    "packages/db/src/saga-and-transactional-outbox.ts",
    "packages/db/src/graph-community-summarizer.ts",
    "packages/db/src/lsm-tree-sstable-engine.ts",
    "packages/db/src/timeseries-delta-compressor.ts",
    "packages/db/src/columnar-rle-bitpacking-store.ts",
    "packages/db/src/event-sourcing-cqrs-projector.ts",
    "packages/db/src/bplus-tree-mvcc-index.ts",
    "packages/db/src/distributed-lock-fencing-lease-manager.ts",
    "packages/db/src/merkle-bplus-audit-ledger.ts",
    "packages/db/src/spatial-rtree-bounding-index.ts",
    "packages/db/src/two-phase-commit-and-deadlock-detector.ts",
    "packages/db/src/hierarchical-timing-wheel-scheduler.ts",
    "packages/db/src/fractional-indexing-lexorank-store.ts",
    "packages/db/src/sliding-window-rate-governor-store.ts",
    "packages/db/src/persistent-treap-order-statistic-store.ts",
    "packages/db/src/write-ahead-redo-undo-aries-recovery.ts",
    "packages/db/src/ssi-serializable-snapshot-isolation.ts",
    "packages/db/src/out-of-order-watermark-window-aggregator.ts",
    "packages/db/src/merkle-patricia-state-trie-store.ts",
    "packages/db/src/outbox-idempotency-dedup-ledger.ts",
    "packages/db/src/or-set-observed-remove-crdt-store.ts",
    "packages/db/src/hierarchical-quota-cost-attribution-ledger.ts",
    "packages/db/src/bitemporal-valid-transaction-time-store.ts",
    "packages/db/src/birman-schiper-stephenson-causal-broadcast.ts",
    "packages/db/src/exponential-backoff-dlq-retry-store.ts",
    "packages/db/src/mvcc-time-travel-snapshot-differ.ts",
    "packages/db/src/dag-workflow-checkpoint-barrier-store.ts",
    "packages/db/src/token-ring-quorum-barrier-coordinator.ts",
    "apps/api/src/ai-intelligence-routes.ts",
    "apps/api/src/autonomous-os-kernel-runtime.ts",
    "apps/api/test/adaptive-ai-parameter-controller.test.ts",
    "apps/api/test/autonomous-os-kernel-monumental.test.ts",
    "apps/api/test/distributed-formal-and-storage-frontier.test.ts",
    "apps/api/test/probabilistic-vector-columnar-and-mesh-frontier.test.ts",
    "apps/api/test/erasure-pbft-mvcc-and-automata-frontier.test.ts",
    "apps/api/test/crdt-spectral-vcg-and-spatial-frontier.test.ts",
    "apps/api/test/ssa-typeinference-2pc-and-lp-frontier.test.ts",
    "apps/api/test/robdd-mcmf-sam-glicko-and-dlx-frontier.test.ts",
    "apps/api/test/dbm-hopcroft-fft-aries-and-pcfg-frontier.test.ts",
    "apps/api/test/egraph-abstractinterp-ssi-and-pcg-frontier.test.ts",
    "apps/api/test/shamir-patricia-christofides-and-bvn-frontier.test.ts",
    "apps/api/test/zkp-stoerwagner-alt-gomoryhu-and-ttc-frontier.test.ts",
    "apps/api/test/arborescence-delaunay-lca-bitemporal-and-causal-frontier.test.ts",
    "apps/api/test/paillier-yen-hld-hull-and-qr-frontier.test.ts",
    "apps/api/test/elgamal-splay-kdtree-svd-and-wavelet-frontier.test.ts"
  ];

  for (const src of modules) {
    emitTs(src, src.replace(/\.ts$/, ".js"));
  }

  const res = spawnSync(
    process.execPath,
    [
      "--test",
      join(temp, "apps/api/test/adaptive-ai-parameter-controller.test.js"),
      join(temp, "apps/api/test/autonomous-os-kernel-monumental.test.js"),
      join(temp, "apps/api/test/distributed-formal-and-storage-frontier.test.js"),
      join(temp, "apps/api/test/probabilistic-vector-columnar-and-mesh-frontier.test.js"),
      join(temp, "apps/api/test/erasure-pbft-mvcc-and-automata-frontier.test.js"),
      join(temp, "apps/api/test/crdt-spectral-vcg-and-spatial-frontier.test.js"),
      join(temp, "apps/api/test/ssa-typeinference-2pc-and-lp-frontier.test.js"),
      join(temp, "apps/api/test/robdd-mcmf-sam-glicko-and-dlx-frontier.test.js"),
      join(temp, "apps/api/test/dbm-hopcroft-fft-aries-and-pcfg-frontier.test.js"),
      join(temp, "apps/api/test/egraph-abstractinterp-ssi-and-pcg-frontier.test.js"),
      join(temp, "apps/api/test/shamir-patricia-christofides-and-bvn-frontier.test.js"),
      join(temp, "apps/api/test/zkp-stoerwagner-alt-gomoryhu-and-ttc-frontier.test.js"),
      join(temp, "apps/api/test/arborescence-delaunay-lca-bitemporal-and-causal-frontier.test.js"),
      join(temp, "apps/api/test/paillier-yen-hld-hull-and-qr-frontier.test.js"),
      join(temp, "apps/api/test/elgamal-splay-kdtree-svd-and-wavelet-frontier.test.js")
    ],
    { cwd: root, stdio: "inherit" }
  );
  if (res.status !== 0) {
    process.exit(res.status ?? 1);
  }

  console.log("==> [3/3] Running Monumental Performance & SLA Benchmark Harness");
  const benchRes = spawnSync(
    process.execPath,
    [resolve(root, "scripts/benchmark-kosmora-intelligence-and-os-kernel.mjs")],
    { cwd: root, stdio: "inherit" }
  );
  if (benchRes.status !== 0) {
    process.exit(benchRes.status ?? 1);
  }

  console.log("[OK] All 252 Kosmora Applied Intelligence, Autonomous OS Kernel & Frontier modules passed verification.");
} finally {
  rmSync(temp, { recursive: true, force: true });
}
