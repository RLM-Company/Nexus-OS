import { verifyF001Module } from "./f001-kosmora-protocol-init.ts";
import { verifyF002Module } from "./f002-dag-task-graph-engine.ts";
import { verifyF003Module } from "./f003-runtime-artifact-task-binding.ts";
import { verifyF004Module } from "./f004-artifact-provenance-graph.ts";
import { verifyF005Module } from "./f005-runtime-provenance-validator.ts";
import { verifyF006Module } from "./f006-critic-agent-institute.ts";
import { verifyF007Module } from "./f007-critic-verdict-binding.ts";
import { verifyF008Module } from "./f008-autonomy-levels-l1-l5.ts";
import { verifyF009Module } from "./f009-dynamic-llm-routing.ts";
import { verifyF010Module } from "./f010-agent-loop-detector.ts";
import { verifyF011Module } from "./f011-execution-checkpointing.ts";
import { verifyF012Module } from "./f012-reasoning-state-rollback.ts";
import { verifyF013Module } from "./f013-parallel-subagent-fanout.ts";
import { verifyF014Module } from "./f014-dynamic-task-queue-priority.ts";
import { verifyF015Module } from "./f015-strict-json-schema-io.ts";
import { verifyF016Module } from "./f016-self-healing-syntax-retry.ts";
import { verifyF017Module } from "./f017-worker-watchdog-timers.ts";
import { verifyF018Module } from "./f018-response-confidence-scoring.ts";
import { verifyF019Module } from "./f019-hitl-breakpoints.ts";
import { verifyF020Module } from "./f020-hot-swap-role-prompts.ts";
import { verifyF021Module } from "./f021-local-agent-event-bus.ts";
import { verifyF022Module } from "./f022-merge-conflict-arbitration.ts";
import { verifyF023Module } from "./f023-task-token-budgeting.ts";
import { verifyF024Module } from "./f024-tool-call-deduplication.ts";
import { verifyF025Module } from "./f025-realtime-thought-streaming.ts";
import { verifyF026Module } from "./f026-multiagent-squad-presets.ts";
import { verifyF027Module } from "./f027-failure-postmortem-generator.ts";
import { verifyF028Module } from "./f028-lossless-context-handoff.ts";
import { verifyF029Module } from "./f029-devils-advocate-mode.ts";
import { verifyF030Module } from "./f030-critic-strictness-calibration.ts";
import { verifyF031Module } from "./f031-active-worker-registry.ts";
import { verifyF032Module } from "./f032-node-latency-profiler.ts";

// Stage Barrel Export for packages/core/src/stage1-autonomy (32 feature modules)
export * from "./f001-kosmora-protocol-init.ts";
export * from "./f002-dag-task-graph-engine.ts";
export * from "./f003-runtime-artifact-task-binding.ts";
export * from "./f004-artifact-provenance-graph.ts";
export * from "./f005-runtime-provenance-validator.ts";
export * from "./f006-critic-agent-institute.ts";
export * from "./f007-critic-verdict-binding.ts";
export * from "./f008-autonomy-levels-l1-l5.ts";
export * from "./f009-dynamic-llm-routing.ts";
export * from "./f010-agent-loop-detector.ts";
export * from "./f011-execution-checkpointing.ts";
export * from "./f012-reasoning-state-rollback.ts";
export * from "./f013-parallel-subagent-fanout.ts";
export * from "./f014-dynamic-task-queue-priority.ts";
export * from "./f015-strict-json-schema-io.ts";
export * from "./f016-self-healing-syntax-retry.ts";
export * from "./f017-worker-watchdog-timers.ts";
export * from "./f018-response-confidence-scoring.ts";
export * from "./f019-hitl-breakpoints.ts";
export * from "./f020-hot-swap-role-prompts.ts";
export * from "./f021-local-agent-event-bus.ts";
export * from "./f022-merge-conflict-arbitration.ts";
export * from "./f023-task-token-budgeting.ts";
export * from "./f024-tool-call-deduplication.ts";
export * from "./f025-realtime-thought-streaming.ts";
export * from "./f026-multiagent-squad-presets.ts";
export * from "./f027-failure-postmortem-generator.ts";
export * from "./f028-lossless-context-handoff.ts";
export * from "./f029-devils-advocate-mode.ts";
export * from "./f030-critic-strictness-calibration.ts";
export * from "./f031-active-worker-registry.ts";
export * from "./f032-node-latency-profiler.ts";

export function verifyStage_stage1_autonomy(): Array<{ featureId: string; passed: boolean }> {
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
    verifyF032Module(),
  ];
}
