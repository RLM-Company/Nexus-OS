#!/usr/bin/env node
/**
 * Kosmora / Nexus-OS Stage-2 Master Verification Matrix Runner
 *
 * Runs all Stage-2 and Autonomous OS suites deterministically across:
 * 1. PR #425: Google Drive Complete
 * 2. PR #420 / PR #424: Vault Document Extractor & Snapshot Restore
 * 3. PR #417 / PR #421: Context Memory Hybrid Search & Windows Download Verifier
 * 4. PR #418 / PR #419 / PR #423: History Compaction & Profile Reconciliation & VPS Migrator
 * 5. PR #414 / PR #416 / PR #425: Google Drive Immutable Spooler & Koswork Word (.docx) Builder
 * 6. PR #411 / PR #412 / PR #422 / PR #425: Journal Recovery, Computer Hazard Guard & BPE Auditor
 * 7. PR #415 / PR #421 / PR #425: Virtual Vault Bridge, Browser Pagination & Emergency Snapshot
 * 8. PR #426 / PR #427 / PR #428: Fable SSE Stream, Prefix Byte Cache & Sub-Workflows
 * 9. PR #426 / PR #428: Workflow Portability, Single-Pass Binder & Fable 5 Discovery Expiry
 * 10. PR #416 / PR #424 / PR #428: Workflow DAG Templates, Critic Verifier & Unified Coordinator
 * 11. Consolidated Stage-2 Migration 0063, Privacy Fencing Triggers & Desktop IPC Bridge
 * 12. Dense Semantic Vectors, Prompt Cache Optimizer & Multi-Agent Consensus
 * 13. Self-Healing DAG Runtime, Cross-Citation Graph & Desktop Watchdog
 * 14. Live Production Simulation & End-to-End Scenario Driver
 * 15. Automated Performance, Throughput & Latency Benchmarks
 * 16. Dynamic Context Budget Allocator & Cryptographic Audit Blackbox
 * 17. Episodic Reflexion Engine, Claim Grounding Verifier & Visual DOM Diff
 * 18. CRDT Memory Sync, MCTS Lookahead Planner, PII Firewall & Excel/CSV Exporter
 * 19. PowerPoint (.pptx) Builder, Temporal Bitemporal KG, Injection Shield & Circuit Breaker
 * 20. Rolling-Hash CDC Deduplicator, AST Code Sandbox, Thompson Bandit & PDF 1.4 Builder
 * 21. HNSW Graph Vector Index, Merkle State Trie, Constrained Grammar Enforcer & DPI Calibrator
 * 22. Deductive Datalog Engine, MinHash-LSH Deduplicator, OpenTelemetry Tracer & Clipboard Guard
 */

import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const SUITES = [
  {
    name: "Google Drive OAuth, Grant Cipher & Restore",
    script: "scripts/integration-google-drive-smoke.mjs",
    pr: "PR #425"
  },
  {
    name: "Local Vault PDF/Office Extractor & Memory Reconciler",
    script: "scripts/integration-vault-memory-smoke.mjs",
    pr: "PR #420 / PR #424"
  },
  {
    name: "Hybrid Memory Search, Entity Extraction & Download Verifier",
    script: "scripts/integration-hybrid-memory-and-download-smoke.mjs",
    pr: "PR #417 / PR #421"
  },
  {
    name: "Topic Compaction, Profile Candidates & 1GB VPS Migrator",
    script: "scripts/integration-compaction-profile-and-vps-smoke.mjs",
    pr: "PR #418 / PR #419 / PR #423"
  },
  {
    name: "Drive Immutable Spooler, Shadow DOM Piercer & Word .docx Builder",
    script: "scripts/integration-drive-spool-and-koswork-report-smoke.mjs",
    pr: "PR #414 / PR #416 / PR #425"
  },
  {
    name: "Drive Journal Recovery, Computer Hazard Guard & BPE Auditor",
    script: "scripts/integration-journal-recovery-hazard-and-bpe-smoke.mjs",
    pr: "PR #411 / PR #412 / PR #422 / PR #425"
  },
  {
    name: "Virtual Vault Bridge, Browser Pagination & Emergency Snapshot",
    script: "scripts/integration-vault-bridge-search-and-emergency-smoke.mjs",
    pr: "PR #415 / PR #421 / PR #425"
  },
  {
    name: "Fable SSE Resilient Stream, Prefix Cache & Workflow Subworkflows",
    script: "scripts/integration-fable-memory-cache-and-workflows-smoke.mjs",
    pr: "PR #426 / PR #427 / PR #428"
  },
  {
    name: "Workflow Portability, Anti-Injection Binder & Fable Expiry Guard",
    script: "scripts/integration-workflow-portability-and-fable-discovery-smoke.mjs",
    pr: "PR #426 / PR #428"
  },
  {
    name: "3 Scenario Templates, Topological DAG, Critic & 500-Receipt Store",
    script: "scripts/integration-workflow-dag-receipts-and-unified-smoke.mjs",
    pr: "PR #416 / PR #424 / PR #428"
  },
  {
    name: "Consolidated Migration 0063, Privacy Fencing & Electron IPC Bridge",
    script: "scripts/run-all-stage2-acceptance-suites.mjs",
    pr: "PR #411..#428 Integration"
  },
  {
    name: "Dense Semantic Vectors, Prompt Cache Optimizer & Multi-Agent Consensus",
    script: "scripts/integration-nextgen-technologies-smoke.mjs",
    pr: "Next-Gen Frontier"
  },
  {
    name: "Self-Healing DAG Runtime, Cross-Citation Graph & Desktop Watchdog",
    script: "scripts/integration-self-healing-and-watchdog-smoke.mjs",
    pr: "Autonomous OS Frontier"
  },
  {
    name: "Live Production Simulation & End-to-End Scenario Driver",
    script: "scripts/driver-mock-gateway-live-e2e.mjs",
    pr: "Production Simulation"
  },
  {
    name: "Automated Performance, Throughput & Latency Benchmarks",
    script: "scripts/benchmark-kosmora-stage2-performance.mjs",
    pr: "Performance Benchmarking"
  },
  {
    name: "Dynamic Context Budget Allocator & Cryptographic Audit Blackbox",
    script: "scripts/integration-dynamic-budget-and-blackbox-smoke.mjs",
    pr: "Context Budget & Audit Blackbox"
  },
  {
    name: "Episodic Reflexion Engine, Claim Grounding Verifier & Visual DOM Diff",
    script: "scripts/integration-reflexion-grounding-and-dom-diff-smoke.mjs",
    pr: "Episodic Reflexion & Grounding"
  },
  {
    name: "CRDT Memory Sync, MCTS Lookahead Planner, PII Firewall & Excel Builder",
    script: "scripts/integration-crdt-mcts-pii-and-excel-smoke.mjs",
    pr: "CRDT, MCTS, PII & Excel"
  },
  {
    name: "PowerPoint (.pptx) Builder, Temporal Bitemporal KG, Injection Shield & Circuit Breaker",
    script: "scripts/integration-pptx-temporal-kg-and-shield-smoke.mjs",
    pr: "PPTX, Temporal KG & Shield"
  },
  {
    name: "Rolling-Hash CDC Deduplicator, AST Code Sandbox, Thompson Bandit & PDF 1.4 Builder",
    script: "scripts/integration-cdc-ast-bandit-and-pdf-smoke.mjs",
    pr: "CDC, AST Sandbox, Bandit & PDF"
  },
  {
    name: "HNSW Graph Vector Index, Merkle State Trie, Constrained Grammar Enforcer & DPI Calibrator",
    script: "scripts/integration-hnsw-merkle-grammar-and-dpi-smoke.mjs",
    pr: "HNSW, Merkle, Grammar & DPI"
  },
  {
    name: "Deductive Datalog Engine, MinHash-LSH Deduplicator, OpenTelemetry Tracer & Clipboard Guard",
    script: "scripts/integration-datalog-minhash-otel-and-clipboard-smoke.mjs",
    pr: "Datalog, MinHash, OTel & Clipboard"
  },
  {
    name: "Roaring Bitmap Positional Index, Differential Privacy, Petri Net Verifier & WAV PCM Verifier",
    script: "scripts/integration-roaring-dp-petri-and-wav-smoke.mjs",
    pr: "Roaring, DP, Petri Net & WAV"
  },
  {
    name: "Cuckoo/Bloom Filter Index, Shamir (k,n) Secret Sharing, Causal SCM Attribution & HTML5 Report Bundle",
    script: "scripts/integration-cuckoo-shamir-causal-and-html-smoke.mjs",
    pr: "Cuckoo, Shamir, Causal & HTML"
  },
  {
    name: "Product Quantization (32x), Kalman-CUSUM Drift Detector, Zero-Knowledge Commitments & Archive Quarantine",
    script: "scripts/integration-pq-kalman-zk-and-archive-smoke.mjs",
    pr: "PQ 32x, Kalman, ZK & Archive"
  },
  {
    name: "Adaptive AI Hyperparameter, Decoding & Reasoning Budget Controller",
    script: "scripts/integration-ai-parameter-controller-smoke.mjs",
    pr: "AI Hyperparameters & Reasoning"
  }
];

console.log("================================================================================");
console.log("🚀 KOSMORA / KOSWORK STAGE-2 MASTER VERIFICATION MATRIX RUNNER");
console.log(`Repository Root: ${repoRoot}`);
console.log(`Timestamp: ${new Date().toISOString()}`);
console.log("================================================================================");

const startTime = performance.now();
const results = [];

for (let i = 0; i < SUITES.length; i++) {
  const suite = SUITES[i];
  console.log(`\n[${i + 1}/${SUITES.length}] Running: ${suite.name} (${suite.pr})...`);
  const stepStart = performance.now();

  const res = spawnSync(process.execPath, [suite.script], {
    cwd: repoRoot,
    stdio: "inherit"
  });

  const durationMs = Math.round(performance.now() - stepStart);
  const passed = res.status === 0;
  results.push({
    ...suite,
    passed,
    exitCode: res.status ?? 1,
    durationMs
  });

  if (!passed) {
    console.error(`\n❌ FAILED: ${suite.name} exited with code ${res.status}`);
    process.exit(res.status ?? 1);
  }
  console.log(`✅ PASSED in ${durationMs}ms`);
}

// Verify Parallel Work Boundaries
console.log("\n==> Verifying restricted file boundary invariants (Codex parallel work)...");
const diffCheck = spawnSync(
  "git",
  [
    "diff",
    "--name-only",
    "apps/api/src/account-settings",
    "packages/db/src/usage-store.ts",
    "packages/contracts/src/usage.ts"
  ],
  { cwd: repoRoot, encoding: "utf8" }
);

if (diffCheck.stdout && diffCheck.stdout.trim().length > 0) {
  console.error(
    "❌ FATAL: Restricted file boundary modified! Parallel work with Codex violated:\n" +
      diffCheck.stdout
  );
  process.exit(1);
}
console.log("✅ Zero modifications to restricted boundary files verified.");

// Verify Zero Embedded Secrets
console.log("\n==> Verifying zero embedded secrets in codebase...");
const secretCheck = spawnSync(process.execPath, ["scripts/check-secrets.mjs"], {
  cwd: repoRoot,
  stdio: "inherit"
});
if (secretCheck.status !== 0) {
  console.error("❌ FATAL: Embedded secret check failed!");
  process.exit(secretCheck.status ?? 1);
}
console.log("✅ Secret scan passed cleanly.");

const totalDurationSec = ((performance.now() - startTime) / 1000).toFixed(2);
console.log("\n================================================================================");
console.log("🏁 MASTER VERIFICATION MATRIX SUMMARY");
console.log("================================================================================");
console.table(
  results.map((r) => ({
    PR: r.pr,
    Module: r.name,
    Status: r.passed ? "PASS" : "FAIL",
    Duration: `${r.durationMs}ms`
  }))
);
console.log(`\n🎉 ALL ${SUITES.length} TEST SUITES PASSED in ${totalDurationSec}s.`);
console.log("All Stage-2 contracts, schemas, security policies, and boundary constraints verified.");
console.log("================================================================================\n");
