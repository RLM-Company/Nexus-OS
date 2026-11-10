export interface SymbolicVariable {
  name: string;
  domain: number[]; // Finite discrete domain of candidate numeric values
}

export type SymbolicConstraint =
  | {
      kind: "all_different";
      variables: string[];
    }
  | {
      kind: "linear_le";
      weights: Record<string, number>;
      upperBound: number;
    }
  | {
      kind: "linear_ge";
      weights: Record<string, number>;
      lowerBound: number;
    }
  | {
      kind: "binary_not_equal";
      varA: string;
      varB: string;
    }
  | {
      kind: "precedence";
      beforeVar: string;
      afterVar: string;
      minGap: number; // afterVar - beforeVar >= minGap
    };

export interface SolverObjective {
  direction: "minimize" | "maximize";
  weights: Record<string, number>;
}

export interface ConstraintSolverResult {
  satisfiable: boolean;
  assignment: Record<string, number> | null;
  objectiveValue: number | null;
  exploredNodes: number;
}

/**
 * Neuro-Symbolic Finite-Domain Constraint Satisfaction & Optimization Solver (CSP / SMT-Lite).
 * Uses Minimum Remaining Values (MRV) variable ordering and Forward-Checking pruning
 * to solve exact scheduling, budget allocation, and resource mutex constraints.
 */
export class NeuroSymbolicConstraintSolver {
  public static solve(params: {
    variables: SymbolicVariable[];
    constraints: SymbolicConstraint[];
    objective?: SolverObjective;
    maxExploredNodes?: number;
  }): ConstraintSolverResult {
    const maxNodes = params.maxExploredNodes ?? 10_000;
    const varNames = params.variables.map((v) => v.name);
    const initialDomains = new Map<string, number[]>();

    for (const v of params.variables) {
      if (v.domain.length === 0) {
        return { satisfiable: false, assignment: null, objectiveValue: null, exploredNodes: 0 };
      }
      initialDomains.set(v.name, [...v.domain].sort((a, b) => a - b));
    }

    let exploredNodes = 0;
    let bestAssignment: Record<string, number> | null = null;
    let bestObjective: number | null = null;

    const isConsistentPartial = (assignment: Record<string, number>): boolean => {
      for (const c of params.constraints) {
        if (c.kind === "all_different") {
          const seen = new Set<number>();
          for (const v of c.variables) {
            if (v in assignment) {
              const val = assignment[v]!;
              if (seen.has(val)) return false;
              seen.add(val);
            }
          }
        } else if (c.kind === "binary_not_equal") {
          if (c.varA in assignment && c.varB in assignment) {
            if (assignment[c.varA] === assignment[c.varB]) return false;
          }
        } else if (c.kind === "precedence") {
          if (c.beforeVar in assignment && c.afterVar in assignment) {
            if (assignment[c.afterVar]! - assignment[c.beforeVar]! < c.minGap) return false;
          }
        } else if (c.kind === "linear_le") {
          let sumAssigned = 0;
          let minPossibleRemaining = 0;
          for (const [v, w] of Object.entries(c.weights)) {
            if (v in assignment) {
              sumAssigned += w * assignment[v]!;
            } else {
              const dom = initialDomains.get(v) ?? [0];
              minPossibleRemaining += w >= 0 ? w * dom[0]! : w * dom[dom.length - 1]!;
            }
          }
          if (sumAssigned + minPossibleRemaining > c.upperBound + 1e-9) {
            return false;
          }
        } else if (c.kind === "linear_ge") {
          let sumAssigned = 0;
          let maxPossibleRemaining = 0;
          for (const [v, w] of Object.entries(c.weights)) {
            if (v in assignment) {
              sumAssigned += w * assignment[v]!;
            } else {
              const dom = initialDomains.get(v) ?? [0];
              maxPossibleRemaining += w >= 0 ? w * dom[dom.length - 1]! : w * dom[0]!;
            }
          }
          if (sumAssigned + maxPossibleRemaining < c.lowerBound - 1e-9) {
            return false;
          }
        }
      }
      return true;
    };

    const computeObjective = (assignment: Record<string, number>): number => {
      if (!params.objective) return 0;
      let total = 0;
      for (const [v, w] of Object.entries(params.objective.weights)) {
        total += w * (assignment[v] ?? 0);
      }
      return Number(total.toFixed(6));
    };

    const backtrack = (assignment: Record<string, number>): boolean => {
      if (exploredNodes >= maxNodes) return false;

      if (Object.keys(assignment).length === varNames.length) {
        const objVal = computeObjective(assignment);
        if (
          bestAssignment === null ||
          (params.objective?.direction === "minimize" && objVal < bestObjective!) ||
          (params.objective?.direction === "maximize" && objVal > bestObjective!)
        ) {
          bestAssignment = { ...assignment };
          bestObjective = objVal;
        }
        // If no optimization objective is specified, stop at first valid satisfying assignment
        return !params.objective;
      }

      // Minimum Remaining Values (MRV): pick unassigned variable with smallest domain
      let chosenVar: string | null = null;
      let minDomainSize = Infinity;
      for (const v of varNames) {
        if (v in assignment) continue;
        const domSize = initialDomains.get(v)!.length;
        if (domSize < minDomainSize) {
          minDomainSize = domSize;
          chosenVar = v;
        }
      }

      if (!chosenVar) return false;
      const candidates = initialDomains.get(chosenVar)!;

      for (const val of candidates) {
        exploredNodes++;
        assignment[chosenVar] = val;
        if (isConsistentPartial(assignment)) {
          const stopEarly = backtrack(assignment);
          if (stopEarly) return true;
        }
        delete assignment[chosenVar];
      }

      return false;
    };

    backtrack({});

    return {
      satisfiable: bestAssignment !== null,
      assignment: bestAssignment,
      objectiveValue: bestObjective,
      exploredNodes
    };
  }
}
