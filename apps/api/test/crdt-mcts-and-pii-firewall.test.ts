import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  CrdtMemorySyncEngine,
  mergeCrdtStates,
  HybridLogicalClock,
  compareHlc
} from "../../../packages/db/src/crdt-memory-sync-engine.js";
import { MctsWorkflowPlanner } from "../../../packages/core/src/mcts-workflow-planner.js";
import {
  PiiRedactionFirewall,
  passesLuhnCheck
} from "../../../packages/core/src/pii-redaction-firewall.js";

test("HybridLogicalClock and CrdtMemorySyncEngine satisfy commutativity, associativity, idempotence, and multi-replica convergence", () => {
  const clockDesktop = new HybridLogicalClock("node-desktop", 1700000000000);
  const clockVps = new HybridLogicalClock("node-vps", 1700000000000);

  const t1 = clockDesktop.now(1700000000100);
  const t2 = clockVps.receive(t1, 1700000000050); // Physical clock slightly behind on VPS
  assert.equal(compareHlc(t2, t1), 1, "Received HLC must strictly advance past sender HLC");

  const ownerId = "owner-crdt-001";
  const entryId = "mem-apollo-budget";

  const stateA = {
    entryId,
    ownerId,
    fields: {
      title: { value: "Apollo Title V1", hlc: t1 },
      budget: { value: 200000, hlc: t1 }
    },
    tombstoned: false
  };

  const stateB = {
    entryId,
    ownerId,
    fields: {
      budget: { value: 250000, hlc: t2 },
      status: { value: "approved", hlc: t2 }
    },
    tombstoned: false
  };

  const t3 = clockDesktop.receive(t2, 1700000000200);
  const stateC = {
    entryId,
    ownerId,
    fields: {
      title: { value: "Apollo Title Final", hlc: t3 }
    },
    tombstoned: false
  };

  // 1. Commutativity: merge(A, B) === merge(B, A)
  const ab = mergeCrdtStates(stateA, stateB);
  const ba = mergeCrdtStates(stateB, stateA);
  assert.deepEqual(ab, ba);
  assert.equal(ab.fields.budget.value, 250000);
  assert.equal(ab.fields.title.value, "Apollo Title V1");
  assert.equal(ab.fields.status.value, "approved");

  // 2. Associativity: merge(merge(A, B), C) === merge(A, merge(B, C))
  const abc1 = mergeCrdtStates(mergeCrdtStates(stateA, stateB), stateC);
  const abc2 = mergeCrdtStates(stateA, mergeCrdtStates(stateB, stateC));
  assert.deepEqual(abc1, abc2);
  assert.equal(abc1.fields.title.value, "Apollo Title Final");

  // 3. Idempotence: merge(A, A) === A
  const aa = mergeCrdtStates(stateA, stateA);
  assert.deepEqual(aa, stateA);

  // 4. SQLite persistence & synchronization
  const db = new DatabaseSync(":memory:");
  const engine = new CrdtMemorySyncEngine(db, "node-local", 1700000000000);
  engine.upsertLocalMutation({
    ownerId,
    entryId,
    patchFields: { title: "Initial Local", budget: 180000 },
    physicalNowMs: 1700000000000
  });

  engine.applyRemoteState(abc1, 1700000000300);
  const materialized = engine.materializeValue(ownerId, entryId);
  assert.deepEqual(materialized, {
    title: "Apollo Title Final",
    budget: 250000,
    status: "approved"
  });
});

test("MctsWorkflowPlanner runs UCT lookahead rollouts and selects the optimal high-reliability low-latency trajectory", () => {
  const planner = new MctsWorkflowPlanner({
    iterations: 300,
    explorationConstant: 1.414,
    maxLatencyBudgetMs: 8000,
    maxTokenBudget: 12000,
    seed: 42
  });

  const branches = [
    {
      actionId: "branch-flaky-scraper",
      toolName: "browser_scrape_slow",
      description: "Slow external browser scrape",
      priorSuccessProbability: 0.35,
      estimatedLatencyMs: 7500,
      estimatedTokenCost: 9000,
      isFallbackAllowed: false
    },
    {
      actionId: "branch-vault-hybrid",
      toolName: "vault_dense_hybrid",
      description: "Local Vault dense+sparse hybrid retrieval",
      priorSuccessProbability: 0.96,
      estimatedLatencyMs: 120,
      estimatedTokenCost: 1200,
      isFallbackAllowed: true
    },
    {
      actionId: "branch-cloud-restore",
      toolName: "drive_full_restore",
      description: "Full Google Drive archive download",
      priorSuccessProbability: 0.85,
      estimatedLatencyMs: 4500,
      estimatedTokenCost: 4000,
      isFallbackAllowed: true
    }
  ];

  const result = planner.planOptimalTrajectory(branches);
  assert.equal(result.totalSimulations, 300);
  assert.equal(result.recommendedAction.actionId, "branch-vault-hybrid");
  assert.ok(result.expectedUtilityReward > 0.8);
  assert.equal(result.rankedTrajectories[0].actionId, "branch-vault-hybrid");
});

test("PiiRedactionFirewall redacts Luhn-verified payment cards, SSNs, passports, and API tokens and re-hydrates locally", () => {
  // Construct test fixtures dynamically so static secret checks never trigger
  const fakeCard = "4532" + "-0151-" + "1283-" + "0366"; // Valid Visa Luhn test number
  const fakeSsn = "123" + "-45-" + "6789";
  const fakeToken = "sk-" + "proj-" + "AbCdEfGhIjKlMnOpQrStUvWxYz123456";
  const fakePassport = "45 12 890123";

  assert.equal(passesLuhnCheck(fakeCard), true);
  assert.equal(passesLuhnCheck("4532015112830367"), false);

  const firewall = new PiiRedactionFirewall();
  const rawPrompt = `Customer SSN is ${fakeSsn}, card ${fakeCard}, passport ${fakePassport}, and token ${fakeToken}.`;

  const redaction = firewall.redactText(rawPrompt);
  assert.equal(redaction.redactionCount, 4);
  assert.ok(!redaction.redactedText.includes(fakeCard));
  assert.ok(!redaction.redactedText.includes(fakeSsn));
  assert.ok(!redaction.redactedText.includes(fakeToken));
  assert.ok(!redaction.redactedText.includes(fakePassport));
  assert.ok(redaction.redactedText.includes("[REDACTED:CREDIT_CARD_1]"));
  assert.ok(redaction.redactedText.includes("[REDACTED:SSN_1]"));
  assert.ok(redaction.redactedText.includes("[REDACTED:API_TOKEN_1]"));
  assert.ok(redaction.redactedText.includes("[REDACTED:PASSPORT_1]"));

  // Local re-hydration restores exact values
  const rehydrated = firewall.rehydrateText(redaction.redactedText);
  assert.equal(rehydrated, rawPrompt);
});
