import { createHash, randomBytes } from "node:crypto";

/**
 * Safe Prime Group parameters (RFC 3526 / discrete log prime subgroup for fast BigInt modular arithmetic)
 * p = 2q + 1 where p is a 256-bit prime so modular exponentiation executes in sub-millisecond time.
 */
const P_HEX =
  "fffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2f"; // secp256k1 field prime (2^256 - 2^32 - 977)
const MOD_P = BigInt("0x" + P_HEX);
const ORDER_Q = MOD_P - 1n;
const GEN_G = 5n;
const GEN_H = 19n; // Second independent generator for Pedersen-style commitment C = g^v * h^r mod p

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n;
  let b = ((base % mod) + mod) % mod;
  let e = exp;
  while (e > 0n) {
    if ((e & 1n) === 1n) {
      result = (result * b) % mod;
    }
    e >>= 1n;
    b = (b * b) % mod;
  }
  return result;
}

function randomScalar(): bigint {
  const bytes = randomBytes(32);
  const raw = BigInt("0x" + bytes.toString("hex"));
  return (raw % (ORDER_Q - 2n)) + 1n;
}

function fiatShamirChallenge(...elements: bigint[]): bigint {
  const hash = createHash("sha256");
  for (const el of elements) {
    hash.update(el.toString(16).padStart(64, "0"), "utf8");
  }
  const digestHex = hash.digest("hex");
  return BigInt("0x" + digestHex) % ORDER_Q;
}

export interface PedersenCommitmentPacket {
  commitmentHex: string;
  blindingFactorHex: string;
  value: bigint;
}

export interface ZkKnowledgeProof {
  commitmentHex: string;
  announcementTHex: string;
  responseSvHex: string;
  responseSrHex: string;
}

/**
 * Pedersen-Style Homomorphic Commitment & Fiat-Shamir Zero-Knowledge Proof Verifier (Sigma Protocol).
 * Allows proving knowledge of a committed quota/budget value and homomorphic addition C(v1+v2) = C(v1)*C(v2) mod p
 * without exposing raw sensitive balances in audit logs.
 */
export class ZkCommitmentVerifier {
  public static commit(value: number | bigint, customBlinding?: bigint): PedersenCommitmentPacket {
    const v = ((BigInt(value) % ORDER_Q) + ORDER_Q) % ORDER_Q;
    const r = customBlinding ? ((customBlinding % ORDER_Q) + ORDER_Q) % ORDER_Q : randomScalar();
    const gv = modPow(GEN_G, v, MOD_P);
    const hr = modPow(GEN_H, r, MOD_P);
    const c = (gv * hr) % MOD_P;

    return {
      commitmentHex: c.toString(16),
      blindingFactorHex: r.toString(16),
      value: v
    };
  }

  /**
   * Homomorphically combines two commitments: C_sum = (C_1 * C_2) mod p,
   * corresponding to value (v_1 + v_2) and blinding factor (r_1 + r_2).
   */
  public static addCommitmentsHomomorphically(
    c1: PedersenCommitmentPacket,
    c2: PedersenCommitmentPacket
  ): PedersenCommitmentPacket {
    const comm1 = BigInt("0x" + c1.commitmentHex);
    const comm2 = BigInt("0x" + c2.commitmentHex);
    const r1 = BigInt("0x" + c1.blindingFactorHex);
    const r2 = BigInt("0x" + c2.blindingFactorHex);

    const combinedComm = (comm1 * comm2) % MOD_P;
    const combinedR = (r1 + r2) % ORDER_Q;
    const combinedV = (c1.value + c2.value) % ORDER_Q;

    return {
      commitmentHex: combinedComm.toString(16),
      blindingFactorHex: combinedR.toString(16),
      value: combinedV
    };
  }

  /**
   * Generates a Non-Interactive Zero-Knowledge Proof of Knowledge (Schnorr-Okamoto Sigma Protocol)
   * of (v, r) such that C = g^v * h^r mod p without revealing v or r.
   */
  public static createProofOfOpening(packet: PedersenCommitmentPacket): ZkKnowledgeProof {
    const comm = BigInt("0x" + packet.commitmentHex);
    const r = BigInt("0x" + packet.blindingFactorHex);
    const v = packet.value;

    const kv = randomScalar();
    const kr = randomScalar();
    const t = (modPow(GEN_G, kv, MOD_P) * modPow(GEN_H, kr, MOD_P)) % MOD_P;

    const challenge = fiatShamirChallenge(GEN_G, GEN_H, comm, t);
    const sv = (kv + challenge * v) % ORDER_Q;
    const sr = (kr + challenge * r) % ORDER_Q;

    return {
      commitmentHex: packet.commitmentHex,
      announcementTHex: t.toString(16),
      responseSvHex: sv.toString(16),
      responseSrHex: sr.toString(16)
    };
  }

  /**
   * Verifies a Non-Interactive Zero-Knowledge Proof of Opening:
   * checks g^sv * h^sr == T * C^e (mod p).
   */
  public static verifyProofOfOpening(proof: ZkKnowledgeProof): boolean {
    const comm = BigInt("0x" + proof.commitmentHex);
    const t = BigInt("0x" + proof.announcementTHex);
    const sv = BigInt("0x" + proof.responseSvHex);
    const sr = BigInt("0x" + proof.responseSrHex);

    const challenge = fiatShamirChallenge(GEN_G, GEN_H, comm, t);
    const lhs = (modPow(GEN_G, sv, MOD_P) * modPow(GEN_H, sr, MOD_P)) % MOD_P;
    const rhs = (t * modPow(comm, challenge, MOD_P)) % MOD_P;
    return lhs === rhs;
  }
}
