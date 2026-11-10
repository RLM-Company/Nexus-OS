import { createHash } from "node:crypto";

export interface ElGamalCiphertext {
  ephemeralC1: bigint;
  maskedMessageC2: bigint;
}

export interface ChaumPedersenDleqProof {
  baseG: bigint;
  baseH: bigint;
  publicY1: bigint;
  publicY2: bigint;
  commitmentA1: bigint;
  commitmentA2: bigint;
  challengeC: bigint;
  responseS: bigint;
}

/**
 * Taher ElGamal's Multiplicatively Homomorphic Cryptosystem & Chaum-Pedersen DLEQ Verifier.
 * Operates over GF(P)^* where P = 2^61 - 1 (Mersenne Prime 2305843009213693951n):
 * - ElGamal encryption of plaintext m in GF(P)^* under public key Y = G^x mod P with nonce r:
 *   c1 = G^r mod P, c2 = (m * Y^r) mod P
 * - Decryption: m = c2 * (c1^x)^{-1} mod P
 * - Multiplicative Homomorphism:
 *   (c1_a * c1_b mod P, c2_a * c2_b mod P) decrypts to (m_a * m_b) mod P!
 * - Chaum-Pedersen DLEQ(G, Y1, H, Y2) proves in zero knowledge that log_G(Y1) == log_H(Y2) == x.
 */
export class ElGamalAndChaumPedersenDleqEngine {
  public static readonly PRIME_P = 2305843009213693951n; // 2^61 - 1
  public static readonly ORDER_M = 2305843009213693950n; // P - 1
  public static readonly GENERATOR_G = 37n;
  public static readonly GENERATOR_H = 103n;

  public static modPow(
    base: bigint,
    exp: bigint,
    mod: bigint = ElGamalAndChaumPedersenDleqEngine.PRIME_P
  ): bigint {
    let res = 1n;
    let b = ((base % mod) + mod) % mod;
    let e = exp < 0n ? ((exp % (mod - 1n)) + (mod - 1n)) % (mod - 1n) : exp;
    while (e > 0n) {
      if ((e & 1n) === 1n) res = (res * b) % mod;
      b = (b * b) % mod;
      e >>= 1n;
    }
    return res;
  }

  public static modInverse(
    a: bigint,
    mod: bigint = ElGamalAndChaumPedersenDleqEngine.PRIME_P
  ): bigint {
    let t = 0n;
    let newT = 1n;
    let r = mod;
    let newR = ((a % mod) + mod) % mod;
    while (newR !== 0n) {
      const q = r / newR;
      [t, newT] = [newT, t - q * newT];
      [r, newR] = [newR, r - q * newR];
    }
    if (r > 1n) {
      throw new Error(`Value ${a.toString()} not invertible mod ${mod.toString()}`);
    }
    return t < 0n ? t + mod : t;
  }

  public static derivePublicKey(secretKeyX: bigint): bigint {
    return ElGamalAndChaumPedersenDleqEngine.modPow(
      ElGamalAndChaumPedersenDleqEngine.GENERATOR_G,
      secretKeyX
    );
  }

  public static encrypt(
    publicKeyY: bigint,
    plaintextM: bigint,
    nonceR: bigint
  ): ElGamalCiphertext {
    const P = ElGamalAndChaumPedersenDleqEngine.PRIME_P;
    const G = ElGamalAndChaumPedersenDleqEngine.GENERATOR_G;
    const c1 = ElGamalAndChaumPedersenDleqEngine.modPow(G, nonceR, P);
    const shared = ElGamalAndChaumPedersenDleqEngine.modPow(publicKeyY, nonceR, P);
    const c2 = (((plaintextM % P) + P) % P * shared) % P;
    return { ephemeralC1: c1, maskedMessageC2: c2 };
  }

  public static decrypt(secretKeyX: bigint, ciphertext: ElGamalCiphertext): bigint {
    const P = ElGamalAndChaumPedersenDleqEngine.PRIME_P;
    const shared = ElGamalAndChaumPedersenDleqEngine.modPow(
      ciphertext.ephemeralC1,
      secretKeyX,
      P
    );
    const invShared = ElGamalAndChaumPedersenDleqEngine.modInverse(shared, P);
    return (ciphertext.maskedMessageC2 * invShared) % P;
  }

  public static homomorphicMultiplyCiphertexts(
    ctA: ElGamalCiphertext,
    ctB: ElGamalCiphertext
  ): ElGamalCiphertext {
    const P = ElGamalAndChaumPedersenDleqEngine.PRIME_P;
    return {
      ephemeralC1: (ctA.ephemeralC1 * ctB.ephemeralC1) % P,
      maskedMessageC2: (ctA.maskedMessageC2 * ctB.maskedMessageC2) % P
    };
  }

  private static hashDleqChallenge(
    g: bigint,
    h: bigint,
    y1: bigint,
    y2: bigint,
    a1: bigint,
    a2: bigint
  ): bigint {
    const digest = createHash("sha256")
      .update(`DLEQ:${g}:${h}:${y1}:${y2}:${a1}:${a2}`)
      .digest("hex");
    return (
      (BigInt("0x" + digest.slice(0, 15)) %
        (ElGamalAndChaumPedersenDleqEngine.ORDER_M - 1n)) +
      1n
    );
  }

  public static createChaumPedersenDleqProof(
    secretExponentX: bigint,
    nonceK: bigint,
    baseG: bigint = ElGamalAndChaumPedersenDleqEngine.GENERATOR_G,
    baseH: bigint = ElGamalAndChaumPedersenDleqEngine.GENERATOR_H
  ): ChaumPedersenDleqProof {
    const P = ElGamalAndChaumPedersenDleqEngine.PRIME_P;
    const M = ElGamalAndChaumPedersenDleqEngine.ORDER_M;
    const x = ((secretExponentX % M) + M) % M;
    const k = ((nonceK % M) + M) % M;

    const publicY1 = ElGamalAndChaumPedersenDleqEngine.modPow(baseG, x, P);
    const publicY2 = ElGamalAndChaumPedersenDleqEngine.modPow(baseH, x, P);
    const commitmentA1 = ElGamalAndChaumPedersenDleqEngine.modPow(baseG, k, P);
    const commitmentA2 = ElGamalAndChaumPedersenDleqEngine.modPow(baseH, k, P);

    const challengeC = ElGamalAndChaumPedersenDleqEngine.hashDleqChallenge(
      baseG,
      baseH,
      publicY1,
      publicY2,
      commitmentA1,
      commitmentA2
    );
    const responseS = (k + challengeC * x) % M;

    return {
      baseG,
      baseH,
      publicY1,
      publicY2,
      commitmentA1,
      commitmentA2,
      challengeC,
      responseS
    };
  }

  public static verifyChaumPedersenDleqProof(proof: ChaumPedersenDleqProof): boolean {
    const P = ElGamalAndChaumPedersenDleqEngine.PRIME_P;
    const expectedC = ElGamalAndChaumPedersenDleqEngine.hashDleqChallenge(
      proof.baseG,
      proof.baseH,
      proof.publicY1,
      proof.publicY2,
      proof.commitmentA1,
      proof.commitmentA2
    );
    if (expectedC !== proof.challengeC) return false;

    const lhs1 = ElGamalAndChaumPedersenDleqEngine.modPow(proof.baseG, proof.responseS, P);
    const rhs1 =
      (proof.commitmentA1 *
        ElGamalAndChaumPedersenDleqEngine.modPow(proof.publicY1, proof.challengeC, P)) %
      P;

    const lhs2 = ElGamalAndChaumPedersenDleqEngine.modPow(proof.baseH, proof.responseS, P);
    const rhs2 =
      (proof.commitmentA2 *
        ElGamalAndChaumPedersenDleqEngine.modPow(proof.publicY2, proof.challengeC, P)) %
      P;

    return lhs1 === rhs1 && lhs2 === rhs2;
  }
}
