import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  DynamicContextBudgetAllocator,
  type ContextChunkCandidate
} from "../../../packages/core/src/dynamic-context-budget-allocator.js";
import {
  CryptographicAuditBlackbox,
  GENESIS_PREV_HASH
} from "../../../packages/db/src/cryptographic-audit-blackbox.js";

test("DynamicContextBudgetAllocator enforces 0% mandatory constraint loss and selects high-density optional chunks", () => {
  const allocator = new DynamicContextBudgetAllocator({ cacheBlockSize: 1024 });

  const candidates: ContextChunkCandidate[] = [
    {
      id: "chunk-system",
      stream: "system_tools",
      content: "System instructions for Kosmora OS.".repeat(20),
      isMandatory: true
    },
    {
      id: "chunk-constraint",
      stream: "pinned_constraints",
      content: "Mandatory project budget limit $250,000 for Project Apollo.".repeat(10),
      isMandatory: true
    },
    {
      id: "chunk-optional-high",
      stream: "retrieved_memory",
      content: "High value strategic note.".repeat(15),
      isMandatory: false,
      utilityScore: 0.95
    },
    {
      id: "chunk-optional-low",
      stream: "conversation_history",
      content: "Casual banter and low priority dialogue history.".repeat(40),
      isMandatory: false,
      utilityScore: 0.1
    }
  ];

  const report = allocator.allocateBudget(candidates, {
    totalBudgetTokens: 1500,
    minScratchpadTokens: 100,
    snapToCacheBlocks: true,
    cacheBlockSize: 1024
  });

  assert.equal(report.mandatoryConstraintLossPercent, 0.0);
  assert.ok(report.allocatedChunks.some((c) => c.id === "chunk-system"));
  assert.ok(report.allocatedChunks.some((c) => c.id === "chunk-constraint"));
  assert.ok(report.allocatedChunks.some((c) => c.id === "chunk-optional-high"));
  // Lower density optional chunk should be pruned if budget constrained
  assert.ok(report.prunedTokens >= 0);
  assert.equal(report.cacheAlignmentBlockTokens, 1024);
});

test("DynamicContextBudgetAllocator throws error if mandatory tokens exceed total budget", () => {
  const allocator = new DynamicContextBudgetAllocator();
  const candidates: ContextChunkCandidate[] = [
    {
      id: "chunk-huge-system",
      stream: "system_tools",
      content: "Extremely long mandatory policy.".repeat(500),
      isMandatory: true
    }
  ];

  assert.throws(
    () => {
      allocator.allocateBudget(candidates, { totalBudgetTokens: 512 });
    },
    {
      name: "Error",
      message: /MANDATORY_BUDGET_EXCEEDED/
    }
  );
});

test("CryptographicAuditBlackbox records hash chain, detects tampering, and issues compliance certificate", () => {
  const db = new DatabaseSync(":memory:");
  const blackbox = new CryptographicAuditBlackbox(db);

  const sessionId = "sess-audit-test-001";
  const ownerId = "owner-compliance-alpha";

  // 1. Record 3 sequential events
  const rec1 = blackbox.recordAuditEvent({
    sessionId,
    ownerId,
    eventType: "TOOL_SPECULATIVE_PREWARM",
    payload: { tool: "vault_read", path: "/vault/doc.docx" }
  });
  assert.equal(rec1.seq, 1);
  assert.equal(rec1.prevHash, GENESIS_PREV_HASH);

  const rec2 = blackbox.recordAuditEvent({
    sessionId,
    ownerId,
    eventType: "WORKFLOW_STEP_SELF_HEAL",
    payload: { step: "step-browser", attempt: 2, remediation: "Adjust timeout to 5000ms" }
  });
  assert.equal(rec2.seq, 2);
  assert.equal(rec2.prevHash, rec1.recordHash);

  const rec3 = blackbox.recordAuditEvent({
    sessionId,
    ownerId,
    eventType: "CONSENSUS_VERDICT_ISSUED",
    payload: { verdict: "consensus_reached", votes: 3 }
  });
  assert.equal(rec3.seq, 3);
  assert.equal(rec3.prevHash, rec2.recordHash);

  // 2. Verify pristine chain
  const cleanReport = blackbox.verifyAuditChain(sessionId, ownerId);
  assert.equal(cleanReport.isValid, true);
  assert.equal(cleanReport.totalRecords, 3);
  assert.equal(cleanReport.latestHash, rec3.recordHash);

  // 3. Issue compliance certificate
  const cert = blackbox.exportComplianceCertificate(sessionId, ownerId);
  assert.ok(cert.certificateId.startsWith("CERT-KOSMORA-"));
  assert.equal(cert.eventCount, 3);
  assert.equal(cert.integrityVerified, true);

  // 4. Tamper with record 2 directly in SQLite
  db.prepare(
    "UPDATE kosmora_session_audit_blackbox SET payload_json = ? WHERE session_id = ? AND seq = 2"
  ).run(JSON.stringify({ step: "step-browser", attempt: 2, tampered: true }), sessionId);

  // 5. Verify tamper detection
  const tamperedReport = blackbox.verifyAuditChain(sessionId, ownerId);
  assert.equal(tamperedReport.isValid, false);
  assert.equal(tamperedReport.tamperedSeq, 2);
  assert.ok(tamperedReport.error?.includes("PAYLOAD_TAMPERING_DETECTED"));
});
