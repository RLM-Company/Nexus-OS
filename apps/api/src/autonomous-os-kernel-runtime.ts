import { DatabaseSync } from "node:sqlite";
import { ActorMailboxMicrokernel } from "../../../packages/core/src/actor-mailbox-microkernel.js";
import {
  MacaroonCapabilityEngine,
  type MacaroonTokenPacket
} from "../../../packages/core/src/macaroon-capability-tokens.js";
import { HtnSymbolicGoalPlanner } from "../../../packages/core/src/htn-symbolic-goal-planner.js";
import { ParetoFrontierOptimizer } from "../../../packages/core/src/pareto-frontier-optimizer.js";
import { Bm25fAndCrossEncoderReranker } from "../../../packages/core/src/bm25f-and-cross-encoder-reranker.js";
import { ConversationGoalDriftTracker } from "../../../packages/core/src/conversation-goal-drift-tracker.js";
import { CognitiveTurnOrchestrator } from "../../../packages/core/src/cognitive-turn-orchestrator.js";
import { SagaAndTransactionalOutboxEngine } from "../../../packages/db/src/saga-and-transactional-outbox.js";
import { GraphCommunitySummarizer } from "../../../packages/db/src/graph-community-summarizer.js";

/**
 * Monumental Unified Autonomous OS Kernel Runtime.
 * Coordinates Actor Supervision, Macaroon Zero-Trust Capabilities, HTN Goal Planning,
 * Saga Transactional Outbox, BM25F+CrossEncoder Retrieval, GraphRAG Communities,
 * Pareto Strategy Optimization, and Cognitive Turn Preparation in a single runtime controller.
 */
export class AutonomousOsKernelRuntime {
  private readonly sqlite: DatabaseSync;
  private readonly rootSecretKey: string;
  public readonly actorKernel: ActorMailboxMicrokernel;
  public readonly sagaEngine: SagaAndTransactionalOutboxEngine;
  public readonly communitySummarizer: GraphCommunitySummarizer;

  constructor(sqlite: DatabaseSync, rootSecretKey = "kosmora-kernel-secret-key-2026") {
    this.sqlite = sqlite;
    this.rootSecretKey = rootSecretKey;
    this.actorKernel = new ActorMailboxMicrokernel();
    this.sagaEngine = new SagaAndTransactionalOutboxEngine(sqlite);
    this.communitySummarizer = new GraphCommunitySummarizer(sqlite);
  }

  public issueSubAgentCapabilityToken(params: {
    ownerId: string;
    allowedTools: string[];
    readOnly: boolean;
    ttlMs?: number;
    nowMs?: number;
  }): MacaroonTokenPacket {
    const now = params.nowMs ?? Date.now();
    const expires = now + (params.ttlMs ?? 300_000);
    const root = MacaroonCapabilityEngine.mintRootMacaroon({
      rootSecretKey: this.rootSecretKey,
      identifier: `cap_${params.ownerId}_${now}`,
      initialCaveats: [
        { predicate: "owner_id", value: params.ownerId },
        { predicate: "allowed_tool", value: params.allowedTools.join(",") },
        { predicate: "expires_before_ms", value: String(expires) }
      ]
    });

    return params.readOnly
      ? MacaroonCapabilityEngine.attenuateWithCaveat(root, {
          predicate: "read_only",
          value: "true"
        })
      : root;
  }

  public async executeAutonomousKernelMission(params: {
    ownerId: string;
    capabilityToken: MacaroonTokenPacket;
    macroGoal: string;
    userQuery: string;
    knowledgeDocuments: Array<{ id: string; title: string; tags: string[]; body: string }>;
  }) {
    // 1. Verify Macaroon Zero-Trust Capability Token
    const auth = MacaroonCapabilityEngine.verifyMacaroon({
      rootSecretKey: this.rootSecretKey,
      token: params.capabilityToken,
      context: {
        ownerId: params.ownerId,
        requestedTool: "vault_search",
        isMutatingTool: false,
        nowMs: Date.now()
      }
    });
    if (!auth.valid) {
      throw new Error(`KERNEL_CAPABILITY_DENIED: ${auth.failedReason}`);
    }

    // 2. Run BM25F + Cross-Encoder multi-field retrieval
    const rankedDocs = Bm25fAndCrossEncoderReranker.searchAndRerank({
      query: params.userQuery,
      documents: params.knowledgeDocuments,
      topK: 3
    });

    // 3. Synthesize HTN symbolic plan
    const htn = new HtnSymbolicGoalPlanner({
      operators: [
        {
          name: "op_retrieve_context",
          preconditions: ["query_received"],
          addEffects: ["context_ready"]
        },
        {
          name: "op_compose_cognitive_turn",
          preconditions: ["context_ready"],
          addEffects: ["turn_prepared"]
        },
        {
          name: "op_verify_grounding",
          preconditions: ["turn_prepared"],
          addEffects: ["mission_verified"]
        }
      ],
      methods: [
        {
          compoundTaskName: "execute_full_mission",
          methodName: "standard_verified_pipeline",
          preconditions: ["query_received"],
          subtasks: ["op_retrieve_context", "op_compose_cognitive_turn", "op_verify_grounding"]
        }
      ]
    });

    const htnPlan = htn.decomposeHtnTaskNetwork({
      initialStateFacts: ["query_received"],
      taskQueue: ["execute_full_mission"]
    });

    // 4. Select Pareto-optimal model execution route
    const pareto = ParetoFrontierOptimizer.evaluateParetoFrontier([
      {
        id: "route_fable5_deep",
        label: "Fable 5 Deep Self-Refine",
        qualityScore: 0.97,
        latencyMs: 850,
        costUsd: 0.012,
        privacyScore: 0.9
      },
      {
        id: "route_dominated_slow",
        label: "Legacy Slow Route",
        qualityScore: 0.75,
        latencyMs: 2400,
        costUsd: 0.04,
        privacyScore: 0.6
      }
    ]);

    // 5. Check goal drift against macroGoal
    const driftTracker = new ConversationGoalDriftTracker({
      macroGoalText: params.macroGoal
    });
    const driftReport = driftTracker.observeTurnAndCheckDrift(params.userQuery);

    // 6. Prepare full Cognitive Turn
    const preparedTurn = CognitiveTurnOrchestrator.prepareTurn({
      role: "architect",
      taskKind: "analytical_research_and_grounding",
      userQuery: params.userQuery,
      estimatedPromptTokens: 4096,
      retrievedContextChunks: rankedDocs.map((d) => ({
        id: d.id,
        content: d.title,
        relevanceScore: Math.min(1, d.finalFusedScore / 5)
      }))
    });

    // 7. Execute durable Saga recording mission completion
    const sagaReport = await this.sagaEngine.executeSaga({
      sagaId: `saga_mission_${Date.now()}`,
      ownerId: params.ownerId,
      workflowName: "autonomous_kernel_mission",
      context: { count: 0 },
      steps: [
        {
          stepId: "step_record_retrieval",
          outboxTopic: "kernel.retrieval.completed",
          forwardAction: (ctx) => {
            ctx.count++;
            return { topDocId: rankedDocs[0]?.id ?? null };
          },
          compensateAction: (ctx) => {
            ctx.count--;
          }
        },
        {
          stepId: "step_record_plan",
          outboxTopic: "kernel.plan.verified",
          forwardAction: (ctx) => {
            ctx.count++;
            return { operators: htnPlan.orderedOperatorNames };
          },
          compensateAction: (ctx) => {
            ctx.count--;
          }
        }
      ]
    });

    return {
      authVerified: true,
      rankedDocs,
      htnPlan,
      paretoWinner: pareto.recommendedWinner,
      driftReport,
      preparedTurn,
      sagaReport
    };
  }
}
