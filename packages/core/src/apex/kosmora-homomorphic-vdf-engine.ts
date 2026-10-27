/**
 * Stage 12 (F353-F384): Paillier Additive Homomorphic Encryption over Z_{n^2}^*,
 * Wesolowski-Style Verifiable Delay Functions (VDF), Chained HMAC Capability Macaroons
 * with Contextual Caveat Attenuation & 3f+1 Byzantine Quorum Intersection Engine.
 */

import { createHash, createHmac } from "node:crypto";

export interface PaillierPublicKey {
  n: string;
  n_squared: string;
  g: string;
}

export interface PaillierCiphertext {
  ciphertext_dec: string;
  public_n: string;
}

export interface VdfEvaluationProof {
  challenge_id: string;
  input_x: string;
  iterations_t: number;
  modulus_n: string;
  output_y: string;
  prime_challenge_l: string;
  wesolowski_proof_pi: string;
}

export interface CapabilityMacaroon {
  identifier: string;
  location: string;
  caveats: string[];
  signature_hmac_hex: string;
}

export interface ByzantineVoteRecord {
  validator_id: string;
  view_number: number;
  block_digest: string;
  signature_hex: string;
}

export interface ByzantineQuorumReport {
  total_validators_n: number;
  max_faulty_f: number;
  required_quorum_size: number;
  intersection_nodes: string[];
  honest_intersection_guaranteed: boolean;
  equivocating_validators: string[];
  quorum_certificate_sha256: string;
}

function sha256Hex(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

function gcdBig(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y > 0n) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x;
}

function lcmBig(a: bigint, b: bigint): bigint {
  return (a * b) / gcdBig(a, b);
}

function modPowBig(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n;
  let b = ((base % mod) + mod) % mod;
  let e = exp;
  while (e > 0n) {
    if ((e & 1n) === 1n) result = (result * b) % mod;
    b = (b * b) % mod;
    e >>= 1n;
  }
  return result;
}

function extGcdBig(a: bigint, b: bigint): { g: bigint; x: bigint; y: bigint } {
  if (b === 0n) return { g: a, x: 1n, y: 0n };
  const next = extGcdBig(b, a % b);
  return {
    g: next.g,
    x: next.y,
    y: next.x - (a / b) * next.y
  };
}

function modInverseBig(a: bigint, m: bigint): bigint {
  const { g, x } = extGcdBig(((a % m) + m) % m, m);
  if (g !== 1n) {
    throw new Error(`Modular inverse does not exist for ${a.toString()} mod ${m.toString()}`);
  }
  return ((x % m) + m) % m;
}

export class KosmoraHomomorphicVdfEngine {
  // Deterministic Paillier keypair using twin safe primes p=31397, q=31469 (n = 988,032,193)
  private readonly p = 31397n;
  private readonly q = 31469n;
  private readonly n: bigint;
  private readonly nSquared: bigint;
  private readonly g: bigint;
  private readonly lambda: bigint;
  private readonly mu: bigint;

  constructor() {
    this.n = this.p * this.q; // 988032193n
    this.nSquared = this.n * this.n; // 976207614403435249n
    this.g = this.n + 1n;
    this.lambda = lcmBig(this.p - 1n, this.q - 1n);
    // L(u) = (u - 1) / n; for g = n + 1, L(g^lambda mod n^2) = lambda mod n
    const u = modPowBig(this.g, this.lambda, this.nSquared);
    const lVal = (u - 1n) / this.n;
    this.mu = modInverseBig(lVal, this.n);
  }

  public getPaillierPublicKey(): PaillierPublicKey {
    return {
      n: this.n.toString(),
      n_squared: this.nSquared.toString(),
      g: this.g.toString()
    };
  }

  // ==========================================================================
  // F353-F360: Paillier Additive Homomorphic Encryption over Z_{n^2}^*
  // ==========================================================================

  public encryptPaillierHomomorphic(
    plaintextInt: number,
    blindingSeed = "default_r"
  ): PaillierCiphertext {
    if (!Number.isInteger(plaintextInt) || plaintextInt < 0) {
      throw new Error("Paillier plaintext must be a non-negative integer.");
    }
    const m = BigInt(plaintextInt) % this.n;

    // Derive deterministic blinding factor r in Z_n^* with gcd(r, n) === 1
    let r =
      (BigInt("0x" + sha256Hex(`paillier_r:${blindingSeed}:${plaintextInt}`).slice(0, 7)) %
        (this.n - 2n)) +
      2n;
    while (gcdBig(r, this.n) !== 1n) {
      r += 1n;
    }

    // c = g^m * r^n mod n^2
    const gm = modPowBig(this.g, m, this.nSquared);
    const rn = modPowBig(r, this.n, this.nSquared);
    const c = (gm * rn) % this.nSquared;

    return {
      ciphertext_dec: c.toString(),
      public_n: this.n.toString()
    };
  }

  public addHomomorphicCiphertexts(
    c1: PaillierCiphertext,
    c2: PaillierCiphertext
  ): PaillierCiphertext {
    if (c1.public_n !== this.n.toString() || c2.public_n !== this.n.toString()) {
      throw new Error("Paillier public modulus mismatch during homomorphic addition.");
    }
    const product = (BigInt(c1.ciphertext_dec) * BigInt(c2.ciphertext_dec)) % this.nSquared;
    return {
      ciphertext_dec: product.toString(),
      public_n: this.n.toString()
    };
  }

  public multiplyHomomorphicScalar(
    ciphertext: PaillierCiphertext,
    scalarK: number
  ): PaillierCiphertext {
    if (!Number.isInteger(scalarK) || scalarK < 0) {
      throw new Error("Homomorphic scalar must be a non-negative integer.");
    }
    const powered = modPowBig(BigInt(ciphertext.ciphertext_dec), BigInt(scalarK), this.nSquared);
    return {
      ciphertext_dec: powered.toString(),
      public_n: this.n.toString()
    };
  }

  public decryptPaillierHomomorphic(ciphertext: PaillierCiphertext): number {
    const c = BigInt(ciphertext.ciphertext_dec);
    const u = modPowBig(c, this.lambda, this.nSquared);
    const lVal = (u - 1n) / this.n;
    const m = (lVal * this.mu) % this.n;
    return Number(m);
  }

  // ==========================================================================
  // F361-F368: Wesolowski Verifiable Delay Function (VDF) y = x^(2^T) mod N
  // ==========================================================================

  public evaluateVerifiableDelayFunction(params: {
    challenge_id: string;
    seed_input: string;
    iterations_t: number;
  }): VdfEvaluationProof {
    const t = Math.max(4, Math.min(4096, Math.trunc(params.iterations_t)));
    const N = this.n; // Blum-style composite modulus N = p * q
    const xRaw = BigInt("0x" + sha256Hex(`vdf_x:${params.seed_input}`).slice(0, 7));
    const x = (xRaw % (N - 3n)) + 2n;

    // Sequential squaring: y = x^(2^t) mod N
    let y = x;
    for (let i = 0; i < t; i++) {
      y = (y * y) % N;
    }

    // Fiat-Shamir prime challenge l from transcript H(x || y || t)
    const primeCandidates = [257n, 521n, 1031n, 2053n, 4099n, 8209n];
    const hashIdx = parseInt(sha256Hex(`${x.toString()}|${y.toString()}|${t}`).slice(0, 4), 16);
    const l = primeCandidates[hashIdx % primeCandidates.length]!;

    // Compute quotient q = floor(2^t / l) using big integer shift and division
    const twoPowT = 1n << BigInt(t);
    const quotientQ = twoPowT / l;
    const pi = modPowBig(x, quotientQ, N);

    return {
      challenge_id: params.challenge_id,
      input_x: x.toString(),
      iterations_t: t,
      modulus_n: N.toString(),
      output_y: y.toString(),
      prime_challenge_l: l.toString(),
      wesolowski_proof_pi: pi.toString()
    };
  }

  public verifyVerifiableDelayProof(proof: VdfEvaluationProof): boolean {
    const N = BigInt(proof.modulus_n);
    const x = BigInt(proof.input_x);
    const y = BigInt(proof.output_y);
    const l = BigInt(proof.prime_challenge_l);
    const pi = BigInt(proof.wesolowski_proof_pi);
    const t = BigInt(proof.iterations_t);

    // Fast verification: r = 2^t mod l; check (pi^l * x^r) mod N === y
    const r = modPowBig(2n, t, l);
    const rhs = (modPowBig(pi, l, N) * modPowBig(x, r, N)) % N;
    return rhs === y % N;
  }

  // ==========================================================================
  // F369-F376: Chained HMAC Capability Macaroons with Contextual Caveats
  // ==========================================================================

  public mintCapabilityMacaroon(params: {
    root_secret: string;
    identifier: string;
    location: string;
    initial_caveats?: string[];
  }): CapabilityMacaroon {
    let sig = createHmac("sha256", Buffer.from(params.root_secret, "utf8"))
      .update(params.identifier)
      .digest("hex");

    const caveats = [...(params.initial_caveats ?? [])];
    for (const cav of caveats) {
      sig = createHmac("sha256", Buffer.from(sig, "hex")).update(cav).digest("hex");
    }

    return {
      identifier: params.identifier,
      location: params.location,
      caveats,
      signature_hmac_hex: sig
    };
  }

  public attenuateMacaroonWithCaveats(
    macaroon: CapabilityMacaroon,
    additionalCaveats: string[]
  ): CapabilityMacaroon {
    let sig = macaroon.signature_hmac_hex;
    const nextCaveats = [...macaroon.caveats];
    for (const cav of additionalCaveats) {
      nextCaveats.push(cav);
      sig = createHmac("sha256", Buffer.from(sig, "hex")).update(cav).digest("hex");
    }
    return {
      identifier: macaroon.identifier,
      location: macaroon.location,
      caveats: nextCaveats,
      signature_hmac_hex: sig
    };
  }

  public verifyMacaroonAuthorization(params: {
    root_secret: string;
    macaroon: CapabilityMacaroon;
    context: Record<string, string | number>;
  }): { valid: boolean; failed_caveat: string | null } {
    // 1. Recompute chained HMAC from root_secret
    let expectedSig = createHmac("sha256", Buffer.from(params.root_secret, "utf8"))
      .update(params.macaroon.identifier)
      .digest("hex");

    for (const cav of params.macaroon.caveats) {
      expectedSig = createHmac("sha256", Buffer.from(expectedSig, "hex")).update(cav).digest("hex");
    }

    if (expectedSig !== params.macaroon.signature_hmac_hex) {
      return { valid: false, failed_caveat: "HMAC_SIGNATURE_MISMATCH" };
    }

    // 2. Evaluate contextual caveats (key = val or key <= num)
    for (const cav of params.macaroon.caveats) {
      if (cav.includes("<=")) {
        const [k, v] = cav.split("<=").map((s) => s.trim());
        const actual = Number(params.context[k!]);
        if (Number.isNaN(actual) || actual > Number(v)) {
          return { valid: false, failed_caveat: cav };
        }
      } else if (cav.includes("=")) {
        const [k, v] = cav.split("=").map((s) => s.trim());
        if (String(params.context[k!] ?? "") !== v) {
          return { valid: false, failed_caveat: cav };
        }
      }
    }

    return { valid: true, failed_caveat: null };
  }

  // ==========================================================================
  // F377-F384: Malkhi-Reiter 3f+1 Byzantine Quorum Intersection & Slasher
  // ==========================================================================

  public verifyByzantineQuorumIntersection(params: {
    validators: string[];
    quorum_a: string[];
    quorum_b: string[];
    votes: ByzantineVoteRecord[];
  }): ByzantineQuorumReport {
    const n = params.validators.length;
    const f = Math.floor((n - 1) / 3);
    const requiredQuorum = 2 * f + 1;

    const setB = new Set(params.quorum_b);
    const intersection = params.quorum_a.filter((v) => setB.has(v));
    const honestGuaranteed =
      params.quorum_a.length >= requiredQuorum &&
      params.quorum_b.length >= requiredQuorum &&
      intersection.length >= f + 1;

    // Detect Byzantine equivocation: same validator signing 2 different block_digests in same view_number
    const seenByValidatorView = new Map<string, string>();
    const equivocators = new Set<string>();
    for (const vote of params.votes) {
      const key = `${vote.validator_id}::${vote.view_number}`;
      const existingDigest = seenByValidatorView.get(key);
      if (existingDigest && existingDigest !== vote.block_digest) {
        equivocators.add(vote.validator_id);
      } else {
        seenByValidatorView.set(key, vote.block_digest);
      }
    }

    return {
      total_validators_n: n,
      max_faulty_f: f,
      required_quorum_size: requiredQuorum,
      intersection_nodes: intersection,
      honest_intersection_guaranteed: honestGuaranteed,
      equivocating_validators: [...equivocators],
      quorum_certificate_sha256: sha256Hex(
        JSON.stringify({ n, f, intersection, equivocators: [...equivocators] })
      )
    };
  }
}
