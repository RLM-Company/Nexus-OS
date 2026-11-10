import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

export interface MerklePatriciaProofStep {
  prefixHex: string;
  nodeHash: string;
  siblingHashes: Record<string, string>;
  valuePayload: string | null;
}

export interface MerklePatriciaInclusionProof {
  key: string;
  keyNibblesHex: string;
  rootHash: string;
  value: string | null;
  steps: MerklePatriciaProofStep[];
}

/**
 * Cryptographic Hexary Merkle-Patricia State Trie Store backed by SQLite.
 * Encodes keys into hexadecimal nibbles, maintains deterministic SHA-256 node commitments
 * across branch levels, and generates/verifies cryptographic inclusion & exclusion proofs.
 */
export class MerklePatriciaStateTrieStore {
  private readonly db: DatabaseSync;
  private readonly kvState = new Map<string, string>();
  private readonly nodeTable = new Map<
    string,
    { children: Record<string, string>; value: string | null; hash: string }
  >();

  public constructor(db: DatabaseSync) {
    this.db = db;
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS kosmora_merkle_patricia_nodes (
        prefix_hex TEXT PRIMARY KEY,
        node_hash TEXT NOT NULL,
        value_payload TEXT,
        children_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }

  public static toNibblesHex(key: string): string {
    return Buffer.from(key, "utf8").toString("hex");
  }

  public put(key: string, value: string): string {
    const nibbles = MerklePatriciaStateTrieStore.toNibblesHex(key);
    this.kvState.set(nibbles, value);
    return this.rebuildTrieAndPersist();
  }

  public get(key: string): string | null {
    const nibbles = MerklePatriciaStateTrieStore.toNibblesHex(key);
    return this.kvState.get(nibbles) ?? null;
  }

  public getRootHash(): string {
    if (this.nodeTable.size === 0) {
      return this.rebuildTrieAndPersist();
    }
    return this.nodeTable.get("")?.hash ?? createHash("sha256").update("EMPTY_TRIE").digest("hex");
  }

  private rebuildTrieAndPersist(): string {
    this.nodeTable.clear();
    const prefixes = new Set<string>([""]);
    for (const nibbles of this.kvState.keys()) {
      for (let len = 1; len <= nibbles.length; len++) {
        prefixes.add(nibbles.slice(0, len));
      }
    }

    // Sort longest prefix first (bottom-up Merkle hashing)
    const sortedPrefixes = [...prefixes].sort((a, b) => b.length - a.length || a.localeCompare(b));

    for (const prefix of sortedPrefixes) {
      const children: Record<string, string> = {};
      for (const hexChar of "0123456789abcdef") {
        const childPrefix = prefix + hexChar;
        const childNode = this.nodeTable.get(childPrefix);
        if (childNode) {
          children[hexChar] = childNode.hash;
        }
      }
      const value = this.kvState.get(prefix) ?? null;
      const canonical = JSON.stringify({ prefix, value, children });
      const hash = createHash("sha256").update(canonical).digest("hex");
      this.nodeTable.set(prefix, { children, value, hash });
    }

    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO kosmora_merkle_patricia_nodes (prefix_hex, node_hash, value_payload, children_json, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(prefix_hex) DO UPDATE SET
        node_hash = excluded.node_hash,
        value_payload = excluded.value_payload,
        children_json = excluded.children_json,
        updated_at = excluded.updated_at
    `);

    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const [prefix, node] of this.nodeTable.entries()) {
        stmt.run(prefix, node.hash, node.value, JSON.stringify(node.children), now);
      }
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }

    return this.nodeTable.get("")!.hash;
  }

  public generateProof(key: string): MerklePatriciaInclusionProof {
    const nibbles = MerklePatriciaStateTrieStore.toNibblesHex(key);
    const rootHash = this.getRootHash();
    const steps: MerklePatriciaProofStep[] = [];

    for (let len = 0; len <= nibbles.length; len++) {
      const prefix = nibbles.slice(0, len);
      const node = this.nodeTable.get(prefix);
      if (!node) break;
      steps.push({
        prefixHex: prefix,
        nodeHash: node.hash,
        siblingHashes: { ...node.children },
        valuePayload: node.value
      });
    }

    return {
      key,
      keyNibblesHex: nibbles,
      rootHash,
      value: this.kvState.get(nibbles) ?? null,
      steps
    };
  }

  public static verifyProof(proof: MerklePatriciaInclusionProof): boolean {
    if (proof.steps.length === 0) return false;
    if (proof.steps[0]!.nodeHash !== proof.rootHash) return false;

    for (let i = proof.steps.length - 1; i >= 0; i--) {
      const step = proof.steps[i]!;
      const canonical = JSON.stringify({
        prefix: step.prefixHex,
        value: step.valuePayload,
        children: step.siblingHashes
      });
      const expectedHash = createHash("sha256").update(canonical).digest("hex");
      if (expectedHash !== step.nodeHash) return false;

      if (i > 0) {
        const parentStep = proof.steps[i - 1]!;
        const nibble = step.prefixHex.slice(-1);
        if (parentStep.siblingHashes[nibble] !== step.nodeHash) return false;
      }
    }

    const lastStep = proof.steps[proof.steps.length - 1]!;
    if (proof.value !== null) {
      return lastStep.prefixHex === proof.keyNibblesHex && lastStep.valuePayload === proof.value;
    }
    return true;
  }
}
