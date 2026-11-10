export type CnfLiteral = {
  variable: string;
  negated: boolean;
};

export type CnfClause = CnfLiteral[];

export interface SatSolverResult {
  satisfiable: boolean;
  assignment: Record<string, boolean> | null;
  unitPropagationsCount: number;
  decisionsCount: number;
}

/**
 * Pure TypeScript DPLL / CDCL-Inspired Boolean Satisfiability (SAT) Solver.
 * Combines iterative Unit Propagation, Pure Literal Elimination, and MOMS (Maximum Occurrences
 * in Clauses of Minimum Size) variable branching for formal configuration & dependency verification.
 */
export class DpllCdclSatSolver {
  public static solveCnf(clauses: CnfClause[]): SatSolverResult {
    let unitPropagationsCount = 0;
    let decisionsCount = 0;

    const allVars = new Set<string>();
    for (const c of clauses) {
      for (const lit of c) {
        allVars.add(lit.variable);
      }
    }

    const simplifyClauses = (
      currentClauses: CnfClause[],
      variable: string,
      val: boolean
    ): CnfClause[] | null => {
      const next: CnfClause[] = [];
      for (const clause of currentClauses) {
        let clauseSatisfied = false;
        const remainingLits: CnfLiteral[] = [];
        for (const lit of clause) {
          if (lit.variable === variable) {
            const litVal = lit.negated ? !val : val;
            if (litVal) {
              clauseSatisfied = true;
              break;
            }
          } else {
            remainingLits.push(lit);
          }
        }
        if (clauseSatisfied) continue;
        if (remainingLits.length === 0) {
          // Conflict: empty clause!
          return null;
        }
        next.push(remainingLits);
      }
      return next;
    };

    const dpll = (
      activeClauses: CnfClause[],
      partialAssign: Record<string, boolean>
    ): Record<string, boolean> | null => {
      let clausesNow = activeClauses;
      const assignNow = { ...partialAssign };

      // 1. Iterative Unit Propagation
      let changed = true;
      while (changed) {
        changed = false;
        for (const c of clausesNow) {
          if (c.length === 1) {
            const unitLit = c[0]!;
            const val = !unitLit.negated;
            assignNow[unitLit.variable] = val;
            unitPropagationsCount++;
            const simplified = simplifyClauses(clausesNow, unitLit.variable, val);
            if (simplified === null) return null;
            clausesNow = simplified;
            changed = true;
            break;
          }
        }
      }

      if (clausesNow.length === 0) {
        for (const v of allVars) {
          if (assignNow[v] === undefined) assignNow[v] = false;
        }
        return assignNow;
      }

      // 2. Pure Literal Elimination
      const polarityMap = new Map<string, { pos: boolean; neg: boolean }>();
      for (const c of clausesNow) {
        for (const lit of c) {
          const cur = polarityMap.get(lit.variable) ?? { pos: false, neg: false };
          if (lit.negated) cur.neg = true;
          else cur.pos = true;
          polarityMap.set(lit.variable, cur);
        }
      }

      for (const [v, pol] of polarityMap.entries()) {
        if (pol.pos !== pol.neg) {
          const pureVal = pol.pos;
          assignNow[v] = pureVal;
          const simplified = simplifyClauses(clausesNow, v, pureVal);
          if (simplified === null) return null;
          clausesNow = simplified;
        }
      }

      if (clausesNow.length === 0) {
        for (const v of allVars) {
          if (assignNow[v] === undefined) assignNow[v] = false;
        }
        return assignNow;
      }

      // 3. MOMS Branching Heuristic: choose variable in shortest clause
      let minLen = Infinity;
      for (const c of clausesNow) {
        if (c.length < minLen) minLen = c.length;
      }
      const freq = new Map<string, number>();
      for (const c of clausesNow) {
        if (c.length === minLen) {
          for (const lit of c) {
            freq.set(lit.variable, (freq.get(lit.variable) ?? 0) + 1);
          }
        }
      }

      let chosenVar = clausesNow[0]![0]!.variable;
      let bestCount = -1;
      for (const [v, cnt] of freq.entries()) {
        if (cnt > bestCount) {
          bestCount = cnt;
          chosenVar = v;
        }
      }

      decisionsCount++;
      for (const tryVal of [true, false]) {
        const nextClauses = simplifyClauses(clausesNow, chosenVar, tryVal);
        if (nextClauses !== null) {
          const res = dpll(nextClauses, { ...assignNow, [chosenVar]: tryVal });
          if (res !== null) return res;
        }
      }

      return null;
    };

    const assignment = dpll(clauses, {});
    return {
      satisfiable: assignment !== null,
      assignment,
      unitPropagationsCount,
      decisionsCount
    };
  }
}
