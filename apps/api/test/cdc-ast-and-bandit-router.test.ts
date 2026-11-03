import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  CdcChunkingDeduplicator,
  splitBufferContentDefined
} from "../../../packages/db/src/cdc-chunking-deduplicator.js";
import { AstCodeSandboxVerifier } from "../../../packages/core/src/ast-code-sandbox-verifier.js";
import { ThompsonSamplingBanditRouter } from "../../../packages/core/src/thompson-sampling-bandit-router.js";

test("CdcChunkingDeduplicator re-synchronizes boundaries after prefix insertion and deduplicates >80% of unchanged sub-file blocks", () => {
  const db = new DatabaseSync(":memory:");
  const dedup = new CdcChunkingDeduplicator(db);
  const ownerId = "owner-cdc-001";

  // Generate a 40 KB structured document payload
  const blocks: string[] = [];
  for (let i = 0; i < 80; i++) {
    blocks.push(
      `Section ${i}: Project Apollo strategic specification block ${i * 1337} with deterministic content padding. `.repeat(6)
    );
  }
  const docV1 = Buffer.from(blocks.join("\n"), "utf8");

  const rep1 = dedup.ingestBuffer({
    ownerId,
    manifestId: "doc-apollo-v1",
    payload: docV1,
    chunkerOptions: { minChunkBytes: 256, avgChunkBytes: 1024, maxChunkBytes: 4096 }
  });

  assert.ok(rep1.totalChunks >= 8);
  assert.equal(rep1.newChunksStored, rep1.totalChunks);

  // Create docV2 by inserting a 120-byte header at the very beginning (which would break 100% of fixed-size chunks)
  const docV2 = Buffer.concat([
    Buffer.from("=== URGENT REVISION 2 HEADER INSERTED AT OFFSET 0 ===\n", "utf8"),
    docV1
  ]);

  const rep2 = dedup.ingestBuffer({
    ownerId,
    manifestId: "doc-apollo-v2",
    payload: docV2,
    chunkerOptions: { minChunkBytes: 256, avgChunkBytes: 1024, maxChunkBytes: 4096 }
  });

  assert.ok(
    rep2.deduplicationRatioPercent >= 80.0,
    `Expected CDC deduplication >= 80%, got ${rep2.deduplicationRatioPercent}%`
  );
  assert.ok(rep2.reusedChunksCount >= rep1.totalChunks - 2);

  // Verify exact byte-for-byte reconstruction of both versions
  const restoredV1 = dedup.assembleManifestBuffer(ownerId, "doc-apollo-v1");
  const restoredV2 = dedup.assembleManifestBuffer(ownerId, "doc-apollo-v2");
  assert.equal(Buffer.compare(restoredV1, docV1), 0);
  assert.equal(Buffer.compare(restoredV2, docV2), 0);
});

test("AstCodeSandboxVerifier blocks eval, process spawn, network, prototype pollution, and executes safe math expressions in isolated VM", () => {
  const verifier = new AstCodeSandboxVerifier();

  // 1. Safe mathematical & array expression
  const safeExec = verifier.executeSandboxedExpression(
    "items.map(x => x * taxRate).reduce((a, b) => a + b, 0)",
    { items: [1000, 2000, 3000], taxRate: 1.15 }
  );
  assert.equal(safeExec.ok, true);
  assert.equal(safeExec.result, 6900);

  // 2. Dangerous process & eval snippet
  const dangerousAudit = verifier.auditCodeSnippet(
    "const cp = require('child_process'); eval('process.exit(1)'); obj.__proto__.polluted = true; while(true){}"
  );
  assert.equal(dangerousAudit.safe, false);
  assert.ok(dangerousAudit.violations.some((v) => v.category === "FILESYSTEM_ESCAPE"));
  assert.ok(dangerousAudit.violations.some((v) => v.category === "PROCESS_SPAWN"));
  assert.ok(dangerousAudit.violations.some((v) => v.category === "DYNAMIC_CODE_EVAL"));
  assert.ok(dangerousAudit.violations.some((v) => v.category === "PROTOTYPE_POLLUTION"));
  assert.ok(dangerousAudit.violations.some((v) => v.category === "INFINITE_LOOP_RISK"));

  const blockedExec = verifier.executeSandboxedExpression("process.env.SECRET");
  assert.equal(blockedExec.ok, false);
  assert.ok(blockedExec.error?.includes("AST_SECURITY_VIOLATION"));
});

test("ThompsonSamplingBanditRouter converges on high-reliability low-latency strategy arms via Beta posterior sampling", () => {
  const router = new ThompsonSamplingBanditRouter({ seed: 1337, decayFactor: 0.995 });
  router.registerArm("arm-fast-reliable", "Local Dense+Sparse Vault", 1, 1);
  router.registerArm("arm-flaky-slow", "Legacy Remote Scraper", 1, 1);

  // Train bandit over 40 rounds
  for (let i = 0; i < 40; i++) {
    router.recordArmOutcome("arm-fast-reliable", { succeeded: true, latencyMs: 80 });
    router.recordArmOutcome("arm-flaky-slow", { succeeded: i % 5 === 0, latencyMs: 4500 });
  }

  // Over 20 selections, the high-reward arm should be chosen the vast majority of times
  let fastSelections = 0;
  for (let j = 0; j < 20; j++) {
    const sel = router.selectStrategyArm();
    if (sel.selectedArmId === "arm-fast-reliable") {
      fastSelections++;
    }
  }

  assert.ok(fastSelections >= 18, `Expected >= 18 selections for optimal arm, got ${fastSelections}`);
});
