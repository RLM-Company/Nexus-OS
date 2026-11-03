import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { HnswVectorIndex } from "../../../packages/db/src/hnsw-vector-index.js";
import {
  MerkleStateTrie,
  verifyMerkleInclusionProof
} from "../../../packages/core/src/merkle-state-trie.js";
import { ConstrainedGrammarEnforcer } from "../../../packages/core/src/constrained-grammar-enforcer.js";

test("HnswVectorIndex indexes 150 embeddings across multiple layers, recalls top-K neighbors, and persists to SQLite", () => {
  const index = new HnswVectorIndex({ M: 10, efConstruction: 28, efSearch: 20, seed: 2026 });

  index.insert(
    "doc-apollo-budget",
    "Project Apollo launch budget is confirmed at $250,000 for November 15, 2026.",
    { category: "finance" }
  );
  index.insert(
    "doc-drive-oauth",
    "Google Drive OAuth 2.0 PKCE authorization and AES-256-GCM grant encryption.",
    { category: "security" }
  );

  for (let i = 0; i < 148; i++) {
    index.insert(
      `doc-noise-${i}`,
      `Background operational log entry number ${i} regarding routine server telemetry and disk usage.`,
      { category: "logs" }
    );
  }

  assert.equal(index.size(), 150);
  assert.ok(index.getMaxLevel() >= 1);

  const results = index.searchKnn("Project Apollo budget allocation $250,000 November", 5);
  assert.ok(results.length > 0);
  assert.equal(results[0].id, "doc-apollo-budget");
  assert.equal(results[0].metadata?.category, "finance");

  // SQLite snapshot round-trip
  const db = new DatabaseSync(":memory:");
  index.saveToSqlite(db, "owner-hnsw-1", "main-index");

  const restoredIndex = new HnswVectorIndex();
  const loaded = restoredIndex.loadFromSqlite(db, "owner-hnsw-1", "main-index");
  assert.equal(loaded, true);
  assert.equal(restoredIndex.size(), 150);

  const restoredResults = restoredIndex.searchKnn("Google Drive OAuth PKCE encryption", 3);
  assert.equal(restoredResults[0].id, "doc-drive-oauth");
});

test("MerkleStateTrie computes deterministic roots, verifies O(log N) inclusion proofs, and detects replica diffs", () => {
  const trieA = new MerkleStateTrie({
    "mem:1": { title: "Budget", amount: 250000 },
    "mem:2": { title: "Launch", date: "2026-11-15" },
    "mem:3": { title: "Owner", name: "Alpha" },
    "mem:4": { title: "Status", state: "green" },
    "mem:5": { title: "SuiteCount", count: 21 }
  });

  const proof = trieA.generateInclusionProof("mem:2");
  assert.ok(proof);
  assert.equal(proof.rootHash, trieA.getRootHash());
  assert.equal(verifyMerkleInclusionProof(proof, { title: "Launch", date: "2026-11-15" }), true);
  // Tampered value must fail verification
  assert.equal(verifyMerkleInclusionProof(proof, { title: "Launch", date: "2099-01-01" }), false);

  // Replica diff test
  const trieB = new MerkleStateTrie({
    "mem:1": { title: "Budget", amount: 300000 }, // modified
    "mem:2": { title: "Launch", date: "2026-11-15" },
    "mem:4": { title: "Status", state: "green" },
    "mem:5": { title: "SuiteCount", count: 21 },
    "mem:6": { title: "NewEntry", active: true } // added ("mem:3" removed)
  });

  const diff = trieA.computeDiff(trieB);
  assert.equal(diff.identical, false);
  assert.deepEqual(diff.addedKeys, ["mem:6"]);
  assert.deepEqual(diff.removedKeys, ["mem:3"]);
  assert.deepEqual(diff.modifiedKeys, ["mem:1"]);
});

test("ConstrainedGrammarEnforcer repairs truncated/markdown-fenced JSON streams and enforces schema constraints", () => {
  const enforcer = new ConstrainedGrammarEnforcer();

  // Noisy truncated LLM output with markdown fence, unquoted keys, string number, and unclosed brace
  const noisyStream =
    "Here is the structured tool payload:\n```json\n{ toolName: \"vault_read\", budgetUsd: \"$250,000\", priority: \"high\", tags: [\"apollo\", \"q4\"";

  const schema = {
    properties: {
      toolName: { type: "string" as const, required: true, enum: ["vault_read", "drive_restore"] },
      budgetUsd: { type: "number" as const, required: true, min: 1000, max: 1000000 },
      priority: { type: "string" as const, required: true, enum: ["low", "medium", "high"] },
      tags: { type: "array" as const, required: true },
      retries: { type: "number" as const, default: 3 }
    }
  };

  const result = enforcer.enforceSchema(noisyStream, schema);
  assert.equal(result.valid, true);
  assert.deepEqual(result.value, {
    toolName: "vault_read",
    budgetUsd: 250000,
    priority: "high",
    tags: ["apollo", "q4"],
    retries: 3
  });
  assert.ok(result.repairsApplied.includes("quoted_unquoted_keys"));
  assert.ok(result.repairsApplied.includes("closed_truncated_brackets"));
  assert.ok(result.repairsApplied.includes("coerced_number:budgetUsd"));
});
