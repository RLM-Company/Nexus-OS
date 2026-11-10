/**
 * Fenwick Binary Indexed Tree (BIT) & Lazy-Propagation Segment Tree Range Aggregator.
 * Supports O(log N) range-add updates and O(log N) range sum and range maximum queries.
 */
export class LazySegmentAndFenwickTreeEngine {
  public readonly size: number;
  private readonly treeSum: Float64Array;
  private readonly treeMax: Float64Array;
  private readonly lazyAdd: Float64Array;

  constructor(initialValues: number[]) {
    this.size = Math.max(1, initialValues.length);
    this.treeSum = new Float64Array(4 * this.size);
    this.treeMax = new Float64Array(4 * this.size);
    this.lazyAdd = new Float64Array(4 * this.size);
    if (initialValues.length > 0) {
      this.build(1, 0, this.size - 1, initialValues);
    }
  }

  private build(node: number, l: number, r: number, arr: number[]): void {
    if (l === r) {
      const val = arr[l] ?? 0;
      this.treeSum[node] = val;
      this.treeMax[node] = val;
      return;
    }
    const mid = (l + r) >> 1;
    this.build(node * 2, l, mid, arr);
    this.build(node * 2 + 1, mid + 1, r, arr);
    this.treeSum[node] = this.treeSum[node * 2]! + this.treeSum[node * 2 + 1]!;
    this.treeMax[node] = Math.max(this.treeMax[node * 2]!, this.treeMax[node * 2 + 1]!);
  }

  private pushDown(node: number, l: number, r: number): void {
    const lz = this.lazyAdd[node]!;
    if (lz === 0 || l === r) return;
    const mid = (l + r) >> 1;
    const left = node * 2;
    const right = node * 2 + 1;

    this.lazyAdd[left] += lz;
    this.treeSum[left] += lz * (mid - l + 1);
    this.treeMax[left] += lz;

    this.lazyAdd[right] += lz;
    this.treeSum[right] += lz * (r - mid);
    this.treeMax[right] += lz;

    this.lazyAdd[node] = 0;
  }

  public rangeAdd(ql: number, qr: number, delta: number): void {
    this.updateRange(1, 0, this.size - 1, ql, qr, delta);
  }

  private updateRange(
    node: number,
    l: number,
    r: number,
    ql: number,
    qr: number,
    delta: number
  ): void {
    if (ql > r || qr < l) return;
    if (ql <= l && r <= qr) {
      this.lazyAdd[node] += delta;
      this.treeSum[node] += delta * (r - l + 1);
      this.treeMax[node] += delta;
      return;
    }
    this.pushDown(node, l, r);
    const mid = (l + r) >> 1;
    this.updateRange(node * 2, l, mid, ql, qr, delta);
    this.updateRange(node * 2 + 1, mid + 1, r, ql, qr, delta);
    this.treeSum[node] = this.treeSum[node * 2]! + this.treeSum[node * 2 + 1]!;
    this.treeMax[node] = Math.max(this.treeMax[node * 2]!, this.treeMax[node * 2 + 1]!);
  }

  public queryRange(ql: number, qr: number): { sum: number; max: number } {
    return this.queryInternal(1, 0, this.size - 1, ql, qr);
  }

  private queryInternal(
    node: number,
    l: number,
    r: number,
    ql: number,
    qr: number
  ): { sum: number; max: number } {
    if (ql > r || qr < l) {
      return { sum: 0, max: -Infinity };
    }
    if (ql <= l && r <= qr) {
      return {
        sum: Number(this.treeSum[node]!.toFixed(6)),
        max: Number(this.treeMax[node]!.toFixed(6))
      };
    }
    this.pushDown(node, l, r);
    const mid = (l + r) >> 1;
    const leftRes = this.queryInternal(node * 2, l, mid, ql, qr);
    const rightRes = this.queryInternal(node * 2 + 1, mid + 1, r, ql, qr);
    return {
      sum: Number((leftRes.sum + rightRes.sum).toFixed(6)),
      max: Number(Math.max(leftRes.max, rightRes.max).toFixed(6))
    };
  }
}
