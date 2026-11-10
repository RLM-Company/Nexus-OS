export interface RelationalStructureTriple {
  relation: "causes" | "guards" | "buffers" | "indexes" | "verifies" | "transforms";
  sourceRole: string;
  targetRole: string;
}

export interface SolvedCaseTemplate {
  caseId: string;
  domain: string;
  title: string;
  structuralTriples: RelationalStructureTriple[];
  solutionSkeletonSteps: string[];
}

export interface AnalogicalTransferResult {
  matchedCaseId: string;
  sourceDomain: string;
  structuralIsomorphismScore: number; // [0..1]
  roleMapping: Record<string, string>; // sourceRole -> targetRole
  transferredSolutionPlan: string[];
}

const BUILTIN_SOLVED_CASES: SolvedCaseTemplate[] = [
  {
    caseId: "case_drive_spool_retry",
    domain: "cloud_storage",
    title: "Immutable Local Spool + Exponential Backoff Upload",
    structuralTriples: [
      { relation: "buffers", sourceRole: "ProducerPayload", targetRole: "ImmutableSpool" },
      { relation: "guards", sourceRole: "ChecksumVerifier", targetRole: "ImmutableSpool" },
      { relation: "transforms", sourceRole: "ImmutableSpool", targetRole: "RemoteEndpoint" }
    ],
    solutionSkeletonSteps: [
      "1. Persist raw {{ProducerPayload}} bytes into an append-only {{ImmutableSpool}} before network dispatch.",
      "2. Verify SHA-256 integrity via {{ChecksumVerifier}} prior to transmission.",
      "3. Stream from {{ImmutableSpool}} to {{RemoteEndpoint}} with idempotent retry on transient failure."
    ]
  },
  {
    caseId: "case_sqlite_trigger_fence",
    domain: "database_isolation",
    title: "Pre-Write Trigger Quiesce Fencing",
    structuralTriples: [
      { relation: "guards", sourceRole: "LifecycleGate", targetRole: "MutableStore" },
      { relation: "causes", sourceRole: "ConcurrentWriter", targetRole: "MutableStore" },
      { relation: "verifies", sourceRole: "SnapshotAuditor", targetRole: "MutableStore" }
    ],
    solutionSkeletonSteps: [
      "1. Enforce a pre-write {{LifecycleGate}} check before any {{ConcurrentWriter}} mutates {{MutableStore}}.",
      "2. Reject concurrent writes deterministically while {{LifecycleGate}} is in quiesced state.",
      "3. Run {{SnapshotAuditor}} over {{MutableStore}} once quiesced."
    ]
  }
];

/**
 * Analogical Case-Based Reasoning (CBR) & Structural Isomorphism Matcher.
 * Implements Gentner's Structure-Mapping Theory: matches novel problems by their relational
 * topology (`relation(sourceRole, targetRole)`) rather than superficial domain keywords,
 * mapping roles and transferring proven architectural solutions across domains.
 */
export class AnalogicalCaseBasedReasoner {
  private readonly cases: SolvedCaseTemplate[];

  constructor(customCases?: SolvedCaseTemplate[]) {
    this.cases = [...BUILTIN_SOLVED_CASES, ...(customCases ?? [])];
  }

  public registerSolvedCase(template: SolvedCaseTemplate): void {
    this.cases.push(template);
  }

  public findBestAnalogyAndTransfer(
    targetTriples: RelationalStructureTriple[]
  ): AnalogicalTransferResult | null {
    if (targetTriples.length === 0 || this.cases.length === 0) return null;

    let bestCase: SolvedCaseTemplate | null = null;
    let bestScore = -1;
    let bestMapping: Record<string, string> = {};

    for (const candidate of this.cases) {
      const roleMapping: Record<string, string> = {};
      const usedTargetIndices = new Set<number>();
      let matchedRelations = 0;

      for (const srcTriple of candidate.structuralTriples) {
        // Find a target triple with the exact same structural relation type
        let matchedIdx = -1;
        for (let i = 0; i < targetTriples.length; i++) {
          if (usedTargetIndices.has(i)) continue;
          const tgt = targetTriples[i]!;
          if (tgt.relation === srcTriple.relation) {
            // Check role mapping consistency
            const existingSrcMap = roleMapping[srcTriple.sourceRole];
            const existingTgtMap = roleMapping[srcTriple.targetRole];
            if (
              (!existingSrcMap || existingSrcMap === tgt.sourceRole) &&
              (!existingTgtMap || existingTgtMap === tgt.targetRole)
            ) {
              matchedIdx = i;
              break;
            }
          }
        }

        if (matchedIdx !== -1) {
          usedTargetIndices.add(matchedIdx);
          matchedRelations++;
          const tgt = targetTriples[matchedIdx]!;
          roleMapping[srcTriple.sourceRole] = tgt.sourceRole;
          roleMapping[srcTriple.targetRole] = tgt.targetRole;
        }
      }

      const denom = Math.max(candidate.structuralTriples.length, targetTriples.length);
      const score = denom > 0 ? matchedRelations / denom : 0;

      if (score > bestScore) {
        bestScore = score;
        bestCase = candidate;
        bestMapping = roleMapping;
      }
    }

    if (!bestCase || bestScore <= 0) return null;

    const transferredSolutionPlan = bestCase.solutionSkeletonSteps.map((step) =>
      step.replace(/\{\{([A-Za-z0-9_]+)\}\}/g, (_, roleName: string) => bestMapping[roleName] ?? roleName)
    );

    return {
      matchedCaseId: bestCase.caseId,
      sourceDomain: bestCase.domain,
      structuralIsomorphismScore: Number(bestScore.toFixed(4)),
      roleMapping: bestMapping,
      transferredSolutionPlan
    };
  }
}
