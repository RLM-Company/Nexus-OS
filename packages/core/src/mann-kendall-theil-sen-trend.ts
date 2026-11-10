export interface NonParametricTrendReport {
  mannKendallStatS: number;
  normalizedZScore: number;
  trendDirection: "INCREASING" | "DECREASING" | "NO_SIGNIFICANT_TREND";
  theilSenMedianSlope: number;
  theilSenIntercept: number;
}

/**
 * Non-Parametric Mann-Kendall Monotonic Trend Test & Theil-Sen Robust Median Slope Estimator.
 * Resistant to up to 29.3% corrupted outlier points without distorting slope or trend direction.
 */
export class TheilSenAndMannKendallTrendAnalyzer {
  public static analyzeSeries(
    points: Array<{ t: number; y: number }>,
    zThreshold = 1.96
  ): NonParametricTrendReport {
    const n = points.length;
    if (n < 2) {
      return {
        mannKendallStatS: 0,
        normalizedZScore: 0,
        trendDirection: "NO_SIGNIFICANT_TREND",
        theilSenMedianSlope: 0,
        theilSenIntercept: points[0]?.y ?? 0
      };
    }

    const sorted = [...points].sort((a, b) => a.t - b.t);
    let sStat = 0;
    const slopes: number[] = [];

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dy = sorted[j]!.y - sorted[i]!.y;
        const dt = sorted[j]!.t - sorted[i]!.t;
        if (dy > 0) sStat += 1;
        else if (dy < 0) sStat -= 1;

        if (Math.abs(dt) > 1e-12) {
          slopes.push(dy / dt);
        }
      }
    }

    const varS = (n * (n - 1) * (2 * n + 5)) / 18.0;
    let z = 0;
    if (sStat > 0) {
      z = (sStat - 1) / Math.sqrt(Math.max(1e-9, varS));
    } else if (sStat < 0) {
      z = (sStat + 1) / Math.sqrt(Math.max(1e-9, varS));
    }

    slopes.sort((a, b) => a - b);
    const mid = Math.floor(slopes.length / 2);
    const medianSlope =
      slopes.length === 0
        ? 0
        : slopes.length % 2 === 1
          ? slopes[mid]!
          : 0.5 * (slopes[mid - 1]! + slopes[mid]!);

    const intercepts = sorted
      .map((p) => p.y - medianSlope * p.t)
      .sort((a, b) => a - b);
    const midInt = Math.floor(intercepts.length / 2);
    const medianIntercept =
      intercepts.length % 2 === 1
        ? intercepts[midInt]!
        : 0.5 * (intercepts[midInt - 1]! + intercepts[midInt]!);

    let trendDirection: NonParametricTrendReport["trendDirection"] =
      "NO_SIGNIFICANT_TREND";
    if (z >= zThreshold) trendDirection = "INCREASING";
    else if (z <= -zThreshold) trendDirection = "DECREASING";

    return {
      mannKendallStatS: sStat,
      normalizedZScore: Number(z.toFixed(6)),
      trendDirection,
      theilSenMedianSlope: Number(medianSlope.toFixed(6)),
      theilSenIntercept: Number(medianIntercept.toFixed(6))
    };
  }
}
