export interface TemporalStateSnapshot {
  stepIndex: number;
  stateLabel: string;
  atomicPropositions: string[]; // True propositions at this state
}

export type LtlFormulaSpec =
  | {
      kind: "always_globally"; // G(p): proposition must hold in every state
      proposition: string;
    }
  | {
      kind: "eventually"; // F(p): proposition must hold in at least one state
      proposition: string;
    }
  | {
      kind: "until"; // p U q: p must hold at every step prior to the first step where q holds, and q must eventually hold
      holdProposition: string;
      goalProposition: string;
    }
  | {
      kind: "response_leads_to"; // G(trigger -> F(response)): every state with `trigger` must be followed at or after that step by `response`
      triggerProposition: string;
      responseProposition: string;
    }
  | {
      kind: "mutual_exclusion"; // G(!(p && q)): p and q can never hold simultaneously
      propA: string;
      propB: string;
    };

export interface LtlModelCheckResult {
  satisfied: boolean;
  formulaKind: LtlFormulaSpec["kind"];
  violatingStepIndex: number | null;
  counterexampleTraceSlice: TemporalStateSnapshot[];
  explanation: string;
}

/**
 * Linear Temporal Logic (LTL) & Kripke Trace Model Checker.
 * Formally verifies safety (`always_globally`, `mutual_exclusion`) and liveness
 * (`eventually`, `until`, `response_leads_to`) temporal formulas over execution traces.
 */
export class LtlTemporalModelChecker {
  public static verifyTrace(
    trace: TemporalStateSnapshot[],
    formula: LtlFormulaSpec
  ): LtlModelCheckResult {
    if (trace.length === 0) {
      return {
        satisfied: false,
        formulaKind: formula.kind,
        violatingStepIndex: null,
        counterexampleTraceSlice: [],
        explanation: "Trace is empty."
      };
    }

    const hasProp = (s: TemporalStateSnapshot, p: string) =>
      s.atomicPropositions.includes(p);

    if (formula.kind === "always_globally") {
      for (let i = 0; i < trace.length; i++) {
        if (!hasProp(trace[i]!, formula.proposition)) {
          return {
            satisfied: false,
            formulaKind: formula.kind,
            violatingStepIndex: i,
            counterexampleTraceSlice: trace.slice(0, i + 1),
            explanation: `Invariant G(${formula.proposition}) violated at step #${i} (${trace[i]!.stateLabel}).`
          };
        }
      }
      return {
        satisfied: true,
        formulaKind: formula.kind,
        violatingStepIndex: null,
        counterexampleTraceSlice: [],
        explanation: `Invariant G(${formula.proposition}) held across all ${trace.length} states.`
      };
    }

    if (formula.kind === "mutual_exclusion") {
      for (let i = 0; i < trace.length; i++) {
        const s = trace[i]!;
        if (hasProp(s, formula.propA) && hasProp(s, formula.propB)) {
          return {
            satisfied: false,
            formulaKind: formula.kind,
            violatingStepIndex: i,
            counterexampleTraceSlice: trace.slice(0, i + 1),
            explanation: `Mutual exclusion G(!(${formula.propA} & ${formula.propB})) violated at step #${i}.`
          };
        }
      }
      return {
        satisfied: true,
        formulaKind: formula.kind,
        violatingStepIndex: null,
        counterexampleTraceSlice: [],
        explanation: `Mutual exclusion held across all ${trace.length} states.`
      };
    }

    if (formula.kind === "eventually") {
      const idx = trace.findIndex((s) => hasProp(s, formula.proposition));
      if (idx !== -1) {
        return {
          satisfied: true,
          formulaKind: formula.kind,
          violatingStepIndex: null,
          counterexampleTraceSlice: [],
          explanation: `Liveness F(${formula.proposition}) satisfied at step #${idx}.`
        };
      }
      return {
        satisfied: false,
        formulaKind: formula.kind,
        violatingStepIndex: trace.length - 1,
        counterexampleTraceSlice: [...trace],
        explanation: `Liveness F(${formula.proposition}) never occurred in trace.`
      };
    }

    if (formula.kind === "until") {
      for (let i = 0; i < trace.length; i++) {
        if (hasProp(trace[i]!, formula.goalProposition)) {
          return {
            satisfied: true,
            formulaKind: formula.kind,
            violatingStepIndex: null,
            counterexampleTraceSlice: [],
            explanation: `Formula (${formula.holdProposition} U ${formula.goalProposition}) satisfied at step #${i}.`
          };
        }
        if (!hasProp(trace[i]!, formula.holdProposition)) {
          return {
            satisfied: false,
            formulaKind: formula.kind,
            violatingStepIndex: i,
            counterexampleTraceSlice: trace.slice(0, i + 1),
            explanation: `'${formula.holdProposition}' dropped at step #${i} before '${formula.goalProposition}' became true.`
          };
        }
      }
      return {
        satisfied: false,
        formulaKind: formula.kind,
        violatingStepIndex: trace.length - 1,
        counterexampleTraceSlice: [...trace],
        explanation: `Goal '${formula.goalProposition}' never became true before end of trace.`
      };
    }

    // response_leads_to: G(trigger -> F(response))
    for (let i = 0; i < trace.length; i++) {
      if (hasProp(trace[i]!, formula.triggerProposition)) {
        let responded = false;
        for (let j = i; j < trace.length; j++) {
          if (hasProp(trace[j]!, formula.responseProposition)) {
            responded = true;
            break;
          }
        }
        if (!responded) {
          return {
            satisfied: false,
            formulaKind: formula.kind,
            violatingStepIndex: i,
            counterexampleTraceSlice: trace.slice(i),
            explanation: `Trigger '${formula.triggerProposition}' at step #${i} was never followed by '${formula.responseProposition}'.`
          };
        }
      }
    }

    return {
      satisfied: true,
      formulaKind: formula.kind,
      violatingStepIndex: null,
      counterexampleTraceSlice: [],
      explanation: `Response property G(${formula.triggerProposition} -> F(${formula.responseProposition})) satisfied.`
    };
  }
}
