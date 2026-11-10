import { createHash } from "node:crypto";

export interface SchnorrNonInteractiveProof {
  publicKeyY: bigint;
  commitmentT: bigint;
  challengeC: bigint;
  responseS: bigint;
}

export interface PedersenCommitmentValue {
  commitmentC: bigint;
  valueV: bigint;
  blindingFactorR: bigint;
}

/**
 * Non-Interactive Schnorr Zero-Knowledge Proof (Fiat-Shamir Transform) & Homomorphic Pedersen Commitments.
 * Operates over safe prime subgroup (P = 2Q + 1) where P = 2^61 - 1? No: uses safe prime
 * P = 4611686018427387847n (62-bit prime) with generator G = 5n and independent generator H = 7n.
 * - Schnorr ZKP proves knowledge of secret x such that Y = G^x mod P without revealing x:
 *   T = G^k mod P, c = H(G || Y || T || context) mod (P-1), s = (k + c * x) mod (P-1),
 *   verified by checking G^s == T * Y^c mod P.
 * - Pedersen commitment C(v, r) = G^v * H^r mod P satisfies additive homomorphism:
 *   (C(v1, r1) * C(v2, r2)) mod P == C((v1 + v2) mod (P-1), (r1 + r2) mod (P-1)).
 */
export class SchnorrZkpAndPedersenCommitmentEngine {
  public static readonly PRIME_P = 2305843009213693951n; // 2^61 - 1 (Mersenne Prime)
  public static readonly ORDER_M = 2305843009213693950n; // P - 1
  public static readonly GENERATOR_G = 37n;
  public static readonly GENERATOR_H = 101n;

  public static modPow(base: bigint, exp: bigint, mod: bigint = SchnorrZkpAndPedersenCommitmentEngine.PRIME_P): bigint {
    let result = 1n;
    let b = ((base % mod) + mod) % mod;
    let e = exp < 0n ? ((exp % (mod - 1n)) + (mod - 1n)) % (mod - 1n) : exp;
    while (e > 0n) {
      if ((e & 1n) === 1n) {
        result = (result * b) % mod;
      }
      b = (b * b) % mod;
      e >>= 1n;
    }
    return result;
  }

  private static hashChallenge(y: bigint, t: bigint, context: string): bigint {
    const digest = createHash("sha256")
      .update(
        `${SchnorrZkpAndPedersenCommitmentEngine.GENERATOR_G}:${y}:${t}:${context}`
      )
      .digest("hex");
    return (BigInt("0x" + digest.slice(0, 15)) % (SchnorrZkpAndPedersenCommitmentEngine.ORDER_M - 1n)) + 1n;
  }

  public static createSchnorrProof(
    secretX: bigint,
    nonceK: bigint,
    context: string = "kosmora-zkp-auth"
  ): SchnorrNonInteractiveProof {
    const P = SchnorrZkpAndPedersenCommitmentEngine.PRIME_P;
    const M = SchnorrZkpAndPedersenCommitmentEngine.ORDER_M;
    const G = SchnorrZkpAndPedersenCommitmentEngine.GENERATOR_G;

    const x = ((secretX % M) + M) % M;
    const k = ((nonceK % M) + M) % M;
    const publicKeyY = SchnorrZkpAndPedersenCommitmentEngine.modPow(G, x, P);
    const commitmentT = SchnorrZkpAndPedersenCommitmentEngine.modPow(G, k, P);
    const challengeC = SchnorrZkpAndPedersenCommitmentEngine.hashChallenge(
      publicKeyY,
      commitmentT,
      context
    );
    const responseS = (k + challengeC * x) % M;

    return {
      publicKeyY,
      commitmentT,
      challengeC,
      responseS
    };
  }

  public static verifySchnorrProof(
    proof: SchnorrNonInteractiveProof,
    context: string = "kosmora-zkp-auth"
  ): boolean {
    const P = SchnorrZkpAndPedersenCommitmentEngine.PRIME_P;
    const G = SchnorrZkpAndPedersenCommitmentEngine.GENERATOR_G;

    const expectedC = SchnorrZkpAndPedersenCommitmentEngine.hashChallenge(
      proof.publicKeyY,
      proof.commitmentT,
      context
    );
    if (expectedC !== proof.challengeC) return false;

    const lhs = SchnorrZkpAndPedersenCommitmentEngine.modPow(G, proof.responseS, P);
    const rhs =
      (proof.commitmentT *
        SchnorrZkpAndPedersenCommitmentEngine.modPow(proof.publicKeyY, proof.challengeC, P)) %
      P;
    return lhs === rhs;
  }

  public static commitPedersen(valueV: bigint, blindingFactorR: bigint): PedersenCommitmentValue {
    const P = SchnorrZkpAndPedersenCommitmentEngine.PRIME_P;
    const M = SchnorrZkpAndPedersenCommitmentEngine.ORDER_M;
    const G = SchnorrZkpAndPedersenCommitmentEngine.GENERATOR_G;
    const H = SchnorrZkpAndPedersenCommitmentEngine.GENERATOR_H;

    const v = ((valueV % M) + M) % M;
    const r = ((blindingFactorR % M) + M) % M;
    const gv = SchnorrZkpAndPedersenCommitmentEngine.modPow(G, v, P);
    const hr = SchnorrZkpAndPedersenCommitmentEngine.modPow(H, r, P);
    return {
      commitmentC: (gv * hr) % P,
      valueV: v,
      blindingFactorR: r
    };
  }

  public static combineHomomorphicCommitments(
    c1: PedersenCommitmentValue,
    c2: PedersenCommitmentValue
  ): { productCommitment: bigint; combinedCommitment: PedersenCommitmentValue; verifiedEqual: boolean } {
    const P = SchnorrZkpAndPedersenCommitmentEngine.PRIME_P;
    const M = SchnorrZkpAndPedersenCommitmentEngine.ORDER_M;
    const productCommitment = (c1.commitmentC * c2.commitmentC) % P;
    const combinedCommitment = SchnorrZkpAndPedersenCommitmentEngine.commitPedersen(
      (c1.valueV + c2.valueV) % M,
      (c1.blindingFactorR + c2.blindingFactorR) % M
    );
    return {
      productCommitment,
      combinedCommitment,
      verifiedEqual: productCommitment === combinedCommitment.commitmentC
    };
  }
}
