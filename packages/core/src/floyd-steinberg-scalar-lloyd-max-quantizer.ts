export interface LloydMaxQuantizationResult {
  centroids: number[];
  decisionBoundaries: number[];
  quantizedSignal: number[];
  meanSquaredError: number;
}

/**
 * Lloyd-Max Optimal Non-Uniform Scalar Quantizer & 1D Error-Diffusion Ditherer.
 * Alternates between midpoint decision boundary updates t_k = (c_k + c_{k+1}) / 2 and
 * conditional centroid updates c_k = E[X | t_{k-1} <= X < t_k] to minimize MSE, plus
 * 1D first-order sigma-delta error diffusion preserving the exact signal mean.
 */
export class LloydMaxAndErrorDiffusionQuantizer {
  public static fitLloydMaxQuantizer(
    samples: number[],
    levelsK: number = 4,
    iterations: number = 25
  ): LloydMaxQuantizationResult {
    if (samples.length === 0) {
      return { centroids: [], decisionBoundaries: [], quantizedSignal: [], meanSquaredError: 0 };
    }
    const sorted = [...samples].sort((a, b) => a - b);
    const k = Math.max(1, Math.min(levelsK, sorted.length));

    // Initialize centroids via empirical quantiles
    let centroids = Array.from(
      { length: k },
      (_, i) => sorted[Math.floor(((i + 0.5) / k) * sorted.length)]!
    );
    let boundaries = new Array<number>(Math.max(0, k - 1)).fill(0);

    for (let it = 0; it < iterations; it++) {
      for (let j = 0; j < k - 1; j++) {
        boundaries[j] = 0.5 * (centroids[j]! + centroids[j + 1]!);
      }

      const sums = new Array<number>(k).fill(0);
      const counts = new Array<number>(k).fill(0);
      for (const x of samples) {
        let bin = 0;
        while (bin < k - 1 && x >= boundaries[bin]!) {
          bin++;
        }
        sums[bin]! += x;
        counts[bin]! += 1;
      }

      for (let j = 0; j < k; j++) {
        if (counts[j]! > 0) {
          centroids[j] = sums[j]! / counts[j]!;
        }
      }
      centroids.sort((a, b) => a - b);
    }

    const quantizedSignal: number[] = [];
    let sqErr = 0;
    for (const x of samples) {
      let bin = 0;
      while (bin < k - 1 && x >= boundaries[bin]!) {
        bin++;
      }
      const q = centroids[bin]!;
      quantizedSignal.push(Number(q.toFixed(6)));
      sqErr += (x - q) * (x - q);
    }

    return {
      centroids: centroids.map((c) => Number(c.toFixed(6))),
      decisionBoundaries: boundaries.map((b) => Number(b.toFixed(6))),
      quantizedSignal,
      meanSquaredError: Number((sqErr / samples.length).toFixed(6))
    };
  }

  public static dither1DErrorDiffusion(samples: number[], stepSizeDelta: number = 1.0): number[] {
    const out: number[] = [];
    let carriedError = 0;
    for (const s of samples) {
      const target = s + carriedError;
      const quantized = Math.round(target / stepSizeDelta) * stepSizeDelta;
      carriedError = target - quantized;
      out.push(Number(quantized.toFixed(6)));
    }
    return out;
  }
}
