export interface WaveletDecompositionResult {
  paddedLength: number;
  coarseApproximation: number[];
  detailCoefficientsByLevel: number[][];
  denoisedSignal: number[];
  universalThresholdLambda: number;
  burstIndices: number[];
}

/**
 * Discrete Haar Wavelet Transform (DWT) Multi-Resolution Signal Analyzer &
 * Donoho VisuShrink Soft-Thresholding Denoiser.
 * Decomposes noisy telemetry/token-rate streams into multi-scale approximation and detail coefficients,
 * filters high-frequency noise via soft thresholding, and reconstructs clean signals via Inverse Haar DWT.
 */
export class HaarWaveletMultiResolutionAnalyzer {
  public static nextPowerOfTwo(n: number): number {
    let p = 1;
    while (p < n) p <<= 1;
    return Math.max(2, p);
  }

  public static softThreshold(val: number, lambda: number): number {
    if (Math.abs(val) <= lambda) return 0;
    return val > 0 ? val - lambda : val + lambda;
  }

  public static analyzeAndDenoise(
    signal: number[],
    options?: { customThresholdLambda?: number; burstZScoreThreshold?: number }
  ): WaveletDecompositionResult {
    if (signal.length === 0) {
      return {
        paddedLength: 0,
        coarseApproximation: [],
        detailCoefficientsByLevel: [],
        denoisedSignal: [],
        universalThresholdLambda: 0,
        burstIndices: []
      };
    }

    const origLen = signal.length;
    const paddedLength = HaarWaveletMultiResolutionAnalyzer.nextPowerOfTwo(origLen);
    const work = new Array<number>(paddedLength);
    for (let i = 0; i < paddedLength; i++) {
      work[i] = i < origLen ? signal[i]! : signal[origLen - 1]!;
    }

    const detailCoefficientsByLevel: number[][] = [];
    let currentApprox = [...work];
    const invSqrt2 = 1 / Math.sqrt(2);

    while (currentApprox.length >= 2) {
      const half = currentApprox.length >> 1;
      const nextApprox = new Array<number>(half);
      const details = new Array<number>(half);

      for (let i = 0; i < half; i++) {
        const a = currentApprox[2 * i]!;
        const b = currentApprox[2 * i + 1]!;
        nextApprox[i] = (a + b) * invSqrt2;
        details[i] = (a - b) * invSqrt2;
      }

      detailCoefficientsByLevel.push(details);
      currentApprox = nextApprox;
    }

    // Estimate noise sigma from finest detail level (level 0) via Median Absolute Deviation (MAD / 0.6745)
    const finestDetails = detailCoefficientsByLevel[0] ?? [0];
    const absFinest = finestDetails.map((d) => Math.abs(d)).sort((a, b) => a - b);
    const medianAbs = absFinest[Math.floor(absFinest.length / 2)] ?? 0;
    const estimatedSigma = medianAbs / 0.6745;

    const lambda =
      options?.customThresholdLambda ??
      estimatedSigma * Math.sqrt(2 * Math.log(Math.max(2, paddedLength)));

    // Detect sharp multi-scale bursts from finest detail coefficients before thresholding
    const burstZ = options?.burstZScoreThreshold ?? 2.5;
    const burstIndices: number[] = [];
    for (let i = 0; i < finestDetails.length; i++) {
      if (Math.abs(finestDetails[i]!) > Math.max(1e-6, estimatedSigma * burstZ)) {
        const idx = Math.min(origLen - 1, 2 * i + 1);
        burstIndices.push(idx);
      }
    }

    // Apply soft thresholding to all detail levels and reconstruct via Inverse Haar DWT
    const thresholdedDetails = detailCoefficientsByLevel.map((level) =>
      level.map((c) => HaarWaveletMultiResolutionAnalyzer.softThreshold(c, lambda))
    );

    let reconstructed = [...currentApprox];
    for (let lvl = thresholdedDetails.length - 1; lvl >= 0; lvl--) {
      const details = thresholdedDetails[lvl]!;
      const nextRec = new Array<number>(reconstructed.length * 2);
      for (let i = 0; i < reconstructed.length; i++) {
        const avg = reconstructed[i]!;
        const det = details[i]!;
        nextRec[2 * i] = (avg + det) * invSqrt2;
        nextRec[2 * i + 1] = (avg - det) * invSqrt2;
      }
      reconstructed = nextRec;
    }

    return {
      paddedLength,
      coarseApproximation: currentApprox.map((v) => Number(v.toFixed(6))),
      detailCoefficientsByLevel: detailCoefficientsByLevel.map((lvl) =>
        lvl.map((v) => Number(v.toFixed(6)))
      ),
      denoisedSignal: reconstructed.slice(0, origLen).map((v) => Number(v.toFixed(6))),
      universalThresholdLambda: Number(lambda.toFixed(6)),
      burstIndices
    };
  }
}
