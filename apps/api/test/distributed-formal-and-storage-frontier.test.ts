import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

import { RaftConsensusNode } from "../../../packages/core/src/raft-consensus-state-machine.ts";
import { LtlTemporalModelChecker } from "../../../packages/core/src/ltl-temporal-model-checker.ts";
import { SimulatedAnnealingTabuOptimizer } from "../../../packages/core/src/simulated-annealing-tabu-optimizer.ts";
import { LsmTreeSstableEngine } from "../../../packages/db/src/lsm-tree-sstable-engine.ts";
import { LinUcbContextualBandit } from "../../../packages/core/src/linucb-contextual-bandit.ts";
import { ViterbiIntentDecoder } from "../../../packages/core/src/viterbi-intent-decoder.ts";
import { DempsterShaferEvidenceFusion } from "../../../packages/core/src/dempster-shafer-evidence-fusion.ts";
import { AhoCorasickAutomaton } from "../../../packages/core/src/aho-corasick-scanner.ts";
import { MyersDiffEngine } from "../../../packages/core/src/myers-diff-engine.ts";
import { SpeculativeDecodingVerifier } from "../../../packages/core/src/speculative-decoding-verifier.ts";
import { CircularRingBuffer } from "../../../packages/core/src/ring-buffer-backpressure-controller.ts";
import { RbacAbacPolicyEngine } from "../../../packages/core/src/rbac-abac-policy-engine.ts";
import { TimeSeriesDeltaCompressor } from "../../../packages/db/src/timeseries-delta-compressor.ts";
import { DominantResourceFairnessScheduler } from "../../../packages/core/src/drf-fair-share-scheduler.ts";

test("Phase 10: Distributed Consensus, Formal Model-Checking, Metaheuristics & Enterprise Storage Frontier (Modules 45-58)", () => {
  // 1. Raft Consensus State Machine
  const nodeA = new RaftConsensusNode("node-a", ["node-b", "node-c"]);
  const nodeB = new RaftConsensusNode("node-b", ["node-a", "node-c"]);
  const nodeC = new RaftConsensusNode("node-c", ["node-a", "node-b"]);

  const voteReq = nodeA.startElection();
  const voteB = nodeB.handleRequestVote(voteReq);
  const voteC = nodeC.handleRequestVote(voteReq);
  nodeA.receiveVoteReply("node-b", voteB);
  nodeA.receiveVoteReply("node-c", voteC);
  assert.equal(nodeA.role, "leader");

  const entry = nodeA.proposeCommand("SET_AUTONOMOUS_MODE=true");
  const appendReplyB = nodeB.handleAppendEntries({
    term: nodeA.currentTerm,
    leaderId: nodeA.nodeId,
    prevLogIndex: 0,
    prevLogTerm: 0,
    entries: [entry],
    leaderCommit: 0
  });
  const committedIdx = nodeA.recordFollowerAppendReply("node-b", appendReplyB);
  assert.equal(committedIdx, 1);
  assert.deepEqual(nodeA.appliedCommands, ["SET_AUTONOMOUS_MODE=true"]);

  // 2. LTL Temporal Logic Model Checker
  const trace = [
    { stepIndex: 0, stateLabel: "init", atomicPropositions: ["authenticated"] },
    { stepIndex: 1, stateLabel: "check", atomicPropositions: ["authenticated", "tx_started"] },
    { stepIndex: 2, stateLabel: "commit", atomicPropositions: ["authenticated", "tx_committed"] }
  ];
  const gAuth = LtlTemporalModelChecker.verifyTrace(trace, {
    kind: "always_globally",
    proposition: "authenticated"
  });
  assert.equal(gAuth.satisfied, true);

  const leadsToCommit = LtlTemporalModelChecker.verifyTrace(trace, {
    kind: "response_leads_to",
    triggerProposition: "tx_started",
    responseProposition: "tx_committed"
  });
  assert.equal(leadsToCommit.satisfied, true);

  // 3. Simulated Annealing + Tabu Optimizer
  const saRes = SimulatedAnnealingTabuOptimizer.optimize({
    initialState: [5, 4, 3, 2, 1],
    energyCostFn: (arr) => {
      let inversions = 0;
      for (let i = 0; i < arr.length; i++) {
        for (let j = i + 1; j < arr.length; j++) {
          if (arr[i]! > arr[j]!) inversions += 10;
        }
      }
      return inversions;
    },
    generateNeighborsFn: (arr) => {
      const neighbors: number[][] = [];
      for (let i = 0; i < arr.length - 1; i++) {
        const copy = [...arr];
        const tmp = copy[i]!;
        copy[i] = copy[i + 1]!;
        copy[i + 1] = tmp;
        neighbors.push(copy);
      }
      return neighbors;
    },
    hashStateFn: (arr) => arr.join(","),
    maxIterations: 80
  });
  assert.equal(saRes.bestEnergyCost, 0);
  assert.deepEqual(saRes.bestState, [1, 2, 3, 4, 5]);

  // 4. LSM-Tree + SSTable Engine
  const db = new DatabaseSync(":memory:");
  const lsm = new LsmTreeSstableEngine({
    sqlite: db,
    ownerId: "user-1",
    namespace: "kv",
    memTableLimit: 3
  });
  lsm.put("alpha", "10");
  lsm.put("beta", "20");
  lsm.put("gamma", "30"); // triggers auto-flush to L0 SSTable
  lsm.put("beta", "25");
  lsm.delete("alpha");
  assert.equal(lsm.get("beta"), "25");
  assert.equal(lsm.get("alpha"), null);
  assert.equal(lsm.get("gamma"), "30");
  const compacted = lsm.compactSstables();
  assert.equal(compacted.liveKeysRetained, 2);
  assert.equal(compacted.tombstonesPurged, 1);

  // 5. LinUCB Disjoint Contextual Bandit
  const bandit = new LinUcbContextualBandit({
    dimension: 3,
    alphaExploration: 0.5,
    armIds: ["fast-arm", "deep-arm"]
  });
  const ctx = [1.0, 0.8, 0.2];
  for (let i = 0; i < 6; i++) {
    bandit.updateReward("deep-arm", ctx, 0.95);
    bandit.updateReward("fast-arm", ctx, 0.2);
  }
  const choice = bandit.selectArm(ctx);
  assert.equal(choice.selectedArmId, "deep-arm");

  // 6. Viterbi HMM Intent Decoder
  const viterbiPath = ViterbiIntentDecoder.decodeMostLikelySequence(
    {
      states: ["explore", "implement", "verify"],
      initialProbabilities: { explore: 0.7, implement: 0.2, verify: 0.1 },
      transitionMatrix: {
        explore: { explore: 0.3, implement: 0.6, verify: 0.1 },
        implement: { explore: 0.1, implement: 0.3, verify: 0.6 },
        verify: { explore: 0.2, implement: 0.1, verify: 0.7 }
      },
      emissionMatrix: {
        explore: { search_docs: 0.8, write_patch: 0.1, run_tests: 0.1 },
        implement: { search_docs: 0.1, write_patch: 0.8, run_tests: 0.1 },
        verify: { search_docs: 0.1, write_patch: 0.1, run_tests: 0.8 }
      }
    },
    ["search_docs", "write_patch", "run_tests"]
  );
  assert.deepEqual(viterbiPath.mostLikelyStates, ["explore", "implement", "verify"]);

  // 7. Dempster-Shafer Evidence Fusion
  const fused = DempsterShaferEvidenceFusion.combineTwoSources(
    ["safe", "risky", "blocked"],
    { masses: { safe: 0.7, "*": 0.3 } },
    { masses: { safe: 0.8, "*": 0.2 } }
  );
  assert.ok((fused.beliefByHypothesis["safe"] ?? 0) > 0.9);
  assert.ok(fused.remainingIgnorance < 0.1);

  // 8. Aho-Corasick Multi-Pattern Automaton
  const ac = new AhoCorasickAutomaton([
    { id: "p1", keyword: "rm -rf", category: "shell" },
    { id: "p2", keyword: "drop table", category: "sql" }
  ]);
  const matches = ac.scan("Do not execute rm -rf / or DROP TABLE users;");
  assert.equal(matches.length, 2);

  // 9. Myers Minimal Edit Script & Unified Diff Engine
  const diffRes = MyersDiffEngine.diffLines(
    "line1\nline2\nline3",
    "line1\nline2_modified\nline3",
    "config.env"
  );
  assert.equal(diffRes.editDistance, 2);
  assert.match(diffRes.unifiedDiffText, /-line2/);
  assert.match(diffRes.unifiedDiffText, /\+line2_modified/);

  // 10. Speculative Decoding Verifier
  const specStep = SpeculativeDecodingVerifier.verifyDraftBatch({
    proposals: [
      { token: "SELECT", draftProbQ: 0.8, targetProbP: 0.9 },
      { token: "*", draftProbQ: 0.7, targetProbP: 0.85 }
    ],
    bonusTargetTokenAfterAllAccepted: "FROM",
    uniformRandomDraws: [0.2, 0.3]
  });
  assert.equal(specStep.acceptedDraftCount, 2);
  assert.deepEqual(specStep.emittedTokens, ["SELECT", "*", "FROM"]);

  // 11. Zero-Copy Circular Ring Buffer & Watermark Backpressure
  const ring = new CircularRingBuffer<number>({
    capacity: 4,
    highWatermarkRatio: 0.75,
    lowWatermarkRatio: 0.25
  });
  assert.equal(ring.push(10).signal, "FLOW_NORMAL");
  assert.equal(ring.push(20).signal, "FLOW_NORMAL");
  assert.equal(ring.push(30).signal, "PAUSE_PRODUCER");
  assert.equal(ring.shift().item, 10);
  const s2 = ring.shift();
  assert.equal(s2.item, 20);
  assert.equal(s2.signal, "RESUME_PRODUCER");

  // 12. RBAC + ABAC Policy Decision Point
  const pdp = new RbacAbacPolicyEngine();
  pdp.defineRoleInheritance("senior-eng", ["eng"]);
  pdp.addRule({
    ruleId: "allow-eng-write",
    effect: "permit",
    requiredRoles: ["eng"],
    actionPattern: "workspace:write"
  });
  pdp.addRule({
    ruleId: "deny-untrusted-ip",
    effect: "deny",
    actionPattern: "*",
    conditionFn: (_subj, _res, env) => env.untrustedNetwork === true
  });
  const decision = pdp.evaluate({
    subject: { subjectId: "u1", roles: ["senior-eng"], clearanceLevel: 3, ownerId: "org-1" },
    action: "workspace:write",
    resource: { resourceId: "r1", ownerId: "org-1", classificationLevel: 2 },
    environment: { untrustedNetwork: true },
    combiningAlgorithm: "deny-overrides"
  });
  assert.equal(decision.decision, "DENY");
  assert.equal(decision.matchedRuleId, "deny-untrusted-ip");

  // 13. Gorilla-Style Delta-of-Delta Time-Series Compressor
  const tsStore = new TimeSeriesDeltaCompressor(db);
  const rawPoints = [
    { timestampMs: 1700000000000, value: 50.5 },
    { timestampMs: 1700000060000, value: 51.0 },
    { timestampMs: 1700000120000, value: 50.75 },
    { timestampMs: 1700000180000, value: 52.0 }
  ];
  const savedBlock = tsStore.saveCompressedBlock("user-1", "cpu.pct", rawPoints);
  assert.deepEqual(savedBlock.deltaOfDeltas, [60000, 0, 0]);
  const roundtrip = tsStore.loadAndDecompressBlock(savedBlock.blockId);
  assert.deepEqual(roundtrip, rawPoints);

  // 14. Dominant Resource Fairness (DRF) Scheduler
  const drf = new DominantResourceFairnessScheduler({
    cpuMs: 1000,
    ramMb: 4000,
    tokens: 10000
  });
  const firstPick = drf.scheduleNextTask([
    { tenantId: "tenant-a", taskId: "t1", demand: { cpuMs: 200, ramMb: 200, tokens: 500 } },
    { tenantId: "tenant-b", taskId: "t2", demand: { cpuMs: 50, ramMb: 1000, tokens: 500 } }
  ]);
  assert.ok(firstPick !== null);
  const secondPick = drf.scheduleNextTask([
    { tenantId: "tenant-a", taskId: "t3", demand: { cpuMs: 200, ramMb: 200, tokens: 500 } },
    { tenantId: "tenant-b", taskId: "t2", demand: { cpuMs: 50, ramMb: 1000, tokens: 500 } }
  ]);
  assert.equal(secondPick?.scheduledTenantId, "tenant-b");
});
