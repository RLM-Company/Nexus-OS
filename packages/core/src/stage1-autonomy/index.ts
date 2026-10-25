import { verifyF001Module } from "./f001-kosmora-protocol-init.js";
import { verifyF002Module } from "./f002-dag-task-graph-engine.js";
import { verifyF003Module } from "./f003-runtime-artifact-task-binding.js";
import { verifyF004Module } from "./f004-artifact-provenance-graph.js";
import { verifyF005Module } from "./f005-runtime-provenance-validator.js";
import { verifyF006Module } from "./f006-critic-agent-institute.js";
import { verifyF007Module } from "./f007-critic-verdict-binding.js";
import { verifyF008Module } from "./f008-autonomy-levels-l1-l5.js";
import { verifyF009Module } from "./f009-dynamic-llm-routing.js";
import { verifyF010Module } from "./f010-agent-loop-detector.js";
import { verifyF011Module } from "./f011-execution-checkpointing.js";
import { verifyF012Module } from "./f012-reasoning-state-rollback.js";
import { verifyF013Module } from "./f013-parallel-subagent-fanout.js";
import { verifyF014Module } from "./f014-dynamic-task-queue-priority.js";
import { verifyF015Module } from "./f015-strict-json-schema-io.js";
import { verifyF016Module } from "./f016-self-healing-syntax-retry.js";
import { verifyF017Module } from "./f017-worker-watchdog-timers.js";
import { verifyF018Module } from "./f018-response-confidence-scoring.js";
import { verifyF019Module } from "./f019-hitl-breakpoints.js";
import { verifyF020Module } from "./f020-hot-swap-role-prompts.js";
import { verifyF021Module } from "./f021-local-agent-event-bus.js";
import { verifyF022Module } from "./f022-merge-conflict-arbitration.js";
import { verifyF023Module } from "./f023-task-token-budgeting.js";
import { verifyF024Module } from "./f024-tool-call-deduplication.js";
import { verifyF025Module } from "./f025-realtime-thought-streaming.js";
import { verifyF026Module } from "./f026-multiagent-squad-presets.js";
import { verifyF027Module } from "./f027-failure-postmortem-generator.js";
import { verifyF028Module } from "./f028-lossless-context-handoff.js";
import { verifyF029Module } from "./f029-devils-advocate-mode.js";
import { verifyF030Module } from "./f030-critic-strictness-calibration.js";
import { verifyF031Module } from "./f031-active-worker-registry.js";
import { verifyF032Module } from "./f032-node-latency-profiler.js";

// Stage Barrel Export for packages/core/src/stage1-autonomy (32 feature modules)
export * from "./stage-kernel.js";
export * from "./f001-kosmora-protocol-init.js";
export * from "./f002-dag-task-graph-engine.js";
export * from "./f003-runtime-artifact-task-binding.js";
export * from "./f004-artifact-provenance-graph.js";
export * from "./f005-runtime-provenance-validator.js";
export * from "./f006-critic-agent-institute.js";
export * from "./f007-critic-verdict-binding.js";
export * from "./f008-autonomy-levels-l1-l5.js";
export * from "./f009-dynamic-llm-routing.js";
export * from "./f010-agent-loop-detector.js";
export * from "./f011-execution-checkpointing.js";
export * from "./f012-reasoning-state-rollback.js";
export * from "./f013-parallel-subagent-fanout.js";
export * from "./f014-dynamic-task-queue-priority.js";
export * from "./f015-strict-json-schema-io.js";
export * from "./f016-self-healing-syntax-retry.js";
export * from "./f017-worker-watchdog-timers.js";
export * from "./f018-response-confidence-scoring.js";
export * from "./f019-hitl-breakpoints.js";
export * from "./f020-hot-swap-role-prompts.js";
export * from "./f021-local-agent-event-bus.js";
export * from "./f022-merge-conflict-arbitration.js";
export * from "./f023-task-token-budgeting.js";
export * from "./f024-tool-call-deduplication.js";
export * from "./f025-realtime-thought-streaming.js";
export * from "./f026-multiagent-squad-presets.js";
export * from "./f027-failure-postmortem-generator.js";
export * from "./f028-lossless-context-handoff.js";
export * from "./f029-devils-advocate-mode.js";
export * from "./f030-critic-strictness-calibration.js";
export * from "./f031-active-worker-registry.js";
export * from "./f032-node-latency-profiler.js";

export function verifyStage_stage1_autonomy(): Array<{ featureId: string; passed: boolean; executionId: string; provenanceDigest: string }> {
  return [
    verifyF001Module(),
    verifyF002Module(),
    verifyF003Module(),
    verifyF004Module(),
    verifyF005Module(),
    verifyF006Module(),
    verifyF007Module(),
    verifyF008Module(),
    verifyF009Module(),
    verifyF010Module(),
    verifyF011Module(),
    verifyF012Module(),
    verifyF013Module(),
    verifyF014Module(),
    verifyF015Module(),
    verifyF016Module(),
    verifyF017Module(),
    verifyF018Module(),
    verifyF019Module(),
    verifyF020Module(),
    verifyF021Module(),
    verifyF022Module(),
    verifyF023Module(),
    verifyF024Module(),
    verifyF025Module(),
    verifyF026Module(),
    verifyF027Module(),
    verifyF028Module(),
    verifyF029Module(),
    verifyF030Module(),
    verifyF031Module(),
    verifyF032Module()
  ];
}
