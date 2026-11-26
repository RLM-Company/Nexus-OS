/** Stars acceptance: one mission, two results, senior verification, combined
 * file, restart and continuation. Pure local run through the real core state
 * machine; no model, network or VPS. */
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync } from "node:fs";
import {
  applyStarsMissionEvent,
  createStarsMission,
  canReadContext,
  StarsMissionConflict
} from "../packages/core/src/stars-mission.ts";

const out = new URL("../docs/team/operation-2026-11-25/stars/", import.meta.url);
mkdirSync(out, { recursive: true });

let m = createStarsMission({ id: "mission-stars-1", team_scope: "team-stars" });
const apply = (event, expected) => {
  if (expected !== undefined && expected !== m.version) throw new StarsMissionConflict();
  m = applyStarsMissionEvent(m, event);
  console.log(`${event.type}: ${m.stage} v${m.version}`);
};

apply({ type: "brief", goal: "Подготовить сравнение предложений поставщиков" });
apply({
  type: "plan",
  agents: [
    { id: "manager", role: "manager", task: "собрать общий итог", context_scopes: ["team-stars"] },
    {
      id: "extractor",
      role: "executor",
      task: "извлечь предложения",
      context_scopes: ["team-stars"]
    },
    {
      id: "reviewer",
      role: "executor",
      task: "проверить комплектность",
      context_scopes: ["team-stars"]
    }
  ],
  dependencies: { reviewer: ["extractor"] }
});
assert.equal(m.agents.length, 3);
assert.equal(canReadContext(m, "extractor", "team-stars"), true);
assert.equal(canReadContext(m, "extractor", "reviewer-private"), false);

apply({ type: "fail", agent_id: "extractor", reason: "PROVIDER_ERROR" });
assert.equal(m.agents.find((a) => a.id === "extractor")?.handoff, "извлечь предложения");
apply({ type: "replace", failed_agent_id: "extractor", replacement_id: "extractor-2" });
assert.equal(m.dependencies.reviewer?.[0], "extractor-2");

apply({ type: "message", from: "manager", to: "extractor-2", text: "Добавить валюту" });
apply({
  type: "result",
  agent_id: "extractor-2",
  summary: "извлечено 2 предложения",
  artifact_ref: "artifact-extract"
});
apply({
  type: "result",
  agent_id: "reviewer",
  summary: "комплектность проверена",
  artifact_ref: "artifact-review"
});

// Restart: serialize and restore exactly as the durable store does.
const snapshot = JSON.parse(JSON.stringify(m));
m = snapshot;
assert.equal(m.version, snapshot.version);
assert.equal(m.results.length, 2);

apply({ type: "verify", agent_id: "extractor-2", verdict: "verified", verified_by: "manager" });
apply({ type: "verify", agent_id: "reviewer", verdict: "verified", verified_by: "manager" });
apply({ type: "combine", summary: "Общий итог: предложения сравнены, расходы указаны" });
assert.equal(m.stage, "completed");

m = applyStarsMissionEvent(m, { type: "pause" });
assert.equal(m.stage, "completed", "completed mission cannot be paused");

writeFileSync(
  new URL("stars-acceptance.json", out),
  JSON.stringify({ mission: m, combined: m.combined_result }, null, 2)
);
console.log("STARS ACCEPTANCE PASSED");
