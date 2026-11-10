/**
 * Sorensen-Dice q-Gram Profile Similarity & Ukkonen's Cut-Off Banded Dynamic Programming
 * O(k * N) Bounded Edit Distance Verifier.
 */
export class UkkonenApproximateStringAndNGramProfiler {
  public static sorensenDiceBigramSimilarity(a: string, b: string): number {
    const s1 = a.toLowerCase();
    const s2 = b.toLowerCase();
    if (s1 === s2) return 1.0;
    if (s1.length < 2 || s2.length < 2) return 0.0;

    const counts1 = new Map<string, number>();
    for (let i = 0; i < s1.length - 1; i++) {
      const bg = s1.slice(i, i + 2);
      counts1.set(bg, (counts1.get(bg) ?? 0) + 1);
    }

    let intersection = 0;
    for (let i = 0; i < s2.length - 1; i++) {
      const bg = s2.slice(i, i + 2);
      const c = counts1.get(bg) ?? 0;
      if (c > 0) {
        intersection++;
        counts1.set(bg, c - 1);
      }
    }

    const totalBigrams = s1.length - 1 + (s2.length - 1);
    return Number(((2.0 * intersection) / totalBigrams).toFixed(6));
  }

  /**
   * Ukkonen's Banded Edit Distance with Threshold k:
   * Only evaluates diagonal band |i - j| <= k and terminates early if row minimum exceeds k.
   */
  public static boundedEditDistance(
    a: string,
    b: string,
    maxThresholdK: number
  ): { withinThreshold: boolean; distance: number | null } {
    const n = a.length;
    const m = b.length;
    if (Math.abs(n - m) > maxThresholdK) {
      return { withinThreshold: false, distance: null };
    }

    let prevRow = new Int32Array(m + 1).fill(maxThresholdK + 1);
    for (let j = 0; j <= Math.min(m, maxThresholdK); j++) {
      prevRow[j] = j;
    }

    for (let i = 1; i <= n; i++) {
      const currRow = new Int32Array(m + 1).fill(maxThresholdK + 1);
      const jMin = Math.max(1, i - maxThresholdK);
      const jMax = Math.min(m, i + maxThresholdK);

      if (i <= maxThresholdK) {
        currRow[0] = i;
      }

      let rowMin = currRow[0]!;

      for (let j = jMin; j <= jMax; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        const val = Math.min(
          prevRow[j]! + 1,
          currRow[j - 1]! + 1,
          prevRow[j - 1]! + cost
        );
        currRow[j] = val;
        if (val < rowMin) rowMin = val;
      }

      if (rowMin > maxThresholdK) {
        return { withinThreshold: false, distance: null };
      }
      prevRow = currRow;
    }

    const finalDist = prevRow[m]!;
    return {
      withinThreshold: finalDist <= maxThresholdK,
      distance: finalDist <= maxThresholdK ? finalDist : null
    };
  }
}
