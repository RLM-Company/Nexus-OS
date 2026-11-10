/**
 * Charikar Count-Sketch Unbiased Frequency Estimator & Alon-Matias-Szegedy (AMS) F2 Moment Sketch.
 * Uses d rows of w buckets with pairwise independent bucket hashes h_r(x) and Rademacher sign hashes s_r(x) in {-1, +1}.
 * - Unbiased point query: median_r( s_r(x) * C[r][h_r(x)] )
 * - AMS F2 Second Frequency Moment (Self-Join Size sum_x f_x^2): median_r( sum_{b=0}^{w-1} C[r][b]^2 )
 */
export class CountSketchAndAmsMomentEstimator {
  private readonly rowsD: number;
  private readonly widthW: number;
  private readonly table: Float64Array[];

  public constructor(rowsD: number = 7, widthW: number = 64) {
    this.rowsD = Math.max(3, rowsD | 1); // keep odd for exact median
    this.widthW = Math.max(8, widthW);
    this.table = Array.from({ length: this.rowsD }, () => new Float64Array(this.widthW));
  }

  private static fmix32(h: number): number {
    h ^= h >>> 16;
    h = Math.imul(h, 0x85ebca6b) >>> 0;
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35) >>> 0;
    h ^= h >>> 16;
    return h >>> 0;
  }

  private hashBucketAndSign(key: string, row: number): { bucket: number; sign: 1 | -1 } {
    let h1 = (0x9747b28c ^ Math.imul(row + 1, 0x9e3779b9)) >>> 0;
    let h2 = (0xc6a4a793 ^ Math.imul(row + 17, 0x85ebca6b)) >>> 0;
    for (let i = 0; i < key.length; i++) {
      const code = key.charCodeAt(i);
      h1 = Math.imul(h1 ^ code, 0x5bd1e995) >>> 0;
      h1 = ((h1 << 15) | (h1 >>> 17)) >>> 0;
      h2 = Math.imul(h2 ^ (code + (i + 1) * 37), 0x27d4eb2d) >>> 0;
      h2 = ((h2 << 13) | (h2 >>> 19)) >>> 0;
    }
    h1 = CountSketchAndAmsMomentEstimator.fmix32(h1 ^ key.length);
    h2 = CountSketchAndAmsMomentEstimator.fmix32(h2 ^ (key.length * 7));
    return {
      bucket: h1 % this.widthW,
      sign: (h2 & 1) === 0 ? 1 : -1
    };
  }

  public update(key: string, delta: number = 1): void {
    for (let r = 0; r < this.rowsD; r++) {
      const { bucket, sign } = this.hashBucketAndSign(key, r);
      this.table[r]![bucket] += sign * delta;
    }
  }

  public estimateFrequency(key: string): number {
    const estimates: number[] = [];
    for (let r = 0; r < this.rowsD; r++) {
      const { bucket, sign } = this.hashBucketAndSign(key, r);
      estimates.push(sign * this.table[r]![bucket]!);
    }
    estimates.sort((a, b) => a - b);
    return estimates[Math.floor(estimates.length / 2)]!;
  }

  public estimateSecondMomentF2(): number {
    const rowMoments: number[] = [];
    for (let r = 0; r < this.rowsD; r++) {
      let sumSq = 0;
      const rowArr = this.table[r]!;
      for (let b = 0; b < this.widthW; b++) {
        const v = rowArr[b]!;
        sumSq += v * v;
      }
      rowMoments.push(sumSq);
    }
    rowMoments.sort((a, b) => a - b);
    return rowMoments[Math.floor(rowMoments.length / 2)]!;
  }
}
