/**
 * Edmonds Blossom / General Undirected Graph Maximum Cardinality Matching Engine.
 * Finds the maximum number of disjoint vertex pairs in arbitrary undirected graphs
 * (including non-bipartite graphs with odd-length cycles such as triangles and pentagons).
 */
export class GeneralGraphMaximumMatchingEngine {
  public static computeMaximumMatching(
    nodes: string[],
    undirectedEdges: Array<{ u: string; v: string }>
  ): {
    matchedPairs: Array<{ u: string; v: string }>;
    matchedEdgeCount: number;
    unmatchedNodes: string[];
  } {
    const n = nodes.length;
    const idxMap = new Map<string, number>();
    nodes.forEach((id, i) => idxMap.set(id, i));

    const adj: number[][] = Array.from({ length: n }, () => []);
    for (const e of undirectedEdges) {
      const u = idxMap.get(e.u);
      const v = idxMap.get(e.v);
      if (u !== undefined && v !== undefined && u !== v) {
        if (!adj[u]!.includes(v)) adj[u]!.push(v);
        if (!adj[v]!.includes(u)) adj[v]!.push(u);
      }
    }

    // Edmonds Blossom algorithm with LCA base contraction
    const match = new Int32Array(n).fill(-1);
    const p = new Int32Array(n).fill(-1);
    const base = new Int32Array(n);
    const used = new Uint8Array(n);
    const blossom = new Uint8Array(n);

    const lca = (aInput: number, bInput: number): number => {
      const usedPath = new Uint8Array(n);
      let a = aInput;
      let b = bInput;
      while (true) {
        a = base[a]!;
        usedPath[a] = 1;
        if (match[a] === -1) break;
        a = p[match[a]!]!;
      }
      while (true) {
        b = base[b]!;
        if (usedPath[b]) return b;
        b = p[match[b]!]!;
      }
    };

    const markPath = (vInput: number, b: number, childrenInput: number) => {
      let v = vInput;
      let children = childrenInput;
      while (base[v] !== b) {
        blossom[base[v]!] = 1;
        blossom[base[match[v]!]!] = 1;
        p[v] = children;
        children = match[v]!;
        v = p[match[v]!]!;
      }
    };

    const findPath = (root: number): number => {
      used.fill(0);
      p.fill(-1);
      for (let i = 0; i < n; i++) base[i] = i;

      used[root] = 1;
      const queue: number[] = [root];

      while (queue.length > 0) {
        const v = queue.shift()!;
        for (const to of adj[v]!) {
          if (base[v] === base[to] || match[v] === to) continue;
          if (
            to === root ||
            (match[to] !== -1 && p[match[to]!] !== -1)
          ) {
            const curbase = lca(v, to);
            blossom.fill(0);
            markPath(v, curbase, to);
            markPath(to, curbase, v);
            for (let i = 0; i < n; i++) {
              if (blossom[base[i]!]) {
                base[i] = curbase;
                if (!used[i]) {
                  used[i] = 1;
                  queue.push(i);
                }
              }
            }
          } else if (p[to] === -1) {
            p[to] = v;
            if (match[to] === -1) return to;
            const mTo = match[to]!;
            used[mTo] = 1;
            queue.push(mTo);
          }
        }
      }
      return -1;
    };

    for (let i = 0; i < n; i++) {
      if (match[i] === -1) {
        const v = findPath(i);
        if (v !== -1) {
          let cur = v;
          while (cur !== -1) {
            const pv = p[cur]!;
            const ppv = pv !== -1 ? match[pv]! : -1;
            match[cur] = pv;
            match[pv] = cur;
            cur = ppv;
          }
        }
      }
    }

    const matchedPairs: Array<{ u: string; v: string }> = [];
    const unmatchedNodes: string[] = [];

    for (let i = 0; i < n; i++) {
      const m = match[i]!;
      if (m === -1) {
        unmatchedNodes.push(nodes[i]!);
      } else if (i < m) {
        matchedPairs.push({ u: nodes[i]!, v: nodes[m]! });
      }
    }

    return {
      matchedPairs,
      matchedEdgeCount: matchedPairs.length,
      unmatchedNodes
    };
  }
}
