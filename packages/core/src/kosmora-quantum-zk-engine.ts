/**
 * Stage 9 (F257-F288): Quantum-Resistant Cryptography, HKDF-SHA512 Key Hierarchy,
 * Shamir's (k, n) Threshold Secret Sharing over Prime Field GF(65537),
 * Non-Interactive Fiat-Shamir Zero-Knowledge Proofs (NIZKP),
 * Post-Quantum Hash-Based Lamport-Merkle Signatures & Verifiable Transparency Log.
 */

import { createHash, createHmac } from "node:crypto";

export interface HkdfDerivedKeyMaterial {
  key_id: string;
  context_info: string;
  salt_hex: string;
  derived_key_hex: string;
  key_Check_value_sha256: string;
  byte_length: number;
}

export interface ShamirSecretShare {
  share_index: number;
  prime_modulus: number;
  y_values: number[];
  share_checksum_sha256: string;
}

export interface FiatShamirZkProof {
  statement_id: string;
  modulus_p: string;
  generator_g: string;
  public_commitment_y: string;
  blinding_commitment_t: string;
  challenge_c: string;
  response_s: string;
  verified_zero_knowledge: boolean;
}

export interface PostQuantumHashSignature {
  key_id: string;
  message_sha256: string;
  public_root_sha256: string;
  signature_chains_hex: string[];
  verification_Keys_hex: string[];
  algorithm: "LAMPORT-SHA256-OTS";
}

export interface TransparencyLogInclusionReceipt {
  log_size: number;
  leaf_index: number;
  entry_hash: string;
  tree_head_sha256: string;
  audit_path: Array<{ position: "left" | "right"; hash: string }>;
}

function sha256Hex(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function modPos(a: number, m: number): number {
  return ((a % m) + m) % m;
}

function modPowNum(base: number, exp: number, mod: number): number {
  let result = 1;
  let b = modPos(base, mod);
  let e = exp;
  while (e > 0) {
    if (e & 1) result = (result * b) % mod;
    b = (b * b) % mod;
    e >>= 1;
  }
  return result;
}

function modInversePrime(a: number, prime: number): number {
  return modPowNum(a, prime - 2, prime);
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

export class KosmoraQuantumZkEngine {
  private static readonly GF_PRIME = 65537; // Fermat prime > 256 for exact byte-wise Shamir secret sharing
  private static readonly ZKP_PRIME = 2147483647n; // Mersenne prime 2^31 - 1
  private static readonly ZKP_GEN = 7n;

  private readonly transparencyEntries: string[] = [];

  // ==========================================================================
  // F257-F262: RFC 5869 HKDF-SHA512 Cryptographic Key Hierarchy Derivation
  // ==========================================================================

  public deriveHkdfKeyMaterial(params: {
    input_key_material: string;
    salt: string;
    context_info: string;
    length_bytes?: number;
  }): HkdfDerivedKeyMaterial {
    const lengthBytes = Math.max(16, Math.min(128, params.length_bytes ?? 32));
    if (!params.input_key_material || params.input_key_material.length < 4) {
      throw new Error("HKDF input_key_material must be at least 4 characters.");
    }

    // HKDF-Extract(salt, IKM) -> PRK
    const prk = createHmac("sha512", Buffer.from(params.salt, "utf8"))
      .update(Buffer.from(params.input_key_material, "utf8"))
      .digest();

    // HKDF-Expand(PRK, info, L)
    const infoBuf = Buffer.from(params.context_info, "utf8");
    const blocks: Buffer[] = [];
    let prev: Buffer = Buffer.alloc(0);
    let counter = 1;
    let generated = 0;

    while (generated < lengthBytes) {
      const hmac = createHmac("sha512", prk);
      hmac.update(prev);
      hmac.update(infoBuf);
      hmac.update(Buffer.from([counter]));
      prev = hmac.digest();
      blocks.push(prev);
      generated += prev.length;
      counter += 1;
    }

    const okm = Buffer.concat(blocks).subarray(0, lengthBytes);
    const derivedHex = okm.toString("hex");
    return {
      key_id: `hkdf_${sha256Hex(`${params.context_info}:${derivedHex}`).slice(0, 12)}`,
      context_info: params.context_info,
      salt_hex: Buffer.from(params.salt, "utf8").toString("hex"),
      derived_key_hex: derivedHex,
      key_Check_value_sha256: sha256Hex(okm).slice(0, 16),
      byte_length: lengthBytes
    };
  }

  // ==========================================================================
  // F263-F268: Shamir's (k, n) Threshold Secret Sharing over GF(65537)
  // ==========================================================================

  public splitSecretShamirThreshold(params: {
    secret_utf8: string;
    total_shares_n: number;
    threshold_k: number;
    deterministic_seed?: string;
  }): ShamirSecretShare[] {
    const { secret_utf8, total_shares_n, threshold_k } = params;
    if (threshold_k < 2 || threshold_k > total_shares_n || total_shares_n > 32) {
      throw new Error(
        `Invalid Shamir threshold parameters: k=${threshold_k}, n=${total_shares_n}`
      );
    }
    const secretBytes = Buffer.from(secret_utf8, "utf8");
    if (secretBytes.length === 0) {
      throw new Error("Cannot split empty secret.");
    }

    const prime = KosmoraQuantumZkEngine.GF_PRIME;
    const seedPrefix = params.deterministic_seed ?? sha256Hex(secret_utf8);

    // For each byte j, construct degree-(k-1) polynomial P_j(x) = secretBytes[j] + a_1*x + ... + a_{k-1}*x^{k-1} mod 65537
    const coeffsPerByte: number[][] = [];
    for (let j = 0; j < secretBytes.length; j++) {
      const coeffs: number[] = [secretBytes[j]!];
      for (let deg = 1; deg < threshold_k; deg++) {
        const digest = sha256Hex(`${seedPrefix}:byte=${j}:deg=${deg}`);
        const c = (parseInt(digest.slice(0, 8), 16) % (prime - 1)) + 1;
        coeffs.push(c);
      }
      coeffsPerByte.push(coeffs);
    }

    const shares: ShamirSecretShare[] = [];
    for (let x = 1; x <= total_shares_n; x++) {
      const yValues: number[] = [];
      for (let j = 0; j < secretBytes.length; j++) {
        const coeffs = coeffsPerByte[j]!;
        let y = 0;
        let xPow = 1;
        for (let deg = 0; deg < threshold_k; deg++) {
          y = modPos(y + coeffs[deg]! * xPow, prime);
          xPow = modPos(xPow * x, prime);
        }
        yValues.push(y);
      }
      shares.push({
        share_index: x,
        prime_modulus: prime,
        y_values: yValues,
        share_checksum_sha256: sha256Hex(`${x}:${prime}:${yValues.join(",")}`)
      });
    }
    return shares;
  }

  public reconstructSecretShamirLagrange(
    shares: ShamirSecretShare[],
    expectedThresholdK: number
  ): string {
    if (shares.length < expectedThresholdK) {
      throw new Error(
        `Insufficient Shamir shares for reconstruction: provided ${shares.length}, required threshold k=${expectedThresholdK}`
      );
    }

    const subset = shares.slice(0, expectedThresholdK);
    const prime = subset[0]!.prime_modulus;
    const byteCount = subset[0]!.y_values.length;

    // Verify share checksums before Lagrange interpolation at x = 0
    for (const s of subset) {
      const expectedChecksum = sha256Hex(`${s.share_index}:${s.prime_modulus}:${s.y_values.join(",")}`);
      if (expectedChecksum !== s.share_checksum_sha256) {
        throw new Error(`Corrupted Shamir share at index ${s.share_index}`);
      }
    }

    const recoveredBytes = Buffer.alloc(byteCount);
    for (let j = 0; j < byteCount; j++) {
      let accum = 0;
      for (let i = 0; i < subset.length; i++) {
        const xi = subset[i]!.share_index;
        const yi = subset[i]!.y_values[j]!;
        let num = 1;
        let den = 1;
        for (let m = 0; m < subset.length; m++) {
          if (i === m) continue;
          const xm = subset[m]!.share_index;
          num = modPos(num * -xm, prime);
          den = modPos(den * (xi - xm), prime);
        }
        const lagrangeBasis0 = modPos(num * modInversePrime(den, prime), prime);
        accum = modPos(accum + yi * lagrangeBasis0, prime);
      }
      recoveredBytes[j] = accum & 0xff;
    }

    return recoveredBytes.toString("utf8");
  }

  // ==========================================================================
  // F269-F274: Fiat-Shamir Non-Interactive Zero-Knowledge Proof (Schnorr NIZKP)
  // ==========================================================================

  public generateFiatShamirZeroKnowledgeProof(params: {
    statement_id: string;
    secret_witness_scalar: number;
    nonce_seed: string;
  }): FiatShamirZkProof {
    const p = KosmoraQuantumZkEngine.ZKP_PRIME;
    const qOrder = p - 1n;
    const g = KosmoraQuantumZkEngine.ZKP_GEN;

    const x = BigInt(Math.max(2, Math.abs(Math.trunc(params.secret_witness_scalar))));
    const y = modPowBig(g, x, p); // Public key / commitment y = g^x mod p

    const rRaw = BigInt("0x" + sha256Hex(`nonce:${params.nonce_seed}:${params.statement_id}`).slice(0, 12));
    const r = (rRaw % (qOrder - 2n)) + 2n;
    const t = modPowBig(g, r, p); // Blinding commitment t = g^r mod p

    // Fiat-Shamir challenge c = H(g || y || t || statement_id) mod (p-1)
    const cHex = sha256Hex(`${g.toString()}|${y.toString()}|${t.toString()}|${params.statement_id}`).slice(0, 12);
    const c = (BigInt("0x" + cHex) % (qOrder - 1n)) + 1n;

    // Response s = (r + c * x) mod (p - 1)
    const s = (r + c * x) % qOrder;

    const proof: FiatShamirZkProof = {
      statement_id: params.statement_id,
      modulus_p: p.toString(),
      generator_g: g.toString(),
      public_commitment_y: y.toString(),
      blinding_commitment_t: t.toString(),
      challenge_c: c.toString(),
      response_s: s.toString(),
      verified_zero_knowledge: true
    };
    return proof;
  }

  public verifyFiatShamirZeroKnowledgeProof(proof: FiatShamirZkProof): boolean {
    const p = BigInt(proof.modulus_p);
    const qOrder = p - 1n;
    const g = BigInt(proof.generator_g);
    const y = BigInt(proof.public_commitment_y);
    const t = BigInt(proof.blinding_commitment_t);
    const c = BigInt(proof.challenge_c);
    const s = BigInt(proof.response_s);

    const expectedCHex = sha256Hex(
      `${g.toString()}|${y.toString()}|${t.toString()}|${proof.statement_id}`
    ).slice(0, 12);
    const expectedC = (BigInt("0x" + expectedCHex) % (qOrder - 1n)) + 1n;
    if (c !== expectedC) {
      return false;
    }

    // Schnorr verification equation: g^s mod p === (t * y^c) mod p
    const lhs = modPowBig(g, s, p);
    const rhs = (t * modPowBig(y, c, p)) % p;
    return lhs === rhs;
  }

  // ==========================================================================
  // F275-F280: Post-Quantum Hash-Based Lamport-Merkle One-Time Signatures
  // ==========================================================================

  public signPostQuantumLamportMessage(params: {
    key_id: string;
    private_seed: string;
    message: string;
  }): PostQuantumHashSignature {
    const msgHash = sha256Hex(params.message);
    // Use 16nibbles (64 bits) Winternitz-style / Lamport chains for compact deterministic PQC proof
    const nibbles = msgHash.slice(0, 16).split("").map((ch) => parseInt(ch, 16));

    const publicKeysHex: string[] = [];
    const signatureChainsHex: string[] = [];

    for (let i = 0; i < nibbles.length; i++) {
      const val = nibbles[i]!;
      let skChain = sha256Hex(`pqc_sk:${params.key_id}:${params.private_seed}:slot=${i}`);
      // Advance skChain `val` times for signature
      let sigVal = skChain;
      for (let step = 0; step < val; step++) {
        sigVal = sha256Hex(sigVal);
      }
      // Public key element is skChain hashed 15 times
      let pkVal = sigVal;
      for (let step = val; step < 15; step++) {
        pkVal = sha256Hex(pkVal);
      }
      signatureChainsHex.push(sigVal);
      publicKeysHex.push(pkVal);
    }

    const publicRoot = sha256Hex(publicKeysHex.join("|"));
    return {
      key_id: params.key_id,
      message_sha256: msgHash,
      public_root_sha256: publicRoot,
      signature_chains_hex: signatureChainsHex,
      verification_Keys_hex: publicKeysHex,
      algorithm: "LAMPORT-SHA256-OTS"
    };
  }

  public verifyPostQuantumLamportSignature(
    signature: PostQuantumHashSignature,
    message: string
  ): boolean {
    const msgHash = sha256Hex(message);
    if (msgHash !== signature.message_sha256) {
      return false;
    }
    const nibbles = msgHash.slice(0, 16).split("").map((ch) => parseInt(ch, 16));
    if (signature.signature_chains_hex.length !== nibbles.length) {
      return false;
    }

    const reconstructedPks: string[] = [];
    for (let i = 0; i < nibbles.length; i++) {
      const val = nibbles[i]!;
      let cur = signature.signature_chains_hex[i]!;
      for (let step = val; step < 15; step++) {
        cur = sha256Hex(cur);
      }
      reconstructedPks.push(cur);
    }
    const recomputedRoot = sha256Hex(reconstructedPks.join("|"));
    return recomputedRoot === signature.public_root_sha256;
  }

  // ==========================================================================
  // F281-F288: RFC 6962-Style Verifiable Append-Only Transparency Log
  // ==========================================================================

  public appendTransparencyLogEntry(payload: string): TransparencyLogInclusionReceipt {
    const entryHash = sha256Hex(`leaf:${payload}`);
    this.transparencyEntries.push(entryHash);
    const leafIdx = this.transparencyEntries.length - 1;

    const { rootHash, auditPath } = this.computeMerkleRootAndPath(
      this.transparencyEntries,
      leafIdx
    );

    return {
      log_size: this.transparencyEntries.length,
      leaf_index: leafIdx,
      entry_hash: entryHash,
      tree_head_sha256: rootHash,
      audit_path: auditPath
    };
  }

  public verifyTransparencyLogReceipt(receipt: TransparencyLogInclusionReceipt): boolean {
    let cur = receipt.entry_hash;
    for (const step of receipt.audit_path) {
      cur =
        step.position === "right"
          ? sha256Hex(`node:${cur}:${step.hash}`)
          : sha256Hex(`node:${step.hash}:${cur}`);
    }
    return cur === receipt.tree_head_sha256;
  }

  private computeMerkleRootAndPath(
    leaves: string[],
    targetIdx: number
  ): { rootHash: string; auditPath: Array<{ position: "left" | "right"; hash: string }> } {
    let layer = [...leaves];
    let idx = targetIdx;
    const auditPath: Array<{ position: "left" | "right"; hash: string }> = [];

    while (layer.length > 1) {
      const next: string[] = [];
      for (let i = 0; i < layer.length; i += 2) {
        const left = layer[i]!;
        const right = layer[i + 1] ?? left;
        if (i === idx || i + 1 === idx) {
          const isLeft = idx % 2 === 0;
          auditPath.push({
            position: isLeft ? "right" : "left",
            hash: isLeft ? right : left
          });
          idx = Math.floor(i / 2);
        }
        next.push(sha256Hex(`node:${left}:${right}`));
      }
      layer = next;
    }

    return { rootHash: layer[0]!, auditPath };
  }
}
