export interface SpectralPeriodogramReport {
  fftLength: number;
  powerSpectrum: number[];
  dominantBinIndex: number;
  dominantFrequencyNormalized: number; // cycles per sample in (0, 0.5]
  dominantPeriodSamples: number;
  reconstructedSignalMaxError: number;
}

/**
 * Radix-2 Cooley-Tukey Fast Fourier Transform (FFT), Inverse FFT (IFFT),
 * and Power Spectral Density (PSD) Periodicity Analyzer.
 */
export class CooleyTukeyFftAndWelchPeriodogram {
  public static nextPowerOfTwo(n: number): number {
    let p = 1;
    while (p < n) p <<= 1;
    return Math.max(2, p);
  }

  public static fftInPlace(real: Float64Array, imag: Float64Array, inverse = false): void {
    const n = real.length;

    // Bit-reversal permutation
    let j = 0;
    for (let i = 1; i < n; i++) {
      let bit = n >> 1;
      while ((j & bit) !== 0) {
        j ^= bit;
        bit >>= 1;
      }
      j ^= bit;
      if (i < j) {
        const tr = real[i]!;
        real[i] = real[j]!;
        real[j] = tr;
        const ti = imag[i]!;
        imag[i] = imag[j]!;
        imag[j] = ti;
      }
    }

    // Butterfly stages
    for (let len = 2; len <= n; len <<= 1) {
      const ang = ((2 * Math.PI) / len) * (inverse ? 1 : -1);
      const wlenR = Math.cos(ang);
      const wlenI = Math.sin(ang);
      const half = len >> 1;

      for (let i = 0; i < n; i += len) {
        let wR = 1.0;
        let wI = 0.0;
        for (let k = 0; k < half; k++) {
          const uR = real[i + k]!;
          const uI = imag[i + k]!;
          const vR = real[i + k + half]! * wR - imag[i + k + half]! * wI;
          const vI = real[i + k + half]! * wI + imag[i + k + half]! * wR;

          real[i + k] = uR + vR;
          imag[i + k] = uI + vI;
          real[i + k + half] = uR - vR;
          imag[i + k + half] = uI - vI;

          const nextWR = wR * wlenR - wI * wlenI;
          wI = wR * wlenI + wI * wlenR;
          wR = nextWR;
        }
      }
    }

    if (inverse) {
      for (let i = 0; i < n; i++) {
        real[i] = real[i]! / n;
        imag[i] = imag[i]! / n;
      }
    }
  }

  public static analyzePeriodicity(signal: number[]): SpectralPeriodogramReport {
    const n = CooleyTukeyFftAndWelchPeriodogram.nextPowerOfTwo(signal.length);
    const mean =
      signal.length === 0 ? 0 : signal.reduce((a, b) => a + b, 0) / signal.length;

    const real = new Float64Array(n);
    const imag = new Float64Array(n);
    for (let i = 0; i < signal.length; i++) {
      real[i] = signal[i]! - mean;
    }

    CooleyTukeyFftAndWelchPeriodogram.fftInPlace(real, imag, false);

    const half = n >> 1;
    const powerSpectrum: number[] = [];
    let dominantBinIndex = 1;
    let maxPower = -1;

    for (let k = 0; k <= half; k++) {
      const pwr = (real[k]! * real[k]! + imag[k]! * imag[k]!) / n;
      powerSpectrum.push(Number(pwr.toFixed(6)));
      if (k >= 1 && pwr > maxPower) {
        maxPower = pwr;
        dominantBinIndex = k;
      }
    }

    // Verify lossless IFFT reconstruction
    CooleyTukeyFftAndWelchPeriodogram.fftInPlace(real, imag, true);
    let maxErr = 0;
    for (let i = 0; i < signal.length; i++) {
      const rec = real[i]! + mean;
      maxErr = Math.max(maxErr, Math.abs(rec - signal[i]!));
    }

    const dominantFreq = dominantBinIndex / n;
    const dominantPeriod = n / Math.max(1, dominantBinIndex);

    return {
      fftLength: n,
      powerSpectrum,
      dominantBinIndex,
      dominantFrequencyNormalized: Number(dominantFreq.toFixed(6)),
      dominantPeriodSamples: Number(dominantPeriod.toFixed(4)),
      reconstructedSignalMaxError: Number(maxErr.toFixed(9))
    };
  }
}
