/**
 * Sleator & Tarjan Heavy-Light Decomposition (HLD) Tree Path Aggregator.
 * Decomposes a rooted tree into vertex-disjoint heavy chains (so any root-to-leaf path
 * crosses at most log2(N) light edges) and backs the flattened chain positions with a
 * Segment Tree to support point updates and path-sum / path-max queries between any
 * two vertices (u, v) in O(log^2 N) time.
 */
export class HeavyLightDecompositionTreeEngine {
  private readonly parent = new Map<string, string | null>();
  private readonly depth = new Map<string, number>();
  private readonly heavyChild = new Map<string, string | null>();
  private readonly chainHead = new Map<string, string>();
  private readonly flatPos = new Map<string, number>();
  private readonly segSum: number[];
  private readonly segMax: number[];
  private readonly n: number;

  public constructor(
    root: string,
    childrenByNode: Record<string, string[]>,
    initialValuesByNode: Record<string, number>
  ) {
    const subSize = new Map<string, number>();

    const dfsSize = (u: string, p: string | null, d: number): number => {
      this.parent.set(u, p);
      this.depth.set(u, d);
      let size = 1;
      let maxChildSize = 0;
      let bestChild: string | null = null;

      for (const v of childrenByNode[u] ?? []) {
        if (v === p) continue;
        const cSize = dfsSize(v, u, d + 1);
        size += cSize;
        if (cSize > maxChildSize) {
          maxChildSize = cSize;
          bestChild = v;
        }
      }
      subSize.set(u, size);
      this.heavyChild.set(u, bestChild);
      return size;
    };

    dfsSize(root, null, 0);

    let currPos = 0;
    const dfsHld = (u: string, head: string): void => {
      this.chainHead.set(u, head);
      this.flatPos.set(u, currPos++);
      const hc = this.heavyChild.get(u) ?? null;
      if (hc !== null) {
        dfsHld(hc, head);
      }
      for (const v of childrenByNode[u] ?? []) {
        if (v !== this.parent.get(u) && v !== hc) {
          dfsHld(v, v);
        }
      }
    };

    dfsHld(root, root);

    this.n = currPos;
    this.segSum = new Array<number>(4 * Math.max(1, this.n)).fill(0);
    this.segMax = new Array<number>(4 * Math.max(1, this.n)).fill(-Infinity);

    for (const [nodeId, pos] of this.flatPos.entries()) {
      const val = initialValuesByNode[nodeId] ?? 0;
      this.updateSeg(1, 0, this.n - 1, pos, val);
    }
  }

  private updateSeg(node: number, l: number, r: number, idx: number, val: number): void {
    if (l === r) {
      this.segSum[node] = val;
      this.segMax[node] = val;
      return;
    }
    const mid = (l + r) >> 1;
    if (idx <= mid) this.updateSeg(node * 2, l, mid, idx, val);
    else this.updateSeg(node * 2 + 1, mid + 1, r, idx, val);
    this.segSum[node] = this.segSum[node * 2]! + this.segSum[node * 2 + 1]!;
    this.segMax[node] = Math.max(this.segMax[node * 2]!, this.segMax[node * 2 + 1]!);
  }

  private querySeg(
    node: number,
    l: number,
    r: number,
    ql: number,
    qr: number
  ): { sum: number; max: number } {
    if (ql <= l && r <= qr) {
      return { sum: this.segSum[node]!, max: this.segMax[node]! };
    }
    const mid = (l + r) >> 1;
    let sum = 0;
    let max = -Infinity;
    if (ql <= mid) {
      const left = this.querySeg(node * 2, l, mid, ql, qr);
      sum += left.sum;
      max = Math.max(max, left.max);
    }
    if (qr > mid) {
      const right = this.querySeg(node * 2 + 1, mid + 1, r, ql, qr);
      sum += right.sum;
      max = Math.max(max, right.max);
    }
    return { sum, max };
  }

  public updateNodeValue(nodeId: string, newValue: number): void {
    const pos = this.flatPos.get(nodeId);
    if (pos === undefined) throw new Error(`Unknown HLD vertex: ${nodeId}`);
    this.updateSeg(1, 0, this.n - 1, pos, newValue);
  }

  public queryPathAggregate(uInput: string, vInput: string): {
    pathSum: number;
    pathMax: number;
    chainJumps: number;
  } {
    let u = uInput;
    let v = vInput;
    let totalSum = 0;
    let totalMax = -Infinity;
    let jumps = 0;

    while (this.chainHead.get(u) !== this.chainHead.get(v)) {
      jumps++;
      const headU = this.chainHead.get(u)!;
      const headV = this.chainHead.get(v)!;
      if ((this.depth.get(headU) ?? 0) < (this.depth.get(headV) ?? 0)) {
        [u, v] = [v, u];
      }
      const topHead = this.chainHead.get(u)!;
      const seg = this.querySeg(
        1,
        0,
        this.n - 1,
        this.flatPos.get(topHead)!,
        this.flatPos.get(u)!
      );
      totalSum += seg.sum;
      totalMax = Math.max(totalMax, seg.max);
      u = this.parent.get(topHead)!;
    }

    const posU = this.flatPos.get(u)!;
    const posV = this.flatPos.get(v)!;
    const finalSeg = this.querySeg(
      1,
      0,
      this.n - 1,
      Math.min(posU, posV),
      Math.max(posU, posV)
    );
    totalSum += finalSeg.sum;
    totalMax = Math.max(totalMax, finalSeg.max);

    return {
      pathSum: totalSum,
      pathMax: totalMax,
      chainJumps: jumps
    };
  }
}
