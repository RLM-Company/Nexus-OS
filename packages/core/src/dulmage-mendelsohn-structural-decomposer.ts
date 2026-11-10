export interface DulmageMendelsohnDecomposition {
  underConstrainedVariables: string[];
  underConstrainedEquations: string[];
  overConstrainedVariables: string[];
  overConstrainedEquations: string[];
  wellConstrainedVariables: string[];
  wellConstrainedEquations: string[];
  maximumMatchingSize: number;
}

/**
 * Dulmage-Mendelsohn Canonical Structural Decomposition for Bipartite Constraint Systems.
 * Given a bipartite incidence graph between Variables V and Equations E:
 * 1. Computes a maximum bipartite matching M.
 * 2. Reachability via alternating paths from unmatched variables V_0 identifies the
 *    Under-Constrained subsystem D_U = (V_U, E_U) where |V_U| > |E_U|.
 * 3. Reachability via alternating paths from unmatched equations E_0 identifies the
 *    Over-Constrained subsystem D_O = (V_O, E_O) where |E_O| > |V_O|.
 * 4. Remaining matched vertices form the Well-Constrained (square) subsystem D_W.
 */
export class DulmageMendelsohnCanonicalDecomposer {
  public static decomposeBipartiteSystem(
    variables: string[],
    equations: string[],
    incidenceEdges: Array<{ variable: string; equation: string }>
  ): DulmageMendelsohnDecomposition {
    const varAdj = new Map<string, string[]>(variables.map((v) => [v, []]));
    const eqAdj = new Map<string, string[]>(equations.map((e) => [e, []]));

    for (const edge of incidenceEdges) {
      varAdj.get(edge.variable)?.push(edge.equation);
      eqAdj.get(edge.equation)?.push(edge.variable);
    }

    // 1. Maximum matching via Kuhn's augmenting paths
    const matchEqToVar = new Map<string, string>();
    const matchVarToEq = new Map<string, string>();

    const dfsAugment = (v: string, visitedEqs: Set<string>): boolean => {
      for (const eq of varAdj.get(v) ?? []) {
        if (visitedEqs.has(eq)) continue;
        visitedEqs.add(eq);
        const ownerVar = matchEqToVar.get(eq);
        if (ownerVar === undefined || dfsAugment(ownerVar, visitedEqs)) {
          matchEqToVar.set(eq, v);
          matchVarToEq.set(v, eq);
          return true;
        }
      }
      return false;
    };

    for (const v of variables) {
      dfsAugment(v, new Set());
    }

    // 2. Alternating BFS from unmatched variables: V --(unmatched)--> E --(matched)--> V
    const underVars = new Set<string>();
    const underEqs = new Set<string>();
    const qVar: string[] = [];

    for (const v of variables) {
      if (!matchVarToEq.has(v)) {
        underVars.add(v);
        qVar.push(v);
      }
    }

    while (qVar.length > 0) {
      const v = qVar.shift()!;
      for (const eq of varAdj.get(v) ?? []) {
        if (matchVarToEq.get(v) === eq || underEqs.has(eq)) continue;
        underEqs.add(eq);
        const matchedV = matchEqToVar.get(eq);
        if (matchedV && !underVars.has(matchedV)) {
          underVars.add(matchedV);
          qVar.push(matchedV);
        }
      }
    }

    // 3. Alternating BFS from unmatched equations: E --(unmatched)--> V --(matched)--> E
    const overVars = new Set<string>();
    const overEqs = new Set<string>();
    const qEq: string[] = [];

    for (const eq of equations) {
      if (!matchEqToVar.has(eq)) {
        overEqs.add(eq);
        qEq.push(eq);
      }
    }

    while (qEq.length > 0) {
      const eq = qEq.shift()!;
      for (const v of eqAdj.get(eq) ?? []) {
        if (matchEqToVar.get(eq) === v || overVars.has(v)) continue;
        overVars.add(v);
        const matchedEq = matchVarToEq.get(v);
        if (matchedEq && !overEqs.has(matchedEq)) {
          overEqs.add(matchedEq);
          qEq.push(matchedEq);
        }
      }
    }

    const wellVars = variables.filter((v) => !underVars.has(v) && !overVars.has(v));
    const wellEqs = equations.filter((e) => !underEqs.has(e) && !overEqs.has(e));

    return {
      underConstrainedVariables: [...underVars].sort(),
      underConstrainedEquations: [...underEqs].sort(),
      overConstrainedVariables: [...overVars].sort(),
      overConstrainedEquations: [...overEqs].sort(),
      wellConstrainedVariables: wellVars.sort(),
      wellConstrainedEquations: wellEqs.sort(),
      maximumMatchingSize: matchVarToEq.size
    };
  }
}
