/**
 * Bender & Farach-Colton Euler Tour + Sparse Table O(1) Lowest Common Ancestor (LCA) Engine.
 * Flattens a rooted tree into a (2N - 1) Euler tour array of depths and node IDs,
 * precomputes an O(N log N) idempotent Sparse Table over the Euler depths, and answers
 * any LCA(u, v) or tree distance dist(u, v) query in strict O(1) time.
 */
export class EulerTourSparseTableLcaEngine {
  private readonly eulerNodes: string[] = [];
  private readonly eulerDepths: number[] = [];
  private readonly firstOccurrence = new Map<string, number>();
  private readonly depthByNode = new Map<string, number>();
  private readonly sparseTable: number[][] = [];
  private readonly log2Table: number[] = [];

  public constructor(root: string, childrenByNode: Record<string, string[]>) {
    this.buildEulerTour(root, childrenByNode, 0);
    this.buildSparseTable();
  }

  private buildEulerTour(
    node: string,
    childrenByNode: Record<string, string[]>,
    depth: number
  ): void {
    this.depthByNode.set(node, depth);
    this.firstOccurrence.set(node, this.eulerNodes.length);
    this.eulerNodes.push(node);
    this.eulerDepths.push(depth);

    for (const child of childrenByNode[node] ?? []) {
      this.buildEulerTour(child, childrenByNode, depth + 1);
      this.eulerNodes.push(node);
      this.eulerDepths.push(depth);
    }
  }

  private buildSparseTable(): void {
    const m = this.eulerDepths.length;
    if (m === 0) return;

    this.log2Table.push(0, 0);
    for (let i = 2; i <= m; i++) {
      this.log2Table[i] = this.log2Table[i >> 1]! + 1;
    }

    const maxK = this.log2Table[m]! + 1;
    for (let k = 0; k < maxK; k++) {
      this.sparseTable.push(new Array<number>(m).fill(0));
    }

    for (let i = 0; i < m; i++) {
      this.sparseTable[0]![i] = i;
    }

    for (let k = 1; k < maxK; k++) {
      const half = 1 << (k - 1);
      const span = 1 << k;
      for (let i = 0; i + span <= m; i++) {
        const leftIdx = this.sparseTable[k - 1]![i]!;
        const rightIdx = this.sparseTable[k - 1]![i + half]!;
        this.sparseTable[k]![i] =
          this.eulerDepths[leftIdx]! <= this.eulerDepths[rightIdx]! ? leftIdx : rightIdx;
      }
    }
  }

  public queryLcaO1(u: string, v: string): string {
    const firstU = this.firstOccurrence.get(u);
    const firstV = this.firstOccurrence.get(v);
    if (firstU === undefined || firstV === undefined) {
      throw new Error(`Unknown tree vertex in LCA query: (${u}, ${v})`);
    }
    const L = Math.min(firstU, firstV);
    const R = Math.max(firstU, firstV);
    const len = R - L + 1;
    const k = this.log2Table[len]!;
    const idx1 = this.sparseTable[k]![L]!;
    const idx2 = this.sparseTable[k]![R - (1 << k) + 1]!;
    const bestEulerIdx = this.eulerDepths[idx1]! <= this.eulerDepths[idx2]! ? idx1 : idx2;
    return this.eulerNodes[bestEulerIdx]!;
  }

  public queryTreeDistanceO1(u: string, v: string): number {
    const lca = this.queryLcaO1(u, v);
    const du = this.depthByNode.get(u)!;
    const dv = this.depthByNode.get(v)!;
    const dlca = this.depthByNode.get(lca)!;
    return du + dv - 2 * dlca;
  }
}
