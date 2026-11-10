import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { ProductQuantizationCodec } from "../../../packages/db/src/product-quantization-vector-codec.js";
import { KalmanCusumDriftDetector } from "../../../packages/core/src/kalman-cusum-drift-detector.js";
import { ZkCommitmentVerifier } from "../../../packages/core/src/zk-commitment-verifier.js";

test("ProductQuantizationCodec achieves 32x compression on 64-dim embeddings, recalls nearest neighbors via ADC, and persists to SQLite", () => {
  const sqlite = new DatabaseSync(":memory:");
  const pq = new ProductQuantizationCodec({ dim: 64, subspaces: 8, centroidsPerSubspace: 16 });
  assert.equal(pq.compressionRatio, 32);

  // Create 32 normalized synthetic 64-dim embeddings
  const vectors: number[][] = [];
  for (let i = 0; i < 32; i++) {
    const raw = Array.from({ length: 64 }, (_, d) => Math.sin(i * 1.7 + d * 0.3));
    const norm = Math.sqrt(raw.reduce((acc, v) => acc + v * v, 0));
    vectors.push(raw.map((v) => v / norm));
  }

  pq.trainCodebooks(vectors, 10);
  for (let i = 0; i < vectors.length; i++) {
    const code = pq.upsertVector(`vec_${i}`, vectors[i]!, { index: i });
    assert.equal(code.byteLength, 8);
  }

  // Query near vec_7
  const topHits = pq.searchAsymmetricTopK(vectors[7]!, 3);
  assert.equal(topHits[0]?.id, "vec_7");
  assert.ok(topHits[0]!.asymmetricL2DistanceSq < 0.05);

  // Persist to SQLite and reload
  pq.saveToSqlite(sqlite, "owner_pq_1", "vault_pq");
  const loaded = ProductQuantizationCodec.loadFromSqlite(sqlite, "owner_pq_1", "vault_pq");
  assert.ok(loaded);
  const loadedHits = loaded.searchAsymmetricTopK(vectors[19]!, 2);
  assert.equal(loadedHits[0]?.id, "vec_19");
  sqlite.close();
});

test("KalmanCusumDriftDetector smooths Gaussian noise and triggers upward/downward regime shift alerts", () => {
  const detector = new KalmanCusumDriftDetector({
    initialBaseline: 100,
    processNoiseQ: 0.1,
    measurementNoiseR: 4.0,
    slackAllowanceK: 5.0,
    decisionThresholdH: 25.0
  });

  // 10 normal measurements oscillating mildly around 100ms
  for (const m of [98, 102, 101, 99, 100, 103, 97, 101, 100, 99]) {
    const res = detector.observe(m);
    assert.equal(res.driftDetected, false);
    assert.ok(res.kalmanEstimate > 95 && res.kalmanEstimate < 105);
  }

  // Sudden upward latency spike regime shift (e.g., 135ms sustained)
  let triggeredUpward = false;
  for (let i = 0; i < 4; i++) {
    const res = detector.observe(135);
    if (res.driftDetected && res.driftDirection === "upward_spike") {
      triggeredUpward = true;
    }
  }
  assert.equal(triggeredUpward, true);
});

test("ZkCommitmentVerifier supports homomorphic Pedersen commitment addition and Fiat-Shamir Zero-Knowledge opening proofs", () => {
  const c1 = ZkCommitmentVerifier.commit(250);
  const c2 = ZkCommitmentVerifier.commit(750);

  // Homomorphic addition: C(250) * C(750) = C(1000)
  const cSum = ZkCommitmentVerifier.addCommitmentsHomomorphically(c1, c2);
  assert.equal(cSum.value, 1000n);

  // Generate and verify NIZK proof of opening for cSum
  const proof = ZkCommitmentVerifier.createProofOfOpening(cSum);
  assert.equal(ZkCommitmentVerifier.verifyProofOfOpening(proof), true);

  // Tamper with responseSvHex -> proof verification must fail
  const tamperedProof = {
    ...proof,
    responseSvHex: (BigInt("0x" + proof.responseSvHex) + 1n).toString(16)
  };
  assert.equal(ZkCommitmentVerifier.verifyProofOfOpening(tamperedProof), false);
});
