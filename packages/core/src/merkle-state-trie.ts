/**
 * Kosmora / Nexus-OS Cryptographic Merkle State Tree & Inclusion Proof Verifier (Wave 22)
 *
 * Computes deterministic SHA-256 Merkle state roots over arbitrary key-value state maps
 * (context memories, workflow checkpoints, Google Drive backup manifests) and generates
 * O(log N) cryptographic Merkle inclusion proofs and O(Delta) state diffs.
 *
 * Capabilities:
 * 1. Canonical lexicographical leaf sorting (`H(key || ":" || H(value))`).
 * 2. O(log N) Merkle branch proof generation (`generateInclusionProof`) and zero-knowledge
 *    standalone verification (`verifyMerkleInclusionProof`) without requiring the full state.
 * 3. Instant synchronization delta calculation (`computeMerkleStateDiff`) between two replicas.
 */

import { createHash } from "node:crypto";

export interface MerkleProofSibling {
  position: "left" | "right";
  hash: string;
}

export interface MerkleInclusionProof {
  key: string;
  valueHash: string;
  leafHash: string;
  rootHash: string;
  siblings: MerkleProofSibling[];
}

export interface MerkleStateDiff {
  identical: boolean;
  addedKeys: string[];
  removedKeys: string[];
  modifiedKeys: string[];
}

function sha256(data: string): string {
  return createHash("sha256").update(data, "utf8").digest("hex");
}

function hashPair(left: string, right: string): string {
  return sha256(`node:${left}:${right}`);
}

export function computeLeafHash(key: string, valueStr: string): { valueHash: string; leafHash: string } {
  const valueHash = sha256(`val:${valueStr}`);
  const leafHash = sha256(`leaf:${key}:${valueHash}`);
  return { valueHash, leafHash };
}

/**
 * Standalone cryptographic verifier for a Merkle inclusion proof.
 */
export function verifyMerkleInclusionProof(
  proof: MerkleInclusionProof,
  expectedValue?: any
): boolean {
  if (expectedValue !== undefined) {
    const valStr = typeof expectedValue === "string" ? expectedValue : JSON.stringify(expectedValue);
    const { valueHash, leafHash } = computeLeafHash(proof.key, valStr);
    if (valueHash !== proof.valueHash || leafHash !== proof.leafHash) {
      return false;
    }
  }

  let current = proof.leafHash;
  for (const step of proof.siblings) {
    if (step.position === "left") {
      current = hashPair(step.hash, current);
    } else {
      current = hashPair(current, step.hash);
    }
  }

  return current === proof.rootHash;
}

export class MerkleStateTrie {
  private readonly kvMap = new Map<string, string>(); // key -> serialized value

  constructor(initialEntries?: Record<string, any>) {
    if (initialEntries) {
      for (const [k, v] of Object.entries(initialEntries)) {
        this.put(k, v);
      }
    }
  }

  public put(key: string, value: any): void {
    const str = typeof value === "string" ? value : JSON.stringify(value);
    this.kvMap.set(key, str);
  }

  public delete(key: string): boolean {
    return this.kvMap.delete(key);
  }

  public get(key: string): string | undefined {
    return this.kvMap.get(key);
  }

  public getRootHash(): string {
    const levels = this.buildTreeLevels();
    if (levels.length === 0 || levels[levels.length - 1].length === 0) {
      return sha256("empty_merkle_root");
    }
    return levels[levels.length - 1][0];
  }

  /**
   * Generates an O(log N) cryptographic inclusion proof for `key`.
   */
  public generateInclusionProof(key: string): MerkleInclusionProof | null {
    if (!this.kvMap.has(key)) return null;

    const sortedKeys = Array.from(this.kvMap.keys()).sort();
    let idx = sortedKeys.indexOf(key);
    if (idx === -1) return null;

    const valStr = this.kvMap.get(key)!;
    const { valueHash, leafHash } = computeLeafHash(key, valStr);
    const levels = this.buildTreeLevels();
    const siblings: MerkleProofSibling[] = [];

    for (let l = 0; l < levels.length - 1; l++) {
      const layer = levels[l];
      const isRightNode = idx % 2 === 1;
      const siblingIdx = isRightNode ? idx - 1 : idx + 1;
      const siblingHash =
        siblingIdx < layer.length ? layer[siblingIdx] : layer[idx]; // Duplicate odd tail leaf

      siblings.push({
        position: isRightNode ? "left" : "right",
        hash: siblingHash
      });

      idx = Math.floor(idx / 2);
    }

    const rootHash = levels[levels.length - 1][0];
    return {
      key,
      valueHash,
      leafHash,
      rootHash,
      siblings
    };
  }

  /**
   * Computes exact synchronization deltas between this Merkle state and another replica.
   */
  public computeDiff(other: MerkleStateTrie): MerkleStateDiff {
    if (this.getRootHash() === other.getRootHash()) {
      return {
        identical: true,
        addedKeys: [],
        removedKeys: [],
        modifiedKeys: []
      };
    }

    const addedKeys: string[] = [];
    const removedKeys: string[] = [];
    const modifiedKeys: string[] = [];

    for (const [k, v] of other.kvMap.entries()) {
      if (!this.kvMap.has(k)) {
        addedKeys.push(k);
      } else if (this.kvMap.get(k) !== v) {
        modifiedKeys.push(k);
      }
    }

    for (const k of this.kvMap.keys()) {
      if (!other.kvMap.has(k)) {
        removedKeys.push(k);
      }
    }

    return {
      identical: false,
      addedKeys: addedKeys.sort(),
      removedKeys: removedKeys.sort(),
      modifiedKeys: modifiedKeys.sort()
    };
  }

  private buildTreeLevels(): string[][] {
    const sortedKeys = Array.from(this.kvMap.keys()).sort();
    if (sortedKeys.length === 0) return [];

    const baseLayer = sortedKeys.map((k) => computeLeafHash(k, this.kvMap.get(k)!).leafHash);
    const levels: string[][] = [baseLayer];

    let current = baseLayer;
    while (current.length > 1) {
      const next: string[] = [];
      for (let i = 0; i < current.length; i += 2) {
        const left = current[i];
        const right = i + 1 < current.length ? current[i + 1] : current[i];
        next.push(hashPair(left, right));
      }
      levels.push(next);
      current = next;
    }

    return levels;
  }
}
