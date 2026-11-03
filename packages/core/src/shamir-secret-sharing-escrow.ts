import { createHash, randomBytes } from "node:crypto";

/**
 * Finite Field GF(256) arithmetic with AES irreducible polynomial x^8 + x^4 + x^3 + x + 1 (0x11B).
 */
const GF256_EXP = new Uint8Array(512);
const GF256_LOG = new Uint8Array(256);

(function initGf256Tables() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF256_EXP[i] = x;
    GF256_EXP[i + 255] = x;
    GF256_LOG[x] = i;
    // Multiply by generator 0x03 in GF(2^8) modulo 0x11B
    let x2 = x << 1;
    if (x2 & 0x100) {
      x2 ^= 0x11b;
    }
    x = x2 ^ x;
  }
  GF256_LOG[0] = 0;
})();

function gfAdd(a: number, b: number): number {
  return (a ^ b) & 0xff;
}

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF256_EXP[GF256_LOG[a]! + GF256_LOG[b]!]!;
}

function gfDiv(a: number, b: number): number {
  if (b === 0) {
    throw new Error("GF256_DIVISION_BY_ZERO");
  }
  if (a === 0) return 0;
  return GF256_EXP[GF256_LOG[a]! + 255 - GF256_LOG[b]!]!;
}

export interface SecretSharePacket {
  shareIndex: number; // x-coordinate in [1..255]
  thresholdK: number;
  totalSharesN: number;
  payloadBase64: string; // y-values for each byte
  shareDigestSha256: string; // integrity hash of (shareIndex, thresholdK, payloadBase64)
}

/**
 * Shamir's (k, n) Threshold Secret Sharing & Proactive Share Refresh Engine over GF(256).
 * Enables zero-trust escrow of Vault master keys and emergency recovery keys.
 */
export class ShamirSecretSharingEscrow {
  private static computeShareDigest(
    shareIndex: number,
    thresholdK: number,
    payloadBase64: string
  ): string {
    return createHash("sha256")
      .update(`${shareIndex}:${thresholdK}:${payloadBase64}`, "utf8")
      .digest("hex");
  }

  /**
   * Splits a secret buffer into `totalSharesN` threshold shares such that any `thresholdK`
   * shares reconstruct the exact secret via Lagrange interpolation over GF(256), while
   * `thresholdK - 1` shares reveal 0 bits of information.
   */
  public static splitSecret(
    secret: Buffer | string,
    thresholdK: number,
    totalSharesN: number
  ): SecretSharePacket[] {
    const secretBuf = typeof secret === "string" ? Buffer.from(secret, "utf8") : secret;
    if (secretBuf.length === 0) {
      throw new Error("INVALID_SECRET: secret cannot be empty");
    }
    if (thresholdK < 2 || thresholdK > totalSharesN || totalSharesN > 255) {
      throw new Error(
        `INVALID_THRESHOLD_PARAMS: require 2 <= thresholdK (${thresholdK}) <= totalSharesN (${totalSharesN}) <= 255`
      );
    }

    const shareBuffers = Array.from({ length: totalSharesN }, () =>
      Buffer.alloc(secretBuf.length)
    );

    const coeffs = new Uint8Array(thresholdK);
    for (let byteIdx = 0; byteIdx < secretBuf.length; byteIdx++) {
      coeffs[0] = secretBuf[byteIdx]!;
      const randCoeffs = randomBytes(thresholdK - 1);
      for (let d = 1; d < thresholdK; d++) {
        // Ensure highest-degree coefficient is non-zero
        coeffs[d] = d === thresholdK - 1 && randCoeffs[d - 1] === 0 ? 1 : randCoeffs[d - 1]!;
      }

      for (let s = 0; s < totalSharesN; s++) {
        const x = s + 1;
        // Horner's method evaluation over GF(256)
        let y = 0;
        for (let d = thresholdK - 1; d >= 0; d--) {
          y = gfAdd(gfMul(y, x), coeffs[d]!);
        }
        shareBuffers[s]![byteIdx] = y;
      }
    }

    return shareBuffers.map((buf, idx) => {
      const shareIndex = idx + 1;
      const payloadBase64 = buf.toString("base64");
      return {
        shareIndex,
        thresholdK,
        totalSharesN,
        payloadBase64,
        shareDigestSha256: ShamirSecretSharingEscrow.computeShareDigest(
          shareIndex,
          thresholdK,
          payloadBase64
        )
      };
    });
  }

  /**
   * Reconstructs the original secret Buffer from at least `thresholdK` valid shares
   * using Lagrange polynomial interpolation at x = 0 over GF(256).
   */
  public static reconstructSecret(shares: SecretSharePacket[]): Buffer {
    if (shares.length === 0) {
      throw new Error("INSUFFICIENT_SHARES: no shares provided");
    }

    const k = shares[0]!.thresholdK;
    if (shares.length < k) {
      throw new Error(
        `INSUFFICIENT_SHARES: provided ${shares.length} shares, but thresholdK is ${k}`
      );
    }

    // Verify integrity and uniqueness of first k shares
    const selected = shares.slice(0, k);
    const seenX = new Set<number>();
    const decodedBuffers: Buffer[] = [];

    for (const share of selected) {
      if (share.thresholdK !== k) {
        throw new Error("SHARE_THRESHOLD_MISMATCH: incompatible thresholdK across shares");
      }
      const expectedDigest = ShamirSecretSharingEscrow.computeShareDigest(
        share.shareIndex,
        share.thresholdK,
        share.payloadBase64
      );
      if (expectedDigest !== share.shareDigestSha256) {
        throw new Error(`CORRUPTED_SHARE_DIGEST: share #${share.shareIndex} failed SHA-256 check`);
      }
      if (seenX.has(share.shareIndex)) {
        throw new Error(`DUPLICATE_SHARE_INDEX: duplicate share #${share.shareIndex}`);
      }
      seenX.add(share.shareIndex);
      decodedBuffers.push(Buffer.from(share.payloadBase64, "base64"));
    }

    const secretLength = decodedBuffers[0]!.length;
    for (const buf of decodedBuffers) {
      if (buf.length !== secretLength) {
        throw new Error("SHARE_LENGTH_MISMATCH: shares have differing byte lengths");
      }
    }

    // Precompute Lagrange basis polynomials L_i(0) = \prod_{j != i} x_j / (x_j ^ x_i) in GF(256)
    const lagrangeWeights = new Uint8Array(k);
    for (let i = 0; i < k; i++) {
      const xi = selected[i]!.shareIndex;
      let num = 1;
      let den = 1;
      for (let j = 0; j < k; j++) {
        if (i === j) continue;
        const xj = selected[j]!.shareIndex;
        num = gfMul(num, xj);
        den = gfMul(den, gfAdd(xj, xi));
      }
      lagrangeWeights[i] = gfDiv(num, den);
    }

    const output = Buffer.alloc(secretLength);
    for (let byteIdx = 0; byteIdx < secretLength; byteIdx++) {
      let accum = 0;
      for (let i = 0; i < k; i++) {
        const yi = decodedBuffers[i]![byteIdx]!;
        accum = gfAdd(accum, gfMul(yi, lagrangeWeights[i]!));
      }
      output[byteIdx] = accum;
    }

    return output;
  }

  /**
   * Proactively rotates all shares by adding a random degree-(k-1) polynomial delta(x)
   * with delta(0) = 0, invalidating compromised old shares without reconstructing the secret!
   */
  public static refreshSharesWithoutReconstructing(
    shares: SecretSharePacket[]
  ): SecretSharePacket[] {
    if (shares.length === 0) return [];
    const k = shares[0]!.thresholdK;
    const buffers = shares.map((s) => Buffer.from(s.payloadBase64, "base64"));
    const byteLength = buffers[0]!.length;

    const deltaCoeffs = new Uint8Array(k);
    deltaCoeffs[0] = 0; // P_delta(0) == 0 preserves the secret!

    for (let byteIdx = 0; byteIdx < byteLength; byteIdx++) {
      const rand = randomBytes(k - 1);
      for (let d = 1; d < k; d++) {
        deltaCoeffs[d] = rand[d - 1]! || 1;
      }

      for (let s = 0; s < shares.length; s++) {
        const x = shares[s]!.shareIndex;
        let deltaY = 0;
        for (let d = k - 1; d >= 0; d--) {
          deltaY = gfAdd(gfMul(deltaY, x), deltaCoeffs[d]!);
        }
        buffers[s]![byteIdx] = gfAdd(buffers[s]![byteIdx]!, deltaY);
      }
    }

    return shares.map((orig, idx) => {
      const payloadBase64 = buffers[idx]!.toString("base64");
      return {
        shareIndex: orig.shareIndex,
        thresholdK: orig.thresholdK,
        totalSharesN: orig.totalSharesN,
        payloadBase64,
        shareDigestSha256: ShamirSecretSharingEscrow.computeShareDigest(
          orig.shareIndex,
          orig.thresholdK,
          payloadBase64
        )
      };
    });
  }
}
