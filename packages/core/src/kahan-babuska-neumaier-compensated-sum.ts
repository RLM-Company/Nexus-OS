/**
 * Arnold Neumaier's Improved Kahan-Babuska Compensated Summation & Accurate Dot Product.
 * Tracks the running rounding error `c` even when the next summand `|x_i|` is larger than
 * the running sum `|sum|`, preventing catastrophic cancellation in ill-conditioned series
 * such as `[1, 1e100, 1, -1e100]`.
 */
export class NeumaierAndPairwiseCompensatedArithmetic {
  public static neumaierSum(values: number[]): {
    compensatedSum: number;
    naiveFloatSum: number;
    recoveredRoundingError: number;
  } {
    let sum = 0.0;
    let c = 0.0;
    let naive = 0.0;

    for (const x of values) {
      naive += x;
      const t = sum + x;
      if (Math.abs(sum) >= Math.abs(x)) {
        c += sum - t + x;
      } else {
        c += x - t + sum;
      }
      sum = t;
    }

    const compensatedSum = sum + c;
    return {
      compensatedSum,
      naiveFloatSum: naive,
      recoveredRoundingError: c
    };
  }

  public static compensatedDotProduct(vecA: number[], vecB: number[]): number {
    const n = Math.min(vecA.length, vecB.length);
    const products = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      products[i] = vecA[i]! * vecB[i]!;
    }
    return NeumaierAndPairwiseCompensatedArithmetic.neumaierSum(products).compensatedSum;
  }
}
