export interface DgimBucket {
  sizePowerOfTwo: number; // 1, 2, 4, 8, ...
  latestTimestamp: number;
}

/**
 * Datar-Gionis-Indyk-Motwani (DGIM) Logarithmic-Space Sliding-Window Bit Stream Counter.
 * Approximates the number of 1-bits in the last N steps using O(log^2 N) bits of memory
 * by maintaining at most 2 buckets of each power-of-two size and merging the oldest pair on overflow.
 */
export class DgimSlidingWindowBitCounter {
  public readonly windowSizeN: number;
  private currentTimestamp = 0;
  // Ordered from oldest to newest
  private readonly buckets: DgimBucket[] = [];

  constructor(windowSizeN = 100) {
    this.windowSizeN = Math.max(4, windowSizeN);
  }

  public recordBit(bit: 0 | 1): void {
    this.currentTimestamp++;
    const cutoff = this.currentTimestamp - this.windowSizeN;

    // 1. Expire buckets whose latestTimestamp <= cutoff
    while (this.buckets.length > 0 && this.buckets[0]!.latestTimestamp <= cutoff) {
      this.buckets.shift();
    }

    if (bit === 0) return;

    // 2. Append new bucket of size 1
    this.buckets.push({
      sizePowerOfTwo: 1,
      latestTimestamp: this.currentTimestamp
    });

    // 3. Cascade-merge whenever 3 buckets of the same size exist
    let idx = this.buckets.length - 1;
    while (idx >= 2) {
      const bNewest = this.buckets[idx]!;
      const bMid = this.buckets[idx - 1]!;
      const bOldest = this.buckets[idx - 2]!;

      if (
        bNewest.sizePowerOfTwo === bMid.sizePowerOfTwo &&
        bMid.sizePowerOfTwo === bOldest.sizePowerOfTwo
      ) {
        // Merge the two older buckets (idx - 2 and idx - 1) into a single bucket of 2x size
        const merged: DgimBucket = {
          sizePowerOfTwo: bMid.sizePowerOfTwo * 2,
          latestTimestamp: bMid.latestTimestamp
        };
        this.buckets.splice(idx - 2, 2, merged);
        idx--;
      } else {
        break;
      }
    }
  }

  public estimateOnesInWindow(): {
    estimatedOnes: number;
    activeBucketCount: number;
  } {
    if (this.buckets.length === 0) {
      return { estimatedOnes: 0, activeBucketCount: 0 };
    }

    let sum = 0;
    // Sum all buckets except the oldest, plus half of the oldest bucket's size
    for (let i = 1; i < this.buckets.length; i++) {
      sum += this.buckets[i]!.sizePowerOfTwo;
    }
    sum += Math.ceil(this.buckets[0]!.sizePowerOfTwo / 2);

    return {
      estimatedOnes: sum,
      activeBucketCount: this.buckets.length
    };
  }
}
