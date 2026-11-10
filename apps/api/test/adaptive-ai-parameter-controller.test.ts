import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { AdaptiveAiParameterController } from "../../../packages/core/src/adaptive-ai-parameter-controller.js";
import { AdaptivePersonaAndPromptComposer } from "../../../packages/core/src/adaptive-persona-and-prompt-composer.js";
import { TestTimeComputeSelfRefineEngine } from "../../../packages/core/src/test-time-compute-self-refine.js";
import { WorkingMemoryScratchpad } from "../../../packages/core/src/working-memory-scratchpad.js";
import { DynamicFewShotSelector } from "../../../packages/core/src/dynamic-few-shot-selector.js";
import { TreeOfThoughtsBeamSearch } from "../../../packages/core/src/tree-of-thoughts-beam-search.js";
import { LostInTheMiddleContextReranker } from "../../../packages/core/src/lost-in-the-middle-context-reranker.js";
import { NeuroSymbolicConstraintSolver } from "../../../packages/core/src/neuro-symbolic-constraint-solver.js";
import { MultiHopQueryDecomposer } from "../../../packages/core/src/multi-hop-query-decomposer.js";
import { CodeAndSqlPreflightVerifier } from "../../../packages/core/src/code-and-sql-preflight-verifier.js";
import { BayesianConfidenceCalibrator } from "../../../packages/core/src/bayesian-confidence-calibrator.js";
import { SemanticToolChainSynthesizer } from "../../../packages/core/src/semantic-tool-chain-synthesizer.js";
import { PersonalizedPageRankSubgraphExtractor } from "../../../packages/core/src/personalized-pagerank-subgraph-extractor.js";
import { AdversarialCounterexampleGenerator } from "../../../packages/core/src/adversarial-counterexample-generator.js";
import { SemanticAbResponseJudge } from "../../../packages/core/src/semantic-ab-response-judge.js";
import { AnalogicalCaseBasedReasoner } from "../../../packages/core/src/analogical-case-based-reasoner.js";
import { InformationGainActiveProber } from "../../../packages/core/src/information-gain-active-prober.js";
import { DialecticalDebateSynthesizer } from "../../../packages/core/src/dialectical-debate-synthesizer.js";
import { PalSymbolicMathVerifier } from "../../../packages/core/src/pal-symbolic-math-verifier.js";
import { AiIntelligenceSettingsStore } from "../../../packages/db/src/ai-intelligence-settings-store.js";
import { ImplicitFeedbackPreferenceLearner } from "../../../packages/db/src/implicit-feedback-preference-learner.js";
import { EbbinghausMemoryConsolidator } from "../../../packages/db/src/ebbinghaus-memory-consolidator.js";
import { HyperLogLogAndCountMinSketch } from "../../../packages/db/src/hyperloglog-and-count-min-sketch.js";
import { SuffixArraySubstringIndex } from "../../../packages/db/src/suffix-array-substring-index.js";
import { AiIntelligenceApiController } from "../src/ai-intelligence-routes.js";

test("AdaptiveAiParameterController calibrates decoding parameters, scales thinking budgets, and adapts on retry loops", () => {
  const codeParams = AdaptiveAiParameterController.computeHyperparameters({
    taskKind: "deterministic_code_and_sql",
    modelId: "claude-fable-5",
    protocol: "openai-compatible",
    estimatedPromptTokens: 12_000,
    dagStepCount: 4,
    toolDefinitionsCount: 6
  });

  assert.equal(codeParams.temperature, 0.05);
  assert.equal(codeParams.contextWindowTokens, 1_000_000);
  assert.ok(codeParams.thinkingBudgetTokens >= 8192);
  assert.equal(codeParams.reasoningEffort, "high");

  const solParams = AdaptiveAiParameterController.computeHyperparameters({
    taskKind: "analytical_research_and_grounding",
    modelId: "sol-1.05m-preview",
    protocol: "anthropic-compatible",
    estimatedPromptTokens: 50_000,
    dagStepCount: 6,
    toolDefinitionsCount: 8
  });

  assert.equal(solParams.contextWindowTokens, 1_050_000);
  assert.equal(solParams.temperature, 1.0);
  assert.equal(solParams.reasoningEffort, "max");
});

test("AdaptivePersonaAndPromptComposer adapts to user tone ('на ты' vs 'на Вы') and merges Custom System Prompt from settings", () => {
  const casualResult = AdaptivePersonaAndPromptComposer.composeAdaptiveSystemPrompt({
    role: "architect",
    autoAdaptStyle: true,
    recentUserMessages: [
      "давай соберем это в отдельный пакет без воды",
      "можешь сделать код максимально быстрым"
    ],
    mandatoryConstraints: ["Never modify packages/db/src/usage-store.ts"]
  });

  assert.equal(casualResult.inferredStyle.primaryLanguage, "ru");
  assert.equal(casualResult.inferredStyle.formality, "casual_peer");
  assert.equal(casualResult.inferredStyle.verbosity, "concise");

  const customResult = AdaptivePersonaAndPromptComposer.composeAdaptiveSystemPrompt({
    role: "analyst",
    customSystemPrompt: "Отвечай в стиле строгого финансового аудитора с таблицами рисков.",
    autoAdaptStyle: true,
    recentUserMessages: ["Будьте добры, предоставьте детальный отчёт по рискам."]
  });

  assert.equal(customResult.appliedCustomSystemPrompt, true);
  assert.equal(customResult.inferredStyle.formality, "polite_formal");
});

test("TestTimeComputeSelfRefineEngine routes System-1 vs System-2 queries and catches TODO stubs, missing constraints, and unclosed fences", () => {
  const simple = TestTimeComputeSelfRefineEngine.assessQueryComplexity({
    userQuery: "Привет, как дела?"
  });
  assert.equal(simple.executionMode, "fast_single_pass");

  const complex = TestTimeComputeSelfRefineEngine.assessQueryComplexity({
    userQuery:
      "Спроектируй и реализуй алгоритм кэширования для SQLite. Не используй внешние npm-пакеты и не трогай usage-store.ts."
  });
  assert.equal(complex.executionMode, "deep_self_refine");
  assert.ok(complex.recommendedThinkingBudgetTokens >= 4096);

  const badEval = TestTimeComputeSelfRefineEngine.evaluateAndBuildRefinement({
    userQuery: "Write SQLite migration",
    candidateDraft: "Here is the code:\n```sql\n// TODO: write table schema\n",
    requiredTermsOrConstraints: ["CREATE TABLE"],
    forbiddenTerms: ["DROP DATABASE"]
  });

  assert.equal(badEval.passed, false);
  assert.ok(badEval.issues.some((i) => i.category === "placeholder_stub_detected"));
  assert.ok(badEval.issues.some((i) => i.category === "unbalanced_code_or_json"));
  assert.ok(badEval.issues.some((i) => i.category === "missed_constraint"));
});

test("UncertaintyAndClarificationGate, WorkingMemoryScratchpad, CognitiveTurnOrchestrator & AiIntelligenceApiController execute end-to-end", () => {
  const sqlite = new DatabaseSync(":memory:");
  const store = new AiIntelligenceSettingsStore(sqlite);
  const api = new AiIntelligenceApiController(sqlite);

  assert.equal(api.handleGetSettings("owner_a", "owner_b").statusCode, 403);

  api.handleUpdateSettings("owner_a", "owner_a", {
    customSystemPrompt: "Всегда приводи точные математические формулы и ссылки на источники.",
    autoAdaptStyle: true,
    defaultReasoningMode: "deep_self_refine",
    customTemperature: 0.12
  });

  const scratchpad = new WorkingMemoryScratchpad();
  scratchpad.recordVerifiedFact(
    "Fable 5 Context Window",
    "1,000,000 tokens",
    "https://token-shop.online/v1/models"
  );
  scratchpad.upsertSubGoal("step_1", "Audit SQLite schema", "completed", "0063 verified");

  const turnRes = api.handlePrepareCognitiveTurn("owner_a", {
    role: "architect",
    taskKind: "deterministic_code_and_sql",
    userQuery: "давай проверим схему sqlite таблицы и затем обновим отчёт по проекту",
    estimatedPromptTokens: 8_000,
    scratchpad,
    retrievedContextChunks: [
      { id: "c_low_1", content: "Low priority note 1", relevanceScore: 0.25 },
      { id: "c_high_1", content: "Critical SQLite trigger rule", relevanceScore: 0.95, containsMandatoryConstraint: true },
      { id: "c_mid_1", content: "Medium note", relevanceScore: 0.5 },
      { id: "c_high_2", content: "Owner isolation requirement", relevanceScore: 0.9 }
    ],
    uncertaintyCheck: {
      intendedActionKind: "file_generation",
      ambiguousEntityCandidates: {
        "отчёт по проекту": [
          { id: "doc_q3", label: "Q3 Report.docx", distinguishingDetail: "от 2026-09-30" },
          { id: "doc_q4", label: "Q4 Report.docx", distinguishingDetail: "от 2026-11-01" }
        ]
      },
      unblockedSubtasks: ["Проверить схему SQLite 0063"]
    }
  });

  assert.equal(turnRes.statusCode, 200);
  const prepared = turnRes.body;
  assert.equal(prepared.uncertaintyDecision.status, "execute_unblocked_then_ask");
  assert.equal(prepared.multiHopPlan.isMultiHop, true);
  assert.equal(prepared.multiHopPlan.hops.length, 2);
  assert.ok(prepared.systemPrompt.includes("[IN_CONTEXT_FEW_SHOT_EXEMPLARS]"));
  assert.ok(prepared.systemPrompt.includes("[WORKING_MEMORY_VERIFIED_FACTS]"));
  assert.equal(prepared.uShapedContextLayout.orderedChunks[0]?.id, "c_high_1");

  const persisted = store.getSettings("owner_a");
  assert.equal(persisted.learnedStyleProfile.formality, "casual_peer");
  sqlite.close();
});

test("DynamicFewShotSelector, TreeOfThoughtsBeamSearch, LostInTheMiddleContextReranker & ImplicitFeedbackPreferenceLearner elevate reasoning", () => {
  const selector = new DynamicFewShotSelector();
  const icl = selector.selectExemplarsMmr({
    userQuery: "Write an idempotent SQLite migration table with TypeScript class wrapper",
    taskKind: "deterministic_code_and_sql",
    maxCount: 2,
    maxTokensBudget: 200
  });
  assert.equal(icl.selected.length, 2);

  const bestPath = TreeOfThoughtsBeamSearch.searchBestReasoningPath({
    beamWidth: 2,
    pruneThreshold: 0.45,
    nodes: [
      {
        id: "root_a",
        parentId: null,
        depth: 0,
        hypothesisText: "Use direct SQLite trigger fencing",
        feasibilityScore: 0.95,
        constraintSatisfactionScore: 1.0,
        evidenceGroundingScore: 0.9,
        estimatedCostPenalty: 0.1
      },
      {
        id: "root_b_bad",
        parentId: null,
        depth: 0,
        hypothesisText: "Modify reserved usage-store.ts directly",
        feasibilityScore: 0.2,
        constraintSatisfactionScore: 0.0,
        evidenceGroundingScore: 0.1,
        estimatedCostPenalty: 0.9
      },
      {
        id: "step1_a1",
        parentId: "root_a",
        depth: 1,
        hypothesisText: "Verify BEFORE INSERT and BEFORE UPDATE fencing",
        feasibilityScore: 0.92,
        constraintSatisfactionScore: 1.0,
        evidenceGroundingScore: 0.95,
        estimatedCostPenalty: 0.1
      }
    ]
  });

  assert.deepEqual(bestPath.orderedNodeIds, ["root_a", "step1_a1"]);
  assert.equal(bestPath.prunedNodesCount, 1);

  const layout = LostInTheMiddleContextReranker.arrangeUShapedContext([
    { id: "low_1", content: "bg 1", relevanceScore: 0.1 },
    { id: "top_1", content: "top 1", relevanceScore: 0.99 },
    { id: "low_2", content: "bg 2", relevanceScore: 0.2 },
    { id: "top_2", content: "top 2", relevanceScore: 0.92 }
  ]);
  assert.equal(layout.orderedChunks[0]?.id, "top_1");
  assert.equal(layout.orderedChunks[3]?.id, "top_2");

  const sqlite = new DatabaseSync(":memory:");
  const learner = new ImplicitFeedbackPreferenceLearner(sqlite);
  learner.observeUserMessage(
    "owner_learn_1",
    "Сделай коротко без воды, сравни в виде таблицы и собери всё в отдельный пакет"
  );
  learner.observeUserMessage("owner_learn_1", "отлично, хорошо работаем, давай дальше");
  assert.equal(learner.listActivePreferences("owner_learn_1").length, 3);
  sqlite.close();
});

test("NeuroSymbolicConstraintSolver, MultiHopQueryDecomposer & CodeAndSqlPreflightVerifier enforce formal correctness", () => {
  const solved = NeuroSymbolicConstraintSolver.solve({
    variables: [
      { name: "t_extract", domain: [0, 10, 20] },
      { name: "t_transform", domain: [10, 20, 30] },
      { name: "t_load", domain: [20, 30, 40, 50] }
    ],
    constraints: [
      { kind: "all_different", variables: ["t_extract", "t_transform", "t_load"] },
      { kind: "precedence", beforeVar: "t_extract", afterVar: "t_transform", minGap: 15 },
      { kind: "precedence", beforeVar: "t_transform", afterVar: "t_load", minGap: 15 },
      {
        kind: "linear_le",
        weights: { t_extract: 1, t_transform: 1, t_load: 1 },
        upperBound: 70
      }
    ],
    objective: {
      direction: "minimize",
      weights: { t_load: 1 }
    }
  });

  assert.equal(solved.satisfiable, true);
  assert.deepEqual(solved.assignment, {
    t_extract: 0,
    t_transform: 20,
    t_load: 40
  });

  const plan = MultiHopQueryDecomposer.decomposeQuery(
    "Прочитай документ архитектуры из Vault и затем проверь таблицу миграции SQLite после чего сравни результаты и напиши модуль"
  );
  assert.equal(plan.isMultiHop, true);
  assert.equal(plan.hops.length, 3);
  assert.equal(plan.waves.length, 2);

  const badSql = CodeAndSqlPreflightVerifier.verifySqlMigration(
    "CREATE TABLE users (id TEXT PRIMARY KEY);\nDROP TABLE old_users;"
  );
  assert.equal(badSql.valid, false);
});

test("EbbinghausMemoryConsolidator, BayesianConfidenceCalibrator & SemanticToolChainSynthesizer optimize memory, calibration, and tool schemas", () => {
  const sqlite = new DatabaseSync(":memory:");
  const consolidator = new EbbinghausMemoryConsolidator(sqlite);
  const t0 = 1_760_000_000_000;

  consolidator.recordMemoryTrace({
    memoryId: "mem_recurring_rule",
    ownerId: "owner_mem_1",
    summaryText: "User prefers standalone post-cutoff ZIP packages",
    importance: 0.7,
    nowMs: t0
  });
  consolidator.recordMemoryTrace({
    memoryId: "mem_ephemeral_chat",
    ownerId: "owner_mem_1",
    summaryText: "Temporary scratch note from 10 days ago",
    importance: 0.1,
    nowMs: t0
  });

  consolidator.reinforceOnRecall("mem_recurring_rule", t0 + 3_600_000);
  const reinforced = consolidator.reinforceOnRecall("mem_recurring_rule", t0 + 7_200_000);
  assert.equal(reinforced?.tier, "semantic_consolidated");

  const sweep = consolidator.runConsolidationSweep("owner_mem_1", t0 + 200 * 3_600_000, 0.2);
  assert.deepEqual(sweep.archivedColdIds, ["mem_ephemeral_chat"]);
  sqlite.close();

  const calibrator = new BayesianConfidenceCalibrator();
  for (let i = 0; i < 10; i++) {
    calibrator.recordOutcome(0.92, i % 2 === 0);
  }
  assert.ok(calibrator.calibrateNewPrediction(0.92) < 0.85);

  const synth = SemanticToolChainSynthesizer.synthesizeToolChain({
    userQuery: "Search Vault documents and extract PDF text",
    initialContextKeys: ["userQuery"],
    maxToolsToSelect: 2,
    availableTools: [
      {
        name: "vault_extract_pdf",
        description: "Extracts text from a Vault PDF document given vaultFileId",
        tags: ["vault", "pdf", "extract", "documents"],
        requiredInputs: ["vaultFileId"],
        providedOutputs: ["extractedText"],
        estimatedSchemaTokens: 180
      },
      {
        name: "vault_search_documents",
        description: "Searches Vault documents and returns vaultFileId",
        tags: ["vault", "search", "documents"],
        requiredInputs: ["userQuery"],
        providedOutputs: ["vaultFileId"],
        estimatedSchemaTokens: 140
      },
      {
        name: "unrelated_audio_synthesizer",
        description: "Synthesizes WAV PCM sine wave tones",
        tags: ["audio", "wav", "pcm"],
        requiredInputs: ["frequencyHz"],
        providedOutputs: ["wavBuffer"],
        estimatedSchemaTokens: 220
      }
    ]
  });

  assert.deepEqual(
    synth.selectedTools.map((t) => t.name),
    ["vault_search_documents", "vault_extract_pdf"]
  );
  assert.equal(synth.validDataflow, true);
});

test("PersonalizedPageRankSubgraphExtractor, AdversarialCounterexampleGenerator & SemanticAbResponseJudge execute GraphRAG, red-teaming & A/B judging", () => {
  const subgraph = PersonalizedPageRankSubgraphExtractor.extractSubgraph({
    seedNodeIds: ["node_vault", "node_drive"],
    topK: 3,
    edges: [
      { source: "node_vault", target: "node_bridge_spooler", relation: "spools_to", weight: 1.0 },
      { source: "node_bridge_spooler", target: "node_drive", relation: "uploads_to", weight: 1.0 },
      { source: "node_unrelated_a", target: "node_unrelated_b", relation: "noop", weight: 0.2 }
    ]
  });

  const topIds = subgraph.topNodes.map((n) => n.nodeId);
  assert.ok(topIds.includes("node_bridge_spooler"));
  assert.equal(subgraph.bridgePathsFound, 1);

  const redTeamCases = AdversarialCounterexampleGenerator.generateSuiteForDomain({
    targetComponent: "KosworkVaultBridge",
    hasNumericInputs: true,
    hasStringOrPathInputs: true,
    hasDatabaseWrites: true,
    hasTemporalLogic: true
  });
  assert.equal(redTeamCases.length, 6);

  const verdict = SemanticAbResponseJudge.compareCandidates({
    userQuery: "Explain Kosmora Fable 5 context window with source link",
    requiredTerms: ["1,000,000", "claude-fable-5"],
    candidateA:
      "Sure, I can help! [1] claude-fable-5 has some tokens.\n```ts\n// TODO: finish code",
    candidateB:
      "- **Model (`claude-fable-5`)**: Supports a `1,000,000`-token context window via [TokenShop Fable 5](https://token-shop.online/v1/models)."
  });

  assert.equal(verdict.winner, "B");
});

test("AnalogicalCaseBasedReasoner, InformationGainActiveProber & HyperLogLogAndCountMinSketch execute structure-mapping, Shannon probing & O(1) stream sketches", () => {
  const cbr = new AnalogicalCaseBasedReasoner();
  const transfer = cbr.findBestAnalogyAndTransfer([
    { relation: "buffers", sourceRole: "AudioFrameStream", targetRole: "LocalRingSpool" },
    { relation: "guards", sourceRole: "Crc32Validator", targetRole: "LocalRingSpool" },
    { relation: "transforms", sourceRole: "LocalRingSpool", targetRole: "SttCloudGateway" }
  ]);

  assert.ok(transfer);
  assert.equal(transfer.matchedCaseId, "case_drive_spool_retry");
  assert.equal(transfer.structuralIsomorphismScore, 1.0);

  const prober = InformationGainActiveProber.selectOptimalProbe({
    hypotheses: [
      { id: "h_network_drop", description: "Upstream SSE network disconnect", priorWeight: 1 },
      { id: "h_sqlite_lock", description: "SQLite OWNER_DATA_FENCED trigger abort", priorWeight: 1 }
    ],
    candidateProbes: [
      {
        probeId: "probe_uninformative",
        questionOrTest: "Check if Node.js process is running",
        likelihoodTrueGivenHypothesis: { h_network_drop: 0.99, h_sqlite_lock: 0.99 }
      },
      {
        probeId: "probe_discriminating",
        questionOrTest: "Check if kosmora_owner_data_lifecycle state != active",
        likelihoodTrueGivenHypothesis: { h_network_drop: 0.01, h_sqlite_lock: 0.99 }
      }
    ]
  });

  assert.equal(prober.bestProbe?.probeId, "probe_discriminating");

  const sqlite = new DatabaseSync(":memory:");
  const sketch = new HyperLogLogAndCountMinSketch();
  for (let i = 0; i < 300; i++) {
    sketch.observe(`unique_entity_${i}`, 1);
  }
  sketch.observe("heavy_hitter_tool_vault_search", 49);
  assert.ok(sketch.estimateDistinctCardinality() >= 240);
  sketch.saveToSqlite(sqlite, "owner_sketch_1", "telemetry");
  sqlite.close();
});

test("DialecticalDebateSynthesizer, PalSymbolicMathVerifier & SuffixArraySubstringIndex execute Hegelian synthesis, PAL math verification & O(P log N) substring search", () => {
  // 1. DialecticalDebateSynthesizer generates Devil's Advocate Antithesis & synthesizes mitigations
  const debate = DialecticalDebateSynthesizer.runDialecticalTriad({
    proposalTitle: "In-memory full table load with external fetch",
    coreClaims: ["Load all records into RAM on 1GB node and call https://api.example.com"],
    assumptions: ["SQLite database is never locked by another worker"],
    targetEnvironment: {
      ramLimitMb: 1024,
      requiresOfflineExecution: true,
      hasConcurrentWriters: true,
      handlesUntrustedInput: true
    }
  });

  assert.ok(debate.antithesisObjections.length >= 5);
  assert.equal(debate.readyForExecution, true);
  assert.ok(debate.synthesizedMitigations.length >= 5);

  // 2. PalSymbolicMathVerifier converts MiB vs MB, rejects dimensional mismatch, and audits inline math
  const q1 = PalSymbolicMathVerifier.parseQuantity(1, "MiB");
  const q2 = PalSymbolicMathVerifier.parseQuantity(512, "KiB");
  const sumBytes = PalSymbolicMathVerifier.addQuantities(q1, q2);
  assert.equal(sumBytes.canonicalValue, 1_572_864);

  const qTime = PalSymbolicMathVerifier.parseQuantity(2, "sec");
  assert.throws(() => {
    PalSymbolicMathVerifier.addQuantities(q1, qTime);
  }, /DIMENSIONAL_MISMATCH/);

  const parallelSla = PalSymbolicMathVerifier.computeCompositeSlaAvailability(
    [0.99, 0.99],
    "parallel_redundancy"
  );
  assert.equal(parallelSla, 0.9999);

  const eqAudits = PalSymbolicMathVerifier.auditInlineEquations(
    "The total cost is 120 + 35 = 155 USD, whereas the bad estimate said 40 * 3 = 110."
  );
  assert.equal(eqAudits.length, 2);
  assert.equal(eqAudits[0]?.valid, true);
  assert.equal(eqAudits[1]?.valid, false);
  assert.equal(eqAudits[1]?.correctedEquation, "40 * 3 = 120");

  // 3. SuffixArraySubstringIndex finds mid-identifier code snippets and longest duplicated code clone
  const sqlite = new DatabaseSync(":memory:");
  const sampleCode = [
    "function alpha() { return sqlite.prepare(query).all(); }",
    "function beta() { return sqlite.prepare(query).all(); }",
    "const tag = 'KOSMORA_VERIFIED_2026';"
  ].join("\n");

  const saIdx = new SuffixArraySubstringIndex("code_corpus_1", sampleCode);
  const hits = saIdx.searchSubstring("prepare(query).all()");
  assert.equal(hits.length, 2);
  assert.equal(hits[0]?.line, 1);
  assert.equal(hits[1]?.line, 2);

  const clone = saIdx.findLongestRepeatedClone(10);
  assert.ok(clone);
  assert.ok(clone.substring.includes("return sqlite.prepare(query).all(); }"));

  saIdx.saveToSqlite(sqlite, "owner_sa_1");
  const loadedSa = SuffixArraySubstringIndex.loadFromSqlite(sqlite, "owner_sa_1", "code_corpus_1");
  assert.ok(loadedSa);
  assert.equal(loadedSa.searchSubstring("VERIFIED_2026").length, 1);
  sqlite.close();
});
