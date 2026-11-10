export interface DialecticalThesis {
  proposalTitle: string;
  coreClaims: string[];
  assumptions: string[];
  targetEnvironment?: {
    ramLimitMb?: number;
    requiresOfflineExecution?: boolean;
    hasConcurrentWriters?: boolean;
    handlesUntrustedInput?: boolean;
  };
}

export interface AntithesisObjection {
  id: string;
  vulnerabilityKind:
    | "memory_oom_risk"
    | "offline_network_violation"
    | "race_condition_hazard"
    | "injection_attack_surface"
    | "unverified_assumption";
  severity: "critical" | "high" | "medium";
  critique: string;
  requiredMitigation: string;
}

export interface DialecticalSynthesisReport {
  proposalTitle: string;
  thesisClaimsCount: number;
  antithesisObjections: AntithesisObjection[];
  synthesizedMitigations: string[];
  dialecticalRobustnessScore: number; // [0..1] after synthesis
  readyForExecution: boolean;
}

/**
 * Dialectical Thesis–Antithesis–Synthesis Debate & Devil's Advocate Engine.
 * Eliminates LLM sycophancy and confirmation bias by subjecting every architectural
 * or strategic Thesis to an automated Devil's Advocate Antithesis pass, then synthesizing
 * concrete engineering mitigations for every identified failure mode.
 */
export class DialecticalDebateSynthesizer {
  public static runDialecticalTriad(
    thesis: DialecticalThesis,
    providedMitigations: string[] = []
  ): DialecticalSynthesisReport {
    const objections: AntithesisObjection[] = [];
    const joinedClaims = `${thesis.proposalTitle} ${thesis.coreClaims.join(" ")} ${thesis.assumptions.join(" ")}`.toLowerCase();
    const joinedMitigations = providedMitigations.join(" ").toLowerCase();

    const env = thesis.targetEnvironment ?? {};

    // 1. Check 1 GB RAM / low-memory pressure
    if (
      (env.ramLimitMb !== undefined && env.ramLimitMb <= 1024) ||
      /(in-memory|all records|full table|1gb|1 гб)/i.test(joinedClaims)
    ) {
      objections.push({
        id: "anti_oom_1gb",
        vulnerabilityKind: "memory_oom_risk",
        severity: "critical",
        critique:
          "Unbounded in-memory buffering risks OOM termination on 1 GB RAM nodes.",
        requiredMitigation:
          "Enforce bounded batch streaming, Product Quantization (32x), or disk-backed spooling."
      });
    }

    // 2. Check offline sandbox / air-gapped constraint
    if (
      env.requiresOfflineExecution &&
      /(fetch\(|http:\/\/|https:\/\/|npm install|pip install|curl\s)/i.test(joinedClaims)
    ) {
      objections.push({
        id: "anti_offline_net",
        vulnerabilityKind: "offline_network_violation",
        severity: "critical",
        critique:
          "Thesis references outbound network or package manager calls inside an offline-restricted environment.",
        requiredMitigation:
          "Replace external network/package dependencies with zero-dependency local Node.js/SQLite primitives."
      });
    }

    // 3. Check concurrent writer race condition
    if (env.hasConcurrentWriters) {
      objections.push({
        id: "anti_race_writers",
        vulnerabilityKind: "race_condition_hazard",
        severity: "high",
        critique:
          "Concurrent writers can corrupt shared state or interleave partial snapshots.",
        requiredMitigation:
          "Wrap mutations in BEGIN IMMEDIATE transactions and enforce BEFORE INSERT/UPDATE quiesce triggers."
      });
    }

    // 4. Check untrusted external input surface
    if (env.handlesUntrustedInput) {
      objections.push({
        id: "anti_untrusted_input",
        vulnerabilityKind: "injection_attack_surface",
        severity: "critical",
        critique:
          "Untrusted input can trigger prompt injection, Zip-Slip path traversal, or script breakout.",
        requiredMitigation:
          "Apply cryptographic nonce spotlighting, path.resolve prefix containment, and schema validation."
      });
    }

    // 5. Challenge each unverified assumption
    thesis.assumptions.forEach((assumption, idx) => {
      objections.push({
        id: `anti_assumption_${idx + 1}`,
        vulnerabilityKind: "unverified_assumption",
        severity: "medium",
        critique: `Unverified assumption: '${assumption}' may fail under degraded edge conditions.`,
        requiredMitigation: `Add explicit pre-flight assertion and fallback guard for: ${assumption}`
      });
    });

    // Synthesize resolution: combine user-provided mitigations with mandatory Antithesis mitigations
    const synthesizedMitigations = [...providedMitigations];
    let unresolvedCriticalCount = 0;

    for (const obj of objections) {
      const keywords = obj.requiredMitigation
        .toLowerCase()
        .match(/[a-z0-9\u0400-\u04ff]{5,}/g) ?? [];
      const alreadyCovered = keywords.some((kw) => joinedMitigations.includes(kw));
      if (!alreadyCovered) {
        synthesizedMitigations.push(`[Synthesized Guard for ${obj.id}] ${obj.requiredMitigation}`);
        if (obj.severity === "critical" && providedMitigations.length > 0) {
          unresolvedCriticalCount++;
        }
      }
    }

    const baseScore = Math.max(
      0.2,
      1.0 - unresolvedCriticalCount * 0.25 - objections.length * 0.03
    );
    const dialecticalRobustnessScore = Number(
      Math.min(1.0, baseScore + synthesizedMitigations.length * 0.04).toFixed(4)
    );

    return {
      proposalTitle: thesis.proposalTitle,
      thesisClaimsCount: thesis.coreClaims.length,
      antithesisObjections: objections,
      synthesizedMitigations,
      dialecticalRobustnessScore,
      readyForExecution: synthesizedMitigations.length >= objections.length
    };
  }
}
