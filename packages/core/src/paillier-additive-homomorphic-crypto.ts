export interface PaillierKeyPair {
  n: bigint;
  nSquared: bigint;
  g: bigint;
  lambda: bigint;
  mu: bigint;
}

/**
 * Pascal Paillier's Additive Homomorphic Public-Key Cryptosystem over Z_{n^2}^*.
 * Using g = n + 1:
 * - Encryption of plaintext m in Z_n with random blinding r in Z_n^*:
 *   c = g^m * r^n mod n^2 = ((1 + m * n) * r^n) mod n^2
 * - Decryption with Carmichael lambda = lcm(p - 1, q - 1) and mu = lambda^{-1} mod n:
 *   m = L(c^lambda mod n^2) * mu mod n, where L(u) = (u - 1) / n
 * - Additive Homomorphism:
 *   Dec( Enc(m1, r1) * Enc(m2, r2) mod n^2 ) == (m1 + m2) mod n
 * - Scalar Multiplication Homomorphism:
 *   Dec( Enc(m1, r1)^k mod n^2 ) == (k * m1) mod n
 */
export class PaillierHomomorphicEncryptionEngine {
  public static gcd(a: bigint, b: bigint): bigint {
    let x = a < 0n ? -a : a;
    let y = b < 0n ? -b : b;
    while (y !== 0n) {
      const t = x % y;
      x = y;
      y = t;
    }
    return x;
  }

  public static lcm(a: bigint, b: bigint): bigint {
    return (a / PaillierHomomorphicEncryptionEngine.gcd(a, b)) * b;
  }

  public static modPow(base: bigint, exp: bigint, mod: bigint): bigint {
    let res = 1n;
    let b = ((base % mod) + mod) % mod;
    let e = exp;
    while (e > 0n) {
      if ((e & 1n) === 1n) res = (res * b) % mod;
      b = (b * b) % mod;
      e >>= 1n;
    }
    return res;
  }

  public static modInverse(a: bigint, m: bigint): bigint {
    let t = 0n;
    let newT = 1n;
    let r = m;
    let newR = ((a % m) + m) % m;
    while (newR !== 0n) {
      const q = r / newR;
      [t, newT] = [newT, t - q * newT];
      [r, newR] = [newR, r - q * newR];
    }
    if (r > 1n) {
      throw new Error(`Element ${a.toString()} is not invertible mod ${m.toString()}`);
    }
    return t < 0n ? t + m : t;
  }

  public static generateKeyPairFromPrimes(
    p: bigint = 104729n,
    q: bigint = 104723n
  ): PaillierKeyPair {
    const n = p * q;
    const nSquared = n * n;
    const g = n + 1n;
    const lambda = PaillierHomomorphicEncryptionEngine.lcm(p - 1n, q - 1n);
    const mu = PaillierHomomorphicEncryptionEngine.modInverse(lambda, n);
    return { n, nSquared, g, lambda, mu };
  }

  public static encrypt(
    key: PaillierKeyPair,
    plaintextM: bigint,
    blindingR: bigint = 65537n
  ): bigint {
    const m = ((plaintextM % key.n) + key.n) % key.n;
    const gm = (1n + m * key.n) % key.nSquared;
    const rn = PaillierHomomorphicEncryptionEngine.modPow(blindingR, key.n, key.nSquared);
    return (gm * rn) % key.nSquared;
  }

  public static decrypt(key: PaillierKeyPair, ciphertextC: bigint): bigint {
    const u = PaillierHomomorphicEncryptionEngine.modPow(ciphertextC, key.lambda, key.nSquared);
    const lOfU = (u - 1n) / key.n;
    return ((lOfU % key.n) * key.mu) % key.n;
  }

  public static homomorphicAddCiphertexts(
    key: PaillierKeyPair,
    c1: bigint,
    c2: bigint
  ): bigint {
    return (c1 * c2) % key.nSquared;
  }

  public static homomorphicScalarMultiply(
    key: PaillierKeyPair,
    ciphertextC: bigint,
    scalarK: bigint
  ): bigint {
    return PaillierHomomorphicEncryptionEngine.modPow(ciphertextC, scalarK, key.nSquared);
  }
}
