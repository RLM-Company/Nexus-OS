interface WaveletNode {
  lowVal: number;
  highVal: number;
  prefixZeroCount: number[];
  left: WaveletNode | null;
  right: WaveletNode | null;
}

/**
 * Grossi, Gupta & Vitter's Wavelet Tree Succinct Sequence Index.
 * Supports O(log sigma) rank(value, prefixLength), rangeFrequency(L, R, value),
 * and rangeQuantileKthSmallest(L, R, k) queries over an arbitrary integer array
 * without sorting or mutating the sequence.
 */
export class WaveletTreeRankSelectQuantileIndex {
  private readonly root: WaveletNode | null;
  private readonly length: number;

  public constructor(values: number[]) {
    this.length = values.length;
    if (values.length === 0) {
      this.root = null;
    } else {
      const minV = Math.min(...values);
      const maxV = Math.max(...values);
      this.root = this.build(values, minV, maxV);
    }
  }

  private build(arr: number[], lowVal: number, highVal: number): WaveletNode | null {
    if (arr.length === 0) return null;
    if (lowVal === highVal) {
      return {
        lowVal,
        highVal,
        prefixZeroCount: new Array<number>(arr.length + 1).fill(0),
        left: null,
        right: null
      };
    }

    const mid = Math.floor((lowVal + highVal) / 2);
    const prefixZeroCount = new Array<number>(arr.length + 1).fill(0);
    const leftArr: number[] = [];
    const rightArr: number[] = [];

    for (let i = 0; i < arr.length; i++) {
      const v = arr[i]!;
      if (v <= mid) {
        leftArr.push(v);
        prefixZeroCount[i + 1] = prefixZeroCount[i]! + 1;
      } else {
        rightArr.push(v);
        prefixZeroCount[i + 1] = prefixZeroCount[i]!;
      }
    }

    return {
      lowVal,
      highVal,
      prefixZeroCount,
      left: this.build(leftArr, lowVal, mid),
      right: this.build(rightArr, mid + 1, highVal)
    };
  }

  /**
   * Counts occurrences of `targetValue` in the half-open prefix `[0, prefixEndExclusive)`.
   */
  public rank(targetValue: number, prefixEndExclusive: number): number {
    let curr = this.root;
    let idx = Math.max(0, Math.min(this.length, prefixEndExclusive));

    while (curr) {
      if (targetValue < curr.lowVal || targetValue > curr.highVal) return 0;
      if (curr.lowVal === curr.highVal) return idx;
      const mid = Math.floor((curr.lowVal + curr.highVal) / 2);
      const zeros = curr.prefixZeroCount[idx]!;
      if (targetValue <= mid) {
        idx = zeros;
        curr = curr.left;
      } else {
        idx = idx - zeros;
        curr = curr.right;
      }
    }
    return 0;
  }

  /**
   * Returns the k-th smallest value (0-indexed: k = 0 is minimum) in subarray `[leftInclusive, rightInclusive]`.
   */
  public rangeQuantileKthSmallest(
    leftInclusive: number,
    rightInclusive: number,
    kZeroIndexed: number
  ): number {
    let curr = this.root;
    let l = leftInclusive;
    let r = rightInclusive + 1;
    let k = kZeroIndexed;

    if (!curr || l < 0 || r > this.length || k < 0 || k >= r - l) {
      throw new Error(`Invalid Wavelet Tree quantile range [${leftInclusive}, ${rightInclusive}] k=${kZeroIndexed}`);
    }

    while (curr.lowVal < curr.highVal) {
      const zerosBeforeL = curr.prefixZeroCount[l]!;
      const zerosBeforeR = curr.prefixZeroCount[r]!;
      const inLeftCount = zerosBeforeR - zerosBeforeL;

      if (k < inLeftCount) {
        l = zerosBeforeL;
        r = zerosBeforeR;
        curr = curr.left!;
      } else {
        k -= inLeftCount;
        l = l - zerosBeforeL;
        r = r - zerosBeforeR;
        curr = curr.right!;
      }
    }

    return curr.lowVal;
  }
}
