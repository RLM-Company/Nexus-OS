export interface TwoSatLiteral {
  variable: string;
  negated: boolean;
}

export interface TwoSatClause {
  first: TwoSatLiteral;
  second: TwoSatLiteral;
}

export interface TwoSatResult {
  satisfiable: boolean;
  assignment: Record<string, boolean> | null;
  stronglyConnectedComponentsCount: number;
}

/**
 * Tarjan's Linear-Time O(V + E) Strongly Connected Components (SCC) & Implication-Graph 2-SAT Solver.
 * Detects cycles/SCCs in directed dependency graphs and solves 2-CNF Boolean formulas in O(V + E)
 * by checking whether any variable x and its negation ~x belong to the same SCC.
 */
export class TarjanSccAndTwoSatEngine {
  /**
   * Computes Strongly Connected Components in reverse topological order using Tarjan's DFS lowlink algorithm.
   */
  public static findStronglyConnectedComponents(
    nodes: string[],
    directedEdges: Array<{ from: string; to: string }>
  ): string[][] {
    const adj = new Map<string, string[]>();
    for (const n of nodes) adj.set(n, []);
    for (const e of directedEdges) {
      if (!adj.has(e.from)) adj.set(e.from, []);
      if (!adj.has(e.to)) adj.set(e.to, []);
      adj.get(e.from)!.push(e.to);
    }

    let timer = 0;
    const disc = new Map<string, number>();
    const low = new Map<string, number>();
    const onStack = new Set<string>();
    const stack: string[] = [];
    const sccs: string[][] = [];

    const dfs = (u: string) => {
      disc.set(u, timer);
      low.set(u, timer);
      timer++;
      stack.push(u);
      onStack.add(u);

      for (const v of adj.get(u) ?? []) {
        if (!disc.has(v)) {
          dfs(v);
          low.set(u, Math.min(low.get(u)!, low.get(v)!));
        } else if (onStack.has(v)) {
          low.set(u, Math.min(low.get(u)!, disc.get(v)!));
        }
      }

      if (low.get(u) === disc.get(u)) {
        const comp: string[] = [];
        while (true) {
          const w = stack.pop()!;
          onStack.delete(w);
          comp.push(w);
          if (w === u) break;
        }
        sccs.push(comp);
      }
    };

    for (const n of adj.keys()) {
      if (!disc.has(n)) {
        dfs(n);
      }
    }

    return sccs;
  }

  public static solveTwoSat(clauses: TwoSatClause[]): TwoSatResult {
    const vars = new Set<string>();
    for (const c of clauses) {
      vars.add(c.first.variable);
      vars.add(c.second.variable);
    }

    const litNode = (lit: TwoSatLiteral): string =>
      lit.negated ? `~${lit.variable}` : lit.variable;
    const negLit = (lit: TwoSatLiteral): TwoSatLiteral => ({
      variable: lit.variable,
      negated: !lit.negated
    });

    const nodes: string[] = [];
    for (const v of vars) {
      nodes.push(v, `~${v}`);
    }

    // (A v B) <=> (~A -> B) and (~B -> A)
    const edges: Array<{ from: string; to: string }> = [];
    for (const c of clauses) {
      edges.push({ from: litNode(negLit(c.first)), to: litNode(c.second) });
      edges.push({ from: litNode(negLit(c.second)), to: litNode(c.first) });
    }

    const sccs = TarjanSccAndTwoSatEngine.findStronglyConnectedComponents(nodes, edges);
    // Tarjan emits SCCs in reverse topological order:
    // if compIndex[u] < compIndex[v], then u appears AFTER v in topological order (v -> ... -> u).
    const compIndex = new Map<string, number>();
    for (let i = 0; i < sccs.length; i++) {
      for (const node of sccs[i]!) {
        compIndex.set(node, i);
      }
    }

    const assignment: Record<string, boolean> = {};
    for (const v of vars) {
      const posComp = compIndex.get(v)!;
      const negComp = compIndex.get(`~${v}`)!;
      if (posComp === negComp) {
        return {
          satisfiable: false,
          assignment: null,
          stronglyConnectedComponentsCount: sccs.length
        };
      }
      // In Tarjan's reverse topological order, smaller index = sink-ward component = TRUE
      assignment[v] = posComp < negComp;
    }

    return {
      satisfiable: true,
      assignment,
      stronglyConnectedComponentsCount: sccs.length
    };
  }
}
