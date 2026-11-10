import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { ActorMailboxMicrokernel } from "../../../packages/core/src/actor-mailbox-microkernel.js";
import { HtnSymbolicGoalPlanner } from "../../../packages/core/src/htn-symbolic-goal-planner.js";
import { ParetoFrontierOptimizer } from "../../../packages/core/src/pareto-frontier-optimizer.js";
import { BpeVocabularyTrainer } from "../../../packages/core/src/bpe-vocabulary-trainer.js";
import { Bm25fAndCrossEncoderReranker } from "../../../packages/core/src/bm25f-and-cross-encoder-reranker.js";
import { ConversationGoalDriftTracker } from "../../../packages/core/src/conversation-goal-drift-tracker.js";
import { MacaroonCapabilityEngine } from "../../../packages/core/src/macaroon-capability-tokens.js";
import { SagaAndTransactionalOutboxEngine } from "../../../packages/db/src/saga-and-transactional-outbox.js";
import { GraphCommunitySummarizer } from "../../../packages/db/src/graph-community-summarizer.js";
import { AutonomousOsKernelRuntime } from "../src/autonomous-os-kernel-runtime.js";

test("ActorMailboxMicrokernel enforces priority ordering, actor state isolation, and Erlang-style restart supervision", async () => {
  const kernel = new ActorMailboxMicrokernel();
  const orderLog: string[] = [];

  kernel.registerActor<{ counter: number }>({
    actorId: "worker_1",
    initialState: () => ({ counter: 0 }),
    supervisionStrategy: "restart",
    onMessage: (msg, ctx) => {
      if (msg.type === "CRASH") {
        throw new Error("SIMULATED_ACTOR_CRASH");
      }
      ctx.setState({ counter: ctx.state.counter + 1 });
      orderLog.push(`${msg.priority}:${String(msg.payload)}`);
    }
  });

  kernel.enqueueMessage({
    senderId: "system",
    recipientId: "worker_1",
    type: "WORK",
    payload: "bg_task",
    priority: "background"
  });
  kernel.enqueueMessage({
    senderId: "system",
    recipientId: "worker_1",
    type: "WORK",
    payload: "urgent_task",
    priority: "high"
  });
  kernel.enqueueMessage({
    senderId: "system",
    recipientId: "worker_1",
    type: "CRASH",
    payload: "boom",
    priority: "normal"
  });
  kernel.enqueueMessage({
    senderId: "system",
    recipientId: "worker_1",
    type: "WORK",
    payload: "post_crash_task",
    priority: "background"
  });

  const summary = await kernel.drainUntilIdle();
  assert.equal(summary.processedCount, 4);
  // High-priority message processed first!
  assert.equal(orderLog[0], "high:urgent_task");
  // After CRASH, actor restarted to { counter: 0 } and then processed 2 background tasks -> counter = 2
  assert.equal(kernel.getActorState<{ counter: number }>("worker_1")?.counter, 2);
});

test("SagaAndTransactionalOutboxEngine commits multi-step outbox events and executes LIFO compensating rollbacks on failure", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const saga = new SagaAndTransactionalOutboxEngine(sqlite);

  const ledger: string[] = [];
  const failedReport = await saga.executeSaga({
    sagaId: "saga_rollback_test",
    ownerId: "owner_saga_1",
    workflowName: "vault_and_drive_sync",
    context: {},
    steps: [
      {
        stepId: "s1_lock_vault",
        outboxTopic: "vault.locked",
        forwardAction: () => {
          ledger.push("do_s1");
          return { locked: true };
        },
        compensateAction: () => {
          ledger.push("undo_s1");
        }
      },
      {
        stepId: "s2_spool_archive",
        outboxTopic: "spool.created",
        forwardAction: () => {
          ledger.push("do_s2");
          return { spooled: true };
        },
        compensateAction: () => {
          ledger.push("undo_s2");
        }
      },
      {
        stepId: "s3_remote_upload_fail",
        outboxTopic: "drive.uploaded",
        forwardAction: () => {
          throw new Error("UPSTREAM_503_UNAVAILABLE");
        },
        compensateAction: () => {
          ledger.push("undo_s3");
        }
      }
    ]
  });

  assert.equal(failedReport.status, "compensated_rolled_back");
  // Forward s1, s2 -> fail s3 -> reverse LIFO compensation undo_s2, undo_s1!
  assert.deepEqual(ledger, ["do_s1", "do_s2", "undo_s2", "undo_s1"]);
  assert.deepEqual(failedReport.compensatedSteps, ["s2_spool_archive", "s1_lock_vault"]);

  const outbox = saga.fetchPendingOutboxEvents("owner_saga_1");
  assert.equal(outbox.length, 4); // 2 forward + 2 compensated events
  sqlite.close();
});

test("HtnSymbolicGoalPlanner & ParetoFrontierOptimizer synthesize optimal plans and non-dominated fronts", () => {
  const planner = new HtnSymbolicGoalPlanner({
    operators: [
      {
        name: "op_quiesce_db",
        preconditions: ["db_online"],
        addEffects: ["db_quiesced"],
        cost: 2
      },
      {
        name: "op_export_snapshot",
        preconditions: ["db_quiesced"],
        addEffects: ["snapshot_ready"],
        cost: 5
      },
      {
        name: "op_resume_db",
        preconditions: ["snapshot_ready"],
        addEffects: ["backup_complete"],
        deleteEffects: ["db_quiesced"],
        cost: 1
      }
    ],
    methods: [
      {
        compoundTaskName: "perform_safe_backup",
        methodName: "quiesce_export_resume",
        preconditions: ["db_online"],
        subtasks: ["op_quiesce_db", "op_export_snapshot", "op_resume_db"]
      }
    ]
  });

  const htnRes = planner.decomposeHtnTaskNetwork({
    initialStateFacts: ["db_online"],
    taskQueue: ["perform_safe_backup"]
  });
  assert.equal(htnRes.achievable, true);
  assert.deepEqual(htnRes.orderedOperatorNames, [
    "op_quiesce_db",
    "op_export_snapshot",
    "op_resume_db"
  ]);
  assert.equal(htnRes.totalCost, 8);

  const astarRes = planner.planToGoalAStar({
    initialStateFacts: ["db_online"],
    goalFacts: ["backup_complete"]
  });
  assert.equal(astarRes.achievable, true);
  assert.deepEqual(astarRes.orderedOperatorNames, [
    "op_quiesce_db",
    "op_export_snapshot",
    "op_resume_db"
  ]);

  const pareto = ParetoFrontierOptimizer.evaluateParetoFrontier([
    {
      id: "c_fast_high_qual",
      label: "Fast High Quality",
      qualityScore: 0.95,
      latencyMs: 300,
      costUsd: 0.01,
      privacyScore: 0.95
    },
    {
      id: "c_dominated",
      label: "Dominated Slow Expensive",
      qualityScore: 0.8,
      latencyMs: 900,
      costUsd: 0.05,
      privacyScore: 0.7
    }
  ]);
  assert.equal(pareto.paretoOptimalFront.length, 1);
  assert.equal(pareto.recommendedWinner?.id, "c_fast_high_qual");
});

test("BpeVocabularyTrainer, Bm25fAndCrossEncoderReranker, ConversationGoalDriftTracker & MacaroonCapabilityEngine verify core invariants", () => {
  // 1. BPE training & lossless round-trip
  const bpe = new BpeVocabularyTrainer();
  const sample = "kosmora_vault_search kosmora_vault_search kosmora_vault_read";
  bpe.train(sample, 16);
  const encoded = bpe.encode(sample);
  assert.ok(encoded.length < Buffer.byteLength(sample, "utf8"));
  assert.equal(bpe.decode(encoded), sample);

  // 2. BM25F + Cross-Encoder reranking boosts title & exact phrase matches
  const ranked = Bm25fAndCrossEncoderReranker.searchAndRerank({
    query: "quantum encryption gateway",
    documents: [
      {
        id: "doc_body_only",
        title: "General Notes",
        tags: ["misc"],
        body: "Mentioning gateway and encryption and quantum in separate places."
      },
      {
        id: "doc_title_exact",
        title: "Quantum Encryption Gateway Specification",
        tags: ["security", "quantum"],
        body: "Detailed spec for the quantum encryption gateway."
      }
    ]
  });
  assert.equal(ranked[0]?.id, "doc_title_exact");
  assert.ok(ranked[0]!.finalFusedScore > ranked[1]!.finalFusedScore);

  // 3. ConversationGoalDriftTracker detects off-topic drift and issues re-anchoring directive
  const tracker = new ConversationGoalDriftTracker({
    macroGoalText: "Implement SQLite migration 0063 and verify owner data fencing triggers",
    pinnedConstraints: ["Never modify usage-store.ts"]
  });
  const onTopic = tracker.observeTurnAndCheckDrift(
    "Verified SQLite migration 0063 owner data fencing triggers"
  );
  assert.equal(onTopic.driftDetected, false);

  const offTopic = tracker.observeTurnAndCheckDrift(
    "Let us discuss recipes for chocolate cake and baking temperatures"
  );
  assert.equal(offTopic.driftDetected, true);
  assert.ok(offTopic.reanchoringDirective?.includes("GOAL_DRIFT_REANCHORING_DIRECTIVE"));

  // 4. MacaroonCapabilityEngine mints, attenuates offline, and blocks tampered/unauthorized calls
  const rootMac = MacaroonCapabilityEngine.mintRootMacaroon({
    rootSecretKey: "secret_key_test_123",
    identifier: "mac_1",
    initialCaveats: [{ predicate: "owner_id", value: "owner_1" }]
  });
  const readOnlyMac = MacaroonCapabilityEngine.attenuateWithCaveat(rootMac, {
    predicate: "read_only",
    value: "true"
  });

  const allowedVerify = MacaroonCapabilityEngine.verifyMacaroon({
    rootSecretKey: "secret_key_test_123",
    token: readOnlyMac,
    context: {
      ownerId: "owner_1",
      requestedTool: "vault_read",
      isMutatingTool: false,
      nowMs: Date.now()
    }
  });
  assert.equal(allowedVerify.valid, true);

  const blockedMutating = MacaroonCapabilityEngine.verifyMacaroon({
    rootSecretKey: "secret_key_test_123",
    token: readOnlyMac,
    context: {
      ownerId: "owner_1",
      requestedTool: "vault_delete",
      isMutatingTool: true,
      nowMs: Date.now()
    }
  });
  assert.equal(blockedMutating.valid, false);
  assert.ok(blockedMutating.failedReason?.includes("CAVEAT_READ_ONLY_VIOLATION"));
});

test("GraphCommunitySummarizer & AutonomousOsKernelRuntime execute end-to-end GraphRAG community detection and kernel mission", async () => {
  const sqlite = new DatabaseSync(":memory:");
  const summarizer = new GraphCommunitySummarizer(sqlite);

  const commRes = summarizer.detectAndPersistCommunities({
    ownerId: "owner_kernel_1",
    graphNamespace: "architecture_kg",
    edges: [
      { u: "vault_extractor", v: "vault_bridge", weight: 5 },
      { u: "vault_bridge", v: "roaring_index", weight: 4 },
      { u: "vault_extractor", v: "roaring_index", weight: 4 },
      { u: "drive_oauth", v: "drive_spooler", weight: 5 },
      { u: "drive_spooler", v: "drive_restore", weight: 5 },
      { u: "drive_oauth", v: "drive_restore", weight: 4 }
    ]
  });

  assert.equal(commRes.communities.length, 2);
  assert.ok(commRes.totalModularityQ > 0.3);

  const runtime = new AutonomousOsKernelRuntime(sqlite, "kernel_master_secret_2026");
  const token = runtime.issueSubAgentCapabilityToken({
    ownerId: "owner_kernel_1",
    allowedTools: ["vault_search", "vault_read"],
    readOnly: true
  });

  const mission = await runtime.executeAutonomousKernelMission({
    ownerId: "owner_kernel_1",
    capabilityToken: token,
    macroGoal: "Verify Kosmora Stage-2 SQLite triggers and GraphRAG recall",
    userQuery: "давай проверим триггеры SQLite и индекс памяти",
    knowledgeDocuments: [
      {
        id: "doc_sqlite_0063",
        title: "SQLite 0063 Triggers & Memory Index",
        tags: ["sqlite", "триггеры", "индекс"],
        body: "Migration 0063 enforces OWNER_DATA_FENCED triggers and Roaring memory index."
      }
    ]
  });

  assert.equal(mission.authVerified, true);
  assert.equal(mission.htnPlan.achievable, true);
  assert.equal(mission.sagaReport.status, "succeeded");
  assert.equal(mission.rankedDocs[0]?.id, "doc_sqlite_0063");
  sqlite.close();
});
