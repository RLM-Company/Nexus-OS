export { Stage8FinOpsKernel } from "./stage-kernel.js";
export * from "./f225-ucb1-multi-armed-bandit-router.js";
export * from "./f226-ewma-latency-slo-penalty-calculator.js";
export * from "./f227-circuit-breaker-arm-quarantine-guard.js";
export * from "./f228-cost-aware-token-utility-optimizer.js";
export * from "./f229-cold-start-provider-exploration-scheduler.js";
export * from "./f230-bandit-telemetry-posterior-updater.js";
export * from "./f231-ols-burn-rate-trend-forecaster.js";
export * from "./f232-zscore-spend-spike-anomaly-detector.js";
export * from "./f233-budget-exhaustion-time-predictor.js";
export * from "./f234-multi-tier-finops-alert-escalator.js";
export * from "./f235-tenant-cost-trajectory-auditor.js";
export * from "./f236-automated-budget-throttle-governor.js";
export * from "./f237-differential-privacy-laplace-calibrator.js";
export * from "./f238-privacy-budget-accountant-ledger.js";
export * from "./f239-epsilon-exhaustion-query-guard.js";
export * from "./f240-sensitivity-bounded-analytics-aggregator.js";
export * from "./f241-dp-cryptographic-receipt-issuer.js";
export * from "./f242-cross-workspace-privacy-leakage-preventer.js";
export * from "./f243-merkle-compliance-tree-builder.js";
export * from "./f244-selective-disclosure-inclusion-prover.js";
export * from "./f245-zero-leakage-merkle-proof-verifier.js";
export * from "./f246-salted-leaf-preimage-protector.js";
export * from "./f247-regulatory-audit-claim-attester.js";
export * from "./f248-tamper-resistant-merkle-root-registry.js";
export * from "./f249-rtbf-subject-data-inventory-indexer.js";
export * from "./f250-cryptographic-shredding-rtbf-cascade.js";
export * from "./f251-signed-erasure-certificate-generator.js";
export * from "./f252-zero-residue-post-erasure-verifier.js";
export * from "./f253-cross-tenant-rtbf-isolation-guard.js";
export * from "./f254-idempotent-erasure-replay-handler.js";
export * from "./f255-unified-finops-privacy-governance-hub.js";
export * from "./f256-kosmora-256-master-architecture-certifier.js";

import { verifyF225Module } from "./f225-ucb1-multi-armed-bandit-router.js";
import { verifyF226Module } from "./f226-ewma-latency-slo-penalty-calculator.js";
import { verifyF227Module } from "./f227-circuit-breaker-arm-quarantine-guard.js";
import { verifyF228Module } from "./f228-cost-aware-token-utility-optimizer.js";
import { verifyF229Module } from "./f229-cold-start-provider-exploration-scheduler.js";
import { verifyF230Module } from "./f230-bandit-telemetry-posterior-updater.js";
import { verifyF231Module } from "./f231-ols-burn-rate-trend-forecaster.js";
import { verifyF232Module } from "./f232-zscore-spend-spike-anomaly-detector.js";
import { verifyF233Module } from "./f233-budget-exhaustion-time-predictor.js";
import { verifyF234Module } from "./f234-multi-tier-finops-alert-escalator.js";
import { verifyF235Module } from "./f235-tenant-cost-trajectory-auditor.js";
import { verifyF236Module } from "./f236-automated-budget-throttle-governor.js";
import { verifyF237Module } from "./f237-differential-privacy-laplace-calibrator.js";
import { verifyF238Module } from "./f238-privacy-budget-accountant-ledger.js";
import { verifyF239Module } from "./f239-epsilon-exhaustion-query-guard.js";
import { verifyF240Module } from "./f240-sensitivity-bounded-analytics-aggregator.js";
import { verifyF241Module } from "./f241-dp-cryptographic-receipt-issuer.js";
import { verifyF242Module } from "./f242-cross-workspace-privacy-leakage-preventer.js";
import { verifyF243Module } from "./f243-merkle-compliance-tree-builder.js";
import { verifyF244Module } from "./f244-selective-disclosure-inclusion-prover.js";
import { verifyF245Module } from "./f245-zero-leakage-merkle-proof-verifier.js";
import { verifyF246Module } from "./f246-salted-leaf-preimage-protector.js";
import { verifyF247Module } from "./f247-regulatory-audit-claim-attester.js";
import { verifyF248Module } from "./f248-tamper-resistant-merkle-root-registry.js";
import { verifyF249Module } from "./f249-rtbf-subject-data-inventory-indexer.js";
import { verifyF250Module } from "./f250-cryptographic-shredding-rtbf-cascade.js";
import { verifyF251Module } from "./f251-signed-erasure-certificate-generator.js";
import { verifyF252Module } from "./f252-zero-residue-post-erasure-verifier.js";
import { verifyF253Module } from "./f253-cross-tenant-rtbf-isolation-guard.js";
import { verifyF254Module } from "./f254-idempotent-erasure-replay-handler.js";
import { verifyF255Module } from "./f255-unified-finops-privacy-governance-hub.js";
import { verifyF256Module } from "./f256-kosmora-256-master-architecture-certifier.js";

export function verifyStage_stage8_finops_compliance() {
  const results = [
    verifyF225Module(),
    verifyF226Module(),
    verifyF227Module(),
    verifyF228Module(),
    verifyF229Module(),
    verifyF230Module(),
    verifyF231Module(),
    verifyF232Module(),
    verifyF233Module(),
    verifyF234Module(),
    verifyF235Module(),
    verifyF236Module(),
    verifyF237Module(),
    verifyF238Module(),
    verifyF239Module(),
    verifyF240Module(),
    verifyF241Module(),
    verifyF242Module(),
    verifyF243Module(),
    verifyF244Module(),
    verifyF245Module(),
    verifyF246Module(),
    verifyF247Module(),
    verifyF248Module(),
    verifyF249Module(),
    verifyF250Module(),
    verifyF251Module(),
    verifyF252Module(),
    verifyF253Module(),
    verifyF254Module(),
    verifyF255Module(),
    verifyF256Module()
  ];
  const verifiedCount = results.filter((r) => r.verified).length;
  return {
    stage: "stage8-finops-compliance" as const,
    totalModules: results.length,
    verifiedCount,
    results,
    digests: results.map((r) => ({ featureId: r.featureId, digest: r.provenanceDigest }))
  };
}
