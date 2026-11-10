import { createHash } from "node:crypto";

export interface ShamirShare {
  shareIndexX: number;
  shareValueY: bigint;
  commitmentSha256: string;
}

export interface ShamirSplitResult {
  thresholdK: number;
  totalSharesN: number;
  primeModulus: bigint;
  shares: ShamirShare[];
}

/**
 * Adi Shamir's (k, n) Threshold Secret Sharing over Prime Field GF(p)
 * where p = 2^61 - 1 (Mersenne Prime 2305843009213693951n).
 * Supports polynomial evaluation via Horner's method, exact Lagrange interpolation
 * at x = 0 via Extended Euclidean modular inverse, and proactive zero-constant share refresh.
 */
export class ShamirLagrangeSecretSharingEngine {
  public static readonly MERSENNE_PRIME_P = 2305843009213693951n; // 2^61 - 1

  public static mod(a: bigint, p: bigint = ShamirLagrangeSecretSharingEngine.MERSENNE_PRIME_P): bigint {
    const r = a % p;
    return r < 0n ? r + p : r;
  }

  public static modInverse(a: bigint, p: bigint = ShamirLagrangeSecretSharingEngine.MERSENNE_PRIME_P): bigint {
    let t = 0n;
    let newT = 1n;
    let r = p;
    let newR = ShamirLagrangeSecretSharingEngine.mod(a, p);

    while (newR !== 0n) {
      const quotient = r / newR;
      [t, newT] = [newT, t - quotient * newT];
      [r, newR] = [newR, r - quotient * newR];
    }
    if (r > 1n) {
      throw new Error(`Value ${a.toString()} is not invertible mod ${p.toString()}`);
    }
    return t < 0n ? t + p : t;
  }

  public static splitSecret(
    secret: bigint,
    thresholdK: number,
    totalSharesN: number,
    deterministicSeed: string = "kosmora-shamir-seed"
  ): ShamirSplitResult {
    const p = ShamirLagrangeSecretSharingEngine.MERSENNE_PRIME_P;
    if (thresholdK < 2 || thresholdK > totalSharesN) {
      throw new Error(`Invalid (k, n) threshold parameters: (${thresholdK}, ${totalSharesN})`);
    }
    const normalizedSecret = ShamirLagrangeSecretSharingEngine.mod(secret, p);

    // Generate degree-(k-1) polynomial coefficients: a_0 = secret, a_1..a_{k-1} derived deterministically
    const coeffs: bigint[] = [normalizedSecret];
    for (let deg = 1; deg < thresholdK; deg++) {
      const digest = createHash("sha256")
        .update(`${deterministicSeed}:coeff:${deg}:${normalizedSecret.toString()}`)
        .digest("hex");
      const raw = BigInt("0x" + digest.slice(0, 15));
      const c = (raw % (p - 1n)) + 1n; // strictly non-zero
      coeffs.push(c);
    }

    const shares: ShamirShare[] = [];
    for (let x = 1; x <= totalSharesN; x++) {
      const xBig = BigInt(x);
      // Horner's evaluation: P(x) = (...((a_{k-1} * x + a_{k-2}) * x + ...) * x + a_0
      let y = 0n;
      for (let i = coeffs.length - 1; i >= 0; i--) {
        y = ShamirLagrangeSecretSharingEngine.mod(y * xBig + coeffs[i]!, p);
      }
      const commitmentSha256 = createHash("sha256")
        .update(`${x}:${y.toString()}:${p.toString()}`)
        .digest("hex");
      shares.push({
        shareIndexX: x,
        shareValueY: y,
        commitmentSha256
      });
    }

    return {
      thresholdK,
      totalSharesN,
      primeModulus: p,
      shares
    };
  }

  public static reconstructSecret(shares: ShamirShare[]): bigint {
    const p = ShamirLagrangeSecretSharingEngine.MERSENNE_PRIME_P;
    if (shares.length === 0) {
      throw new Error("At least 1 share is required for Lagrange interpolation");
    }

    // Verify share commitments
    for (const s of shares) {
      const expected = createHash("sha256")
        .update(`${s.shareIndexX}:${s.shareValueY.toString()}:${p.toString()}`)
        .digest("hex");
      if (expected !== s.commitmentSha256) {
        throw new Error(`Share integrity check failed for share x=${s.shareIndexX}`);
      }
    }

    // Lagrange interpolation at x = 0:
    // f(0) = sum_{i} y_i * prod_{j != i} (0 - x_j) / (x_i - x_j) mod p
    let secret = 0n;
    for (let i = 0; i < shares.length; i++) {
      const xi = BigInt(shares[i]!.shareIndexX);
      const yi = shares[i]!.shareValueY;
      let num = 1n;
      let den = 1n;
      for (let j = 0; j < shares.length; j++) {
        if (i === j) continue;
        const xj = BigInt(shares[j]!.shareIndexX);
        num = ShamirLagrangeSecretSharingEngine.mod(num * -xj, p);
        den = ShamirLagrangeSecretSharingEngine.mod(den * (xi - xj), p);
      }
      const basis0 = ShamirLagrangeSecretSharingEngine.mod(
        num * ShamirLagrangeSecretSharingEngine.modInverse(den, p),
        p
      );
      const term = ShamirLagrangeSecretSharingEngine.mod(yi * basis0, p);
      secret = ShamirLagrangeSecretSharingEngine.mod(secret + term, p);
    }

    return secret;
  }

  /**
   * Proactive secret sharing refresh: adds a random polynomial delta(x) with delta(0) = 0
   * so all shares change while the reconstructed secret at x = 0 remains invariant.
   */
  public static refreshSharesProactively(
    shares: ShamirShare[],
    thresholdK: number,
    epochId: string
  ): ShamirShare[] {
    const p = ShamirLagrangeSecretSharingEngine.MERSENNE_PRIME_P;
    const zeroShareSplit = ShamirLagrangeSecretSharingEngine.splitSecret(
      0n,
      thresholdK,
      Math.max(...shares.map((s) => s.shareIndexX)),
      `refresh:${epochId}`
    );
    const deltaByX = new Map<number, bigint>(
      zeroShareSplit.shares.map((s) => [s.shareIndexX, s.shareValueY])
    );

    return shares.map((s) => {
      const delta = deltaByX.get(s.shareIndexX) ?? 0n;
      const newY = ShamirLagrangeSecretSharingEngine.mod(s.shareValueY + delta, p);
      return {
        shareIndexX: s.shareIndexX,
        shareValueY: newY,
        commitmentSha256: createHash("sha256")
          .update(`${s.shareIndexX}:${newY.toString()}:${p.toString()}`)
          .digest("hex")
      };
    });
  }
}
