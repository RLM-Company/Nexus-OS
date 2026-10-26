export { Stage7FormalKernel } from "./stage-kernel.js";
export * from "./f193-bounded-fsm-model-checker.js";
export * from "./f194-temporal-deadlock-freedom-prover.js";
export * from "./f195-counterexample-trace-synthesizer.js";
export * from "./f196-unreachable-state-pruning-analyzer.js";
export * from "./f197-protocol-safety-property-verifier.js";
export * from "./f198-state-space-digest-certifier.js";
export * from "./f199-csp-resource-placement-solver.js";
export * from "./f200-anti-affinity-fault-domain-guard.js";
export * from "./f201-gpu-vram-capacity-bin-packer.js";
export * from "./f202-sla-cost-minimizing-scheduler.js";
export * from "./f203-infeasible-constraint-conflict-explainer.js";
export * from "./f204-deterministic-placement-matrix-exporter.js";
export * from "./f205-w3c-traceparent-header-propagator.js";
export * from "./f206-distributed-span-dag-assembler.js";
export * from "./f207-critical-path-latency-analyzer.js";
export * from "./f208-self-time-bottleneck-detector.js";
export * from "./f209-cross-service-clock-skew-normalizer.js";
export * from "./f210-trace-telemetry-digest-sealer.js";
export * from "./f211-execution-cassette-recorder.js";
export * from "./f212-bit-exact-deterministic-replayer.js";
export * from "./f213-replay-divergence-pinpointer.js";
export * from "./f214-cassette-tamper-seal-verifier.js";
export * from "./f215-regression-golden-cassette-comparator.js";
export * from "./f216-time-travel-state-hydration-engine.js";
export * from "./f217-static-dataflow-taint-tracker.js";
export * from "./f218-dangerous-sink-invocation-blocker.js";
export * from "./f219-sanitizer-effectiveness-verifier.js";
export * from "./f220-transitive-variable-taint-propagator.js";
export * from "./f221-code-injection-sink-auditor.js";
export * from "./f222-automated-security-gate-enforcer.js";
export * from "./f223-multi-stage-formal-proof-aggregator.js";
export * from "./f224-stage7-formal-verification-readiness.js";

import { verifyF193Module } from "./f193-bounded-fsm-model-checker.js";
import { verifyF194Module } from "./f194-temporal-deadlock-freedom-prover.js";
import { verifyF195Module } from "./f195-counterexample-trace-synthesizer.js";
import { verifyF196Module } from "./f196-unreachable-state-pruning-analyzer.js";
import { verifyF197Module } from "./f197-protocol-safety-property-verifier.js";
import { verifyF198Module } from "./f198-state-space-digest-certifier.js";
import { verifyF199Module } from "./f199-csp-resource-placement-solver.js";
import { verifyF200Module } from "./f200-anti-affinity-fault-domain-guard.js";
import { verifyF201Module } from "./f201-gpu-vram-capacity-bin-packer.js";
import { verifyF202Module } from "./f202-sla-cost-minimizing-scheduler.js";
import { verifyF203Module } from "./f203-infeasible-constraint-conflict-explainer.js";
import { verifyF204Module } from "./f204-deterministic-placement-matrix-exporter.js";
import { verifyF205Module } from "./f205-w3c-traceparent-header-propagator.js";
import { verifyF206Module } from "./f206-distributed-span-dag-assembler.js";
import { verifyF207Module } from "./f207-critical-path-latency-analyzer.js";
import { verifyF208Module } from "./f208-self-time-bottleneck-detector.js";
import { verifyF209Module } from "./f209-cross-service-clock-skew-normalizer.js";
import { verifyF210Module } from "./f210-trace-telemetry-digest-sealer.js";
import { verifyF211Module } from "./f211-execution-cassette-recorder.js";
import { verifyF212Module } from "./f212-bit-exact-deterministic-replayer.js";
import { verifyF213Module } from "./f213-replay-divergence-pinpointer.js";
import { verifyF214Module } from "./f214-cassette-tamper-seal-verifier.js";
import { verifyF215Module } from "./f215-regression-golden-cassette-comparator.js";
import { verifyF216Module } from "./f216-time-travel-state-hydration-engine.js";
import { verifyF217Module } from "./f217-static-dataflow-taint-tracker.js";
import { verifyF218Module } from "./f218-dangerous-sink-invocation-blocker.js";
import { verifyF219Module } from "./f219-sanitizer-effectiveness-verifier.js";
import { verifyF220Module } from "./f220-transitive-variable-taint-propagator.js";
import { verifyF221Module } from "./f221-code-injection-sink-auditor.js";
import { verifyF222Module } from "./f222-automated-security-gate-enforcer.js";
import { verifyF223Module } from "./f223-multi-stage-formal-proof-aggregator.js";
import { verifyF224Module } from "./f224-stage7-formal-verification-readiness.js";

export function verifyStage_stage7_formal_verification() {
  const results = [
    verifyF193Module(),
    verifyF194Module(),
    verifyF195Module(),
    verifyF196Module(),
    verifyF197Module(),
    verifyF198Module(),
    verifyF199Module(),
    verifyF200Module(),
    verifyF201Module(),
    verifyF202Module(),
    verifyF203Module(),
    verifyF204Module(),
    verifyF205Module(),
    verifyF206Module(),
    verifyF207Module(),
    verifyF208Module(),
    verifyF209Module(),
    verifyF210Module(),
    verifyF211Module(),
    verifyF212Module(),
    verifyF213Module(),
    verifyF214Module(),
    verifyF215Module(),
    verifyF216Module(),
    verifyF217Module(),
    verifyF218Module(),
    verifyF219Module(),
    verifyF220Module(),
    verifyF221Module(),
    verifyF222Module(),
    verifyF223Module(),
    verifyF224Module()
  ];
  const verifiedCount = results.filter((r) => r.verified).length;
  return {
    stage: "stage7-formal-verification" as const,
    totalModules: results.length,
    verifiedCount,
    results,
    digests: results.map((r) => ({ featureId: r.featureId, digest: r.provenanceDigest }))
  };
}
