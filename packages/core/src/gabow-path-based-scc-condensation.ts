export interface GabowCondensationResult {
  stronglyConnectedComponents: string[][];
  componentIndexByNode: Record<string, number>;
  condensationDagEdges: Array<{ fromScc: number; toScc: number }>;
  topologicalSccOrder: number[];
}

/**
 * Harold Gabow's (2000) Path-Based Two-Stack Strongly Connected Components (SCC)
 * & Condensation DAG Builder in strict O(V + E) time.
 * Uses stack S (unfinished vertices) and stack P (potential SCC roots on current DFS path)
 * instead of Tarjan's low-link arithmetic.
 */
export class GabowPathBasedSccAndDagCondenser {
  public static computeSccAndCondensationDag(
    nodes: string[],
    directedEdges: Array<{ from: string; to: string }>
  ): GabowCondensationResult {
    const adj = new Map<string, string[]>(nodes.map((n) => [n, []]));
    for (const e of directedEdges) {
      adj.get(e.from)?.push(e.to);
    }

    const preorder = new Map<string, number>();
    const assignedScc = new Map<string, number>();
    const stackS: string[] = [];
    const stackP: string[] = [];
    const sccs: string[][] = [];
    let counter = 0;

    const dfs = (v: string): void => {
      counter++;
      preorder.set(v, counter);
      stackS.push(v);
      stackP.push(v);

      for (const w of adj.get(v) ?? []) {
        if (!preorder.has(w)) {
          dfs(w);
        } else if (!assignedScc.has(w)) {
          const wOrder = preorder.get(w)!;
          while (
            stackP.length > 0 &&
            preorder.get(stackP[stackP.length - 1]!)! > wOrder
          ) {
            stackP.pop();
          }
        }
      }

      if (stackP[stackP.length - 1] === v) {
        stackP.pop();
        const sccIdx = sccs.length;
        const members: string[] = [];
        while (true) {
          const x = stackS.pop()!;
          assignedScc.set(x, sccIdx);
          members.push(x);
          if (x === v) break;
        }
        members.sort();
        sccs.push(members);
      }
    };

    for (const n of nodes) {
      if (!preorder.has(n)) {
        dfs(n);
      }
    }

    // Gabow emits SCCs in reverse topological order; reverse them so topological order is 0..k-1
    sccs.reverse();
    const componentIndexByNode: Record<string, number> = {};
    sccs.forEach((members, idx) => {
      for (const m of members) componentIndexByNode[m] = idx;
    });

    const dagEdgeSet = new Set<string>();
    const condensationDagEdges: Array<{ fromScc: number; toScc: number }> = [];
    for (const e of directedEdges) {
      const uScc = componentIndexByNode[e.from];
      const vScc = componentIndexByNode[e.to];
      if (uScc !== undefined && vScc !== undefined && uScc !== vScc) {
        const key = `${uScc}->${vScc}`;
        if (!dagEdgeSet.has(key)) {
          dagEdgeSet.add(key);
          condensationDagEdges.push({ fromScc: uScc, toScc: vScc });
        }
      }
    }

    return {
      stronglyConnectedComponents: sccs,
      componentIndexByNode,
      condensationDagEdges,
      topologicalSccOrder: Array.from({ length: sccs.length }, (_, i) => i)
    };
  }
}
