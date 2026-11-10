export interface WeightedUndirectedEdge {
  u: string;
  v: string;
  weight: number;
}

export interface MinimumSpanningTreeResult {
  mstEdges: WeightedUndirectedEdge[];
  totalWeight: number;
  connectedComponentsCount: number;
}

/**
 * Tarjan's Disjoint-Set Union-Find (Path Compression + Union by Rank) &
 * Kruskal's Minimum Spanning Forest / Minimax Bottleneck Tree Solver.
 */
export class DisjointSetAndSteinerMstEngine {
  private readonly parent = new Map<string, string>();
  private readonly rank = new Map<string, number>();
  private componentCount = 0;

  constructor(elements?: string[]) {
    for (const el of elements ?? []) {
      this.makeSet(el);
    }
  }

  public makeSet(x: string): void {
    if (!this.parent.has(x)) {
      this.parent.set(x, x);
      this.rank.set(x, 0);
      this.componentCount++;
    }
  }

  public find(x: string): string {
    this.makeSet(x);
    let root = this.parent.get(x)!;
    if (root !== x) {
      root = this.find(root);
      this.parent.set(x, root); // Path compression
    }
    return root;
  }

  public union(a: string, b: string): boolean {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA === rootB) return false;

    const rankA = this.rank.get(rootA)!;
    const rankB = this.rank.get(rootB)!;

    if (rankA < rankB) {
      this.parent.set(rootA, rootB);
    } else if (rankA > rankB) {
      this.parent.set(rootB, rootA);
    } else {
      this.parent.set(rootB, rootA);
      this.rank.set(rootA, rankA + 1);
    }

    this.componentCount--;
    return true;
  }

  public get connectedComponents(): number {
    return this.componentCount;
  }

  public static computeMinimumSpanningTree(
    nodes: string[],
    edges: WeightedUndirectedEdge[]
  ): MinimumSpanningTreeResult {
    const dsu = new DisjointSetAndSteinerMstEngine(nodes);
    const sorted = [...edges].sort((a, b) => a.weight - b.weight);

    const mstEdges: WeightedUndirectedEdge[] = [];
    let totalWeight = 0;

    for (const e of sorted) {
      if (dsu.union(e.u, e.v)) {
        mstEdges.push(e);
        totalWeight += e.weight;
      }
    }

    return {
      mstEdges,
      totalWeight: Number(totalWeight.toFixed(6)),
      connectedComponentsCount: dsu.connectedComponents
    };
  }
}
