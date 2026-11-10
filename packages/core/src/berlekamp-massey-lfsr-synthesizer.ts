export interface LfsrSynthesisResult {
  linearComplexityL: number;
  connectionPolynomialC: number[];
  recurrenceCoefficients: number[];
  predictedNextTerms: number[];
}

/**
 * Elwyn Berlekamp & James Massey's Shortest Linear Feedback Shift Register (LFSR) Synthesizer.
 * Given a sequence s_0, s_1, ..., s_{N-1} over a prime finite field GF(p), finds the minimal
 * degree L connection polynomial C(D) = 1 + c_1 D + ... + c_L D^L such that
 * s_n + c_1 s_{n-1} + ... + c_L s_{n-L} == 0 (mod p) for all n >= L.
 */
export class BerlekampMasseyLfsrSynthesizer {
  private static mod(a: number, p: number): number {
    const r = a % p;
    return r < 0 ? r + p : r;
  }

  private static modPow(base: number, exp: number, p: number): number {
    let res = 1;
    let b = BerlekampMasseyLfsrSynthesizer.mod(base, p);
    let e = exp;
    while (e > 0) {
      if (e & 1) res = (res * b) % p;
      b = (b * b) % p;
      e >>= 1;
    }
    return res;
  }

  public static synthesizeShortestLfsr(
    sequence: number[],
    primeModulusP: number = 10007,
    numPredictions: number = 3
  ): LfsrSynthesisResult {
    const n = sequence.length;
    const p = primeModulusP;
    const s = sequence.map((x) => BerlekampMasseyLfsrSynthesizer.mod(x, p));

    let C = [1];
    let B = [1];
    let L = 0;
    let m = 1;
    let b = 1;

    for (let idx = 0; idx < n; idx++) {
      // Compute discrepancy d = s[idx] + sum_{i=1..L} C[i] * s[idx - i] mod p
      let d = s[idx]!;
      for (let i = 1; i <= L; i++) {
        d = (d + (C[i] ?? 0) * s[idx - i]!) % p;
      }

      if (d === 0) {
        m++;
      } else {
        const T = [...C];
        const coef = (d * BerlekampMasseyLfsrSynthesizer.modPow(b, p - 2, p)) % p;
        const neededLen = Math.max(C.length, B.length + m);
        while (C.length < neededLen) C.push(0);
        for (let i = 0; i < B.length; i++) {
          C[i + m] = BerlekampMasseyLfsrSynthesizer.mod(C[i + m]! - coef * B[i]!, p);
        }
        if (2 * L <= idx) {
          L = idx + 1 - L;
          B = T;
          b = d;
          m = 1;
        } else {
          m++;
        }
      }
    }

    const connectionPolynomialC = C.slice(0, L + 1);
    // s_n = - sum_{i=1..L} C[i] * s_{n-i} mod p
    const recurrenceCoefficients = connectionPolynomialC
      .slice(1)
      .map((ci) => BerlekampMasseyLfsrSynthesizer.mod(-ci, p));

    const extended = [...s];
    const predictedNextTerms: number[] = [];
    for (let step = 0; step < numPredictions; step++) {
      let nextVal = 0;
      for (let i = 0; i < L; i++) {
        nextVal = (nextVal + recurrenceCoefficients[i]! * extended[extended.length - 1 - i]!) % p;
      }
      extended.push(nextVal);
      predictedNextTerms.push(nextVal);
    }

    return {
      linearComplexityL: L,
      connectionPolynomialC,
      recurrenceCoefficients,
      predictedNextTerms
    };
  }
}
