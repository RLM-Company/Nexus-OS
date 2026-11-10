export interface ArithmeticEncodedPayload {
  symbolFrequencies: Record<string, number>;
  messageLength: number;
  encodedPoint: number; // High-precision float or integer state
  shannonLimitBits: number;
}

/**
 * Fractional Interval Arithmetic / Range Entropy Coder & Shannon Limit Analyzer.
 * Subdivides the unit interval [0, 1) (or block chunks of 10 symbols for IEEE-754 exactness)
 * proportionally to symbol probabilities to achieve sub-bit compression on skewed distributions.
 */
export class IntegerRangeEntropyCodec {
  private static readonly CHUNK_SIZE = 8;

  public static encode(input: string): {
    symbolFrequencies: Record<string, number>;
    totalLength: number;
    chunkTags: number[];
    shannonLimitBits: number;
  } {
    if (input.length === 0) {
      return { symbolFrequencies: {}, totalLength: 0, chunkTags: [], shannonLimitBits: 0 };
    }

    const freqMap = new Map<string, number>();
    for (const ch of input) {
      freqMap.set(ch, (freqMap.get(ch) ?? 0) + 1);
    }

    const symbols = Array.from(freqMap.keys()).sort();
    const n = input.length;
    const cdfLow = new Map<string, number>();
    const cdfHigh = new Map<string, number>();
    let acc = 0;
    let shannonLimitBits = 0;

    for (const s of symbols) {
      const count = freqMap.get(s)!;
      const p = count / n;
      shannonLimitBits -= count * Math.log2(p);
      cdfLow.set(s, acc / n);
      acc += count;
      cdfHigh.set(s, acc / n);
    }

    const chunkTags: number[] = [];
    for (let offset = 0; offset < n; offset += IntegerRangeEntropyCodec.CHUNK_SIZE) {
      const slice = input.slice(offset, offset + IntegerRangeEntropyCodec.CHUNK_SIZE);
      let low = 0.0;
      let high = 1.0;
      for (const ch of slice) {
        const range = high - low;
        const sLow = cdfLow.get(ch)!;
        const sHigh = cdfHigh.get(ch)!;
        high = low + range * sHigh;
        low = low + range * sLow;
      }
      chunkTags.push(0.5 * (low + high));
    }

    return {
      symbolFrequencies: Object.fromEntries(freqMap.entries()),
      totalLength: n,
      chunkTags,
      shannonLimitBits: Number(shannonLimitBits.toFixed(6))
    };
  }

  public static decode(bundle: {
    symbolFrequencies: Record<string, number>;
    totalLength: number;
    chunkTags: number[];
  }): string {
    if (bundle.totalLength === 0) return "";

    const symbols = Object.keys(bundle.symbolFrequencies).sort();
    const n = bundle.totalLength;
    const intervals: Array<{ sym: string; low: number; high: number }> = [];
    let acc = 0;

    for (const s of symbols) {
      const count = bundle.symbolFrequencies[s]!;
      const low = acc / n;
      acc += count;
      const high = acc / n;
      intervals.push({ sym: s, low, high });
    }

    const out: string[] = [];
    let remaining = bundle.totalLength;

    for (const tag of bundle.chunkTags) {
      const steps = Math.min(IntegerRangeEntropyCodec.CHUNK_SIZE, remaining);
      let v = tag;
      for (let i = 0; i < steps; i++) {
        let matched = intervals[intervals.length - 1]!;
        for (const iv of intervals) {
          if (v >= iv.low - 1e-15 && v < iv.high) {
            matched = iv;
            break;
          }
        }
        out.push(matched.sym);
        v = (v - matched.low) / Math.max(1e-15, matched.high - matched.low);
      }
      remaining -= steps;
    }

    return out.join("");
  }
}
