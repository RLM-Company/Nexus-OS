export interface TukeyAndHampelReport {
  q1: number;
  median: number;
  q3: number;
  iqr: number;
  lowerInnerFence: number;
  upperInnerFence: number;
  tukeyOutlierValues: number[];
  hampelCleanedSeries: number[];
  hampelSpikesReplacedCount: number;
}

/**
 * Sliding-Window Hampel Identifier (Median + 1.4826 * MAD Spike Replacement) &
 * Tukey's Interquartile Range (IQR) Inner/Outer Fence Outlier Classifier.
 */
export class HampelIdentifierAndTukeyFenceFilter {
  private static computeQuantile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    const pos = p * (sorted.length - 1);
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    const frac = pos - lo;
    return sorted[lo]! + frac * (sorted[hi]! - sorted[lo]!);
  }

  public static filterSeries(
    series: number[],
    options?: { halfWindowK?: number; nSigmaHampel?: number }
  ): TukeyAndHampelReport {
    if (series.length === 0) {
      return {
        q1: 0,
        median: 0,
        q3: 0,
        iqr: 0,
        lowerInnerFence: 0,
        upperInnerFence: 0,
        tukeyOutlierValues: [],
        hampelCleanedSeries: [],
        hampelSpikesReplacedCount: 0
      };
    }

    const sortedAll = [...series].sort((a, b) => a - b);
    const q1 = HampelIdentifierAndTukeyFenceFilter.computeQuantile(sortedAll, 0.25);
    const median = HampelIdentifierAndTukeyFenceFilter.computeQuantile(sortedAll, 0.5);
    const q3 = HampelIdentifierAndTukeyFenceFilter.computeQuantile(sortedAll, 0.75);
    const iqr = q3 - q1;

    const lowerInnerFence = q1 - 1.5 * iqr;
    const upperInnerFence = q3 + 1.5 * iqr;

    const tukeyOutlierValues = series.filter(
      (v) => v < lowerInnerFence || v > upperInnerFence
    );

    const k = Math.max(1, options?.halfWindowK ?? 2);
    const nSigma = options?.nSigmaHampel ?? 3.0;
    const hampelCleanedSeries: number[] = [];
    let hampelSpikesReplacedCount = 0;

    for (let i = 0; i < series.length; i++) {
      const start = Math.max(0, i - k);
      const end = Math.min(series.length - 1, i + k);
      const win = series.slice(start, end + 1).sort((a, b) => a - b);
      const localMed = HampelIdentifierAndTukeyFenceFilter.computeQuantile(win, 0.5);
      const absDevs = win.map((x) => Math.abs(x - localMed)).sort((a, b) => a - b);
      const mad = HampelIdentifierAndTukeyFenceFilter.computeQuantile(absDevs, 0.5);
      const sigmaEst = 1.4826 * mad;

      if (Math.abs(series[i]! - localMed) > nSigma * Math.max(1e-6, sigmaEst)) {
        hampelCleanedSeries.push(Number(localMed.toFixed(6)));
        hampelSpikesReplacedCount++;
      } else {
        hampelCleanedSeries.push(Number(series[i]!.toFixed(6)));
      }
    }

    return {
      q1: Number(q1.toFixed(6)),
      median: Number(median.toFixed(6)),
      q3: Number(q3.toFixed(6)),
      iqr: Number(iqr.toFixed(6)),
      lowerInnerFence: Number(lowerInnerFence.toFixed(6)),
      upperInnerFence: Number(upperInnerFence.toFixed(6)),
      tukeyOutlierValues,
      hampelCleanedSeries,
      hampelSpikesReplacedCount
    };
  }
}
