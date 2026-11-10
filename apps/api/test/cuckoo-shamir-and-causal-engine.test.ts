import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  PartitionedBloomFilter,
  CuckooFilterIndex
} from "../../../packages/db/src/cuckoo-and-bloom-filter-index.js";
import { ShamirSecretSharingEscrow } from "../../../packages/core/src/shamir-secret-sharing-escrow.js";
import { CausalCounterfactualEngine } from "../../../packages/core/src/causal-counterfactual-attribution.js";

test("PartitionedBloomFilter and CuckooFilterIndex support fast lookups, O(1) deletion without false negatives, and SQLite persistence", () => {
  const bloom = new PartitionedBloomFilter({ expectedItems: 500, falsePositiveRate: 0.01 });
  for (let i = 0; i < 200; i++) {
    bloom.add(`vault_chunk_sha256_${i}`);
  }
  for (let i = 0; i < 200; i++) {
    assert.equal(bloom.mightContain(`vault_chunk_sha256_${i}`), true);
  }
  assert.ok(bloom.estimateFalsePositiveRate() < 0.02);

  const bloomRoundTrip = PartitionedBloomFilter.deserialize(bloom.serialize());
  assert.equal(bloomRoundTrip.mightContain("vault_chunk_sha256_42"), true);
  assert.equal(bloomRoundTrip.mightContain("non_existent_key_999999"), false);

  // Cuckoo Filter with O(1) deletion and SQLite snapshot persistence
  const sqlite = new DatabaseSync(":memory:");
  const cuckoo = new CuckooFilterIndex({ capacity: 512 });

  for (let i = 0; i < 250; i++) {
    assert.equal(cuckoo.insert(`doc_id_${i}`), true);
  }
  assert.equal(cuckoo.count, 250);
  assert.equal(cuckoo.lookup("doc_id_123"), true);

  // Delete doc_id_123 and verify it is removed while neighbors remain intact
  assert.equal(cuckoo.delete("doc_id_123"), true);
  assert.equal(cuckoo.lookup("doc_id_123"), false);
  assert.equal(cuckoo.lookup("doc_id_124"), true);
  assert.equal(cuckoo.count, 249);

  cuckoo.saveToSqlite(sqlite, "owner_cuckoo_1", "vault_filter");
  const loaded = CuckooFilterIndex.loadFromSqlite(sqlite, "owner_cuckoo_1", "vault_filter");
  assert.ok(loaded);
  assert.equal(loaded.lookup("doc_id_124"), true);
  assert.equal(loaded.lookup("doc_id_123"), false);
  sqlite.close();
});

test("ShamirSecretSharingEscrow splits and reconstructs master keys over GF(256) and refreshes shares proactively", () => {
  const masterSecret = "KOSMORA-VAULT-MASTER-KEY-2026-AES256-GCM-99887766554433221100";
  const shares = ShamirSecretSharingEscrow.splitSecret(masterSecret, 3, 5);
  assert.equal(shares.length, 5);

  // Any 3 shares (e.g. #1, #3, #5) reconstruct the exact secret
  const subsetA = [shares[0]!, shares[2]!, shares[4]!];
  const recoveredA = ShamirSecretSharingEscrow.reconstructSecret(subsetA).toString("utf8");
  assert.equal(recoveredA, masterSecret);

  // Another 3-share subset (#2, #3, #4) also reconstructs the exact secret
  const subsetB = [shares[1]!, shares[2]!, shares[3]!];
  const recoveredB = ShamirSecretSharingEscrow.reconstructSecret(subsetB).toString("utf8");
  assert.equal(recoveredB, masterSecret);

  // Fewer than k=3 shares throws INSUFFICIENT_SHARES
  assert.throws(() => {
    ShamirSecretSharingEscrow.reconstructSecret([shares[0]!, shares[1]!]);
  }, /INSUFFICIENT_SHARES/);

  // Proactive Share Refresh: rotates all 5 shares without reconstructing the secret
  const refreshedShares = ShamirSecretSharingEscrow.refreshSharesWithoutReconstructing(shares);
  assert.notEqual(refreshedShares[0]!.payloadBase64, shares[0]!.payloadBase64);

  // 3 refreshed shares still reconstruct the exact original master secret!
  const recoveredFromRefreshed = ShamirSecretSharingEscrow.reconstructSecret([
    refreshedShares[1]!,
    refreshedShares[3]!,
    refreshedShares[4]!
  ]).toString("utf8");
  assert.equal(recoveredFromRefreshed, masterSecret);

  // Mixing 2 old shares with 1 refreshed share fails to reconstruct the original secret (forward security)
  const mixedAttempt = ShamirSecretSharingEscrow.reconstructSecret([
    shares[0]!,
    shares[1]!,
    refreshedShares[2]!
  ]).toString("utf8");
  assert.notEqual(mixedAttempt, masterSecret);
});

test("CausalCounterfactualEngine evaluates Pearl do(X=x) interventions and attributes root-cause latency anomalies", () => {
  // Structural Causal DAG:
  // retrieval_ms (baseline 40) -> prompt_assembly_ms (baseline 10 + 1.0 * retrieval) -> llm_decode_ms (baseline 200 + 1.5 * prompt_assembly) -> total_e2e_ms (baseline 5 + 1.0 * llm_decode)
  const scm = new CausalCounterfactualEngine([
    { id: "retrieval_ms", parents: [], baselineExogenous: 40 },
    {
      id: "prompt_assembly_ms",
      parents: ["retrieval_ms"],
      baselineExogenous: 10,
      weights: { retrieval_ms: 1.0 }
    },
    {
      id: "llm_decode_ms",
      parents: ["prompt_assembly_ms"],
      baselineExogenous: 200,
      weights: { prompt_assembly_ms: 1.5 }
    },
    {
      id: "total_e2e_ms",
      parents: ["llm_decode_ms"],
      baselineExogenous: 5,
      weights: { llm_decode_ms: 1.0 }
    }
  ]);

  const base = scm.evaluateForward();
  // retrieval=40, prompt=50, llm_decode=200 + 75 = 275, total_e2e=280
  assert.equal(base.total_e2e_ms, 280);

  // Pearl do(prompt_assembly_ms = 20) severs dependency on retrieval_ms
  const intervened = scm.evaluateForward({
    doInterventions: { prompt_assembly_ms: 20 },
    exogenousOverrides: { retrieval_ms: 900 } // ignored because prompt_assembly_ms is intervened!
  });
  assert.equal(intervened.prompt_assembly_ms, 20);
  assert.equal(intervened.llm_decode_ms, 230);
  assert.equal(intervened.total_e2e_ms, 235);

  // Counterfactual Root-Cause Attribution:
  // Suppose retrieval_ms spiked by +200ms (from 40 to 240), driving prompt_assembly to 250, llm_decode to 575, total_e2e to 580
  const report = scm.attributeOutcomeAnomaly("total_e2e_ms", {
    retrieval_ms: 240,
    prompt_assembly_ms: 250,
    llm_decode_ms: 575,
    total_e2e_ms: 580
  });

  assert.equal(report.primaryRootCauseNodeId, "retrieval_ms");
  assert.equal(report.totalOutcomeDeviation, 300);
  assert.equal(report.attributions[0]?.nodeId, "retrieval_ms");
  assert.equal(report.attributions[0]?.totalCausalEffectOnOutcome, 300);
  assert.equal(report.attributions[0]?.normalizedResponsibilityShare, 1);
});
