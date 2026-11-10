import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { EpisodicReflexionEngine } from "../../../packages/db/src/episodic-reflexion-engine.js";
import {
  ClaimGroundingVerifier,
  isBareDomainHomepage
} from "../../../packages/core/src/claim-grounding-verifier.js";

test("EpisodicReflexionEngine records recovery trajectories, reinforces confidence, and recalls relevant guardrails", () => {
  const db = new DatabaseSync(":memory:");
  const engine = new EpisodicReflexionEngine(db);
  const ownerId = "owner-reflexion-001";

  // 1. Record a recovery episode from a browser timeout
  const ep1 = engine.recordRecoveryEpisode({
    ownerId,
    toolName: "browser_verify",
    errorMessage: "Selector timeout: element #apollo-status not visible within 3000ms (id: 550e8400-e29b-41d4-a716-446655440000)",
    taskContext: "Verify Project Apollo launch dashboard status inside Shadow DOM",
    remedialResolution: "Pierce open Shadow DOM root and wait up to 8000ms for #apollo-status"
  });

  assert.ok(ep1.id.startsWith("refl-"));
  assert.equal(ep1.successCount, 1);
  assert.ok(ep1.errorPattern.includes("<UUID>"));
  assert.ok(ep1.synthesizedRule.includes("[GUARDRAIL:browser_verify]"));

  // 2. Reinforce with a second successful recovery on the same pattern
  const ep2 = engine.recordRecoveryEpisode({
    ownerId,
    toolName: "browser_verify",
    errorMessage: "Selector timeout: element #apollo-status not visible within 3000ms (id: 123e4567-e89b-12d3-a456-426614174000)",
    taskContext: "Verify Project Apollo launch dashboard status",
    remedialResolution: "Pierce open Shadow DOM root and wait up to 8000ms for #apollo-status"
  });

  assert.equal(ep2.id, ep1.id);
  assert.equal(ep2.successCount, 2);
  assert.ok(ep2.confidenceScore >= 0.75);

  // 3. Recall guardrails prior to a new similar step execution
  const matches = engine.recallRelevantGuardrails({
    ownerId,
    toolName: "browser_verify",
    taskContext: "Check Project Apollo dashboard status element in browser",
    topK: 3
  });

  assert.equal(matches.length, 1);
  assert.equal(matches[0].rule.id, ep1.id);
  assert.ok(matches[0].effectiveRankScore > 0.6);

  // 4. Record application outcome
  const updated = engine.recordRuleApplicationOutcome(ep1.id, ownerId, true);
  assert.equal(updated?.successCount, 3);
});

test("ClaimGroundingVerifier passes fully grounded drafts with dedicated URLs and flags bare domains or hallucinated metrics", () => {
  assert.equal(isBareDomainHomepage("https://github.com/"), true);
  assert.equal(isBareDomainHomepage("https://github.com"), true);
  assert.equal(isBareDomainHomepage("https://github.com/RLM-Company/Nexus-OS/pull/428"), false);

  const verifier = new ClaimGroundingVerifier();
  const sources = [
    {
      id: "src-1",
      title: "Q3 Strategic Report",
      url: "https://drive.google.com/file/d/1JjodEnDA3Tsj3y/view",
      content: "Project Apollo confirmed launch budget is $250,000 with target date 2026-11-15 and cache hit rate 87.3%."
    }
  ];

  // 1. Clean grounded draft
  const cleanDraft =
    "According to the [Q3 Strategic Report](https://drive.google.com/file/d/1JjodEnDA3Tsj3y/view), Project Apollo has a budget of $250,000, a target date of 2026-11-15, and achieves 87.3% cache efficiency.";

  const cleanReport = verifier.verifyDraftGrounding({
    draftText: cleanDraft,
    sources,
    requireSourceUrlInCorpus: true
  });

  assert.equal(cleanReport.passed, true);
  assert.equal(cleanReport.violations.length, 0);
  assert.equal(cleanReport.fidelityScore, 1.0);

  // 2. Defective draft with bare domain, bracketed [1], and hallucinated $999,000 metric
  const defectiveDraft =
    "Project Apollo [1] has a budget of $999,000 as shown on [GitHub](https://github.com/).";

  const defectiveReport = verifier.verifyDraftGrounding({
    draftText: defectiveDraft,
    sources,
    requireSourceUrlInCorpus: true
  });

  assert.equal(defectiveReport.passed, false);
  assert.ok(defectiveReport.violations.some((v) => v.type === "bracketed_citation"));
  assert.ok(defectiveReport.violations.some((v) => v.type === "bare_domain_url"));
  assert.ok(defectiveReport.violations.some((v) => v.type === "ungrounded_metric"));
  assert.ok(defectiveReport.remediationSummary.length >= 3);
});
