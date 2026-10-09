import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { parseResearchAnswer, researchMarkdown, researchHtml, type ResearchRun } from "@cosmora/core";
import type { ManagerService } from "@cosmora/core";
import type { ModelGateway, ModelGatewayStreamEvent } from "@cosmora/model-gateway";
import { ResearchStore } from "../src/research/research-store.js";
import { ResearchCoordinator } from "../src/research/research-coordinator.js";
import { ResearchSynthesis, type ResearchOwnerBudget } from "../src/research/research-synthesis.js";
import { ResearchPrivacyAdapter } from "../src/research/research-privacy.js";
import { ResearchPageReader } from "../src/research/page-reader.js";

const owner = "test-owner", project = "test-project";
const valid = JSON.stringify({ summary: [{ text: "Технологии менялись", citations: [{ source_id: "S1", excerpt_id: "E1" }] }], disagreements: [], gaps: ["Нет количественных данных"] });
const newStore = () => {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../src/research/migration.sql", import.meta.url), "utf8"));
  return { db, store: new ResearchStore(db) };
};
const search = { configured: true, search: async () => ({ query: "История технологий", searched_at: "", items: [
  { title: "Архив", url: "https://example.org/data", snippet: "история" }
] }) };
const reader = new ResearchPageReader({ resolver: async () => [{ address: "93.184.216.34", family: 4 as const }],
  transport: async (url) => url.pathname === "/robots.txt" ? { status: 404, body: "", contentType: "" } :
    { status: 200, body: "<p>История технологий менялась на протяжении сотен лет и приводила к изменениям промышленных отраслей.</p>", contentType: "text/html" } });
const modelRequest = { request_id: "test", project_id: project, run_id: "test", agent_id: "model", role: "model", task_type: "research", messages: [],
  constraints: { timeout_ms: 30000, max_output_tokens: 1200 }, idempotency_key: "test",
  routing: { preferred_provider: "stub", preferred_model_alias: "stub", fallback_allowed: false, required_features: [], confidential: false,
    estimated_input_tokens: 0, max_cost: null, optimize_for: "balanced" } };
const manager = { buildRequest: () => structuredClone(modelRequest) } as unknown as ManagerService;
const route = { attempt: 0, registry_version: "test", provider_id: "stub", model_id: "stub", estimated_input_tokens: 300, max_output_tokens: 900, estimated_cost: { amount: 0.2, currency: "USD" as const } };
const account = () => {
  const calls = { reserve: 0, settle: 0, uncertain: 0 };
  const budget: ResearchOwnerBudget = { createRun: () => {}, reserve: () => { calls.reserve++; },
    settle: () => { calls.settle++; return "committed"; }, uncertain: () => { calls.uncertain++; }, failBeforeDispatch: () => {} };
  return { calls, budget };
};
const gateway = (content: string, sleepMs = 0) => ({
  assertRoute: () => {},
  stream: async function* (_request: unknown, signal: AbortSignal): AsyncGenerator<ModelGatewayStreamEvent> {
    yield { type: "route.selected", route };
    if (sleepMs) await new Promise((resolve) => setTimeout(resolve, sleepMs));
    if (signal.aborted) return;
    yield { type: "text.delta", delta: content };
    yield { type: "response.completed", route, provider: "stub", model: "stub", usage: { inputTokens: 100, outputTokens: 50 }, calculatedCost: { amount: 0.1, currency: "USD" }, finishReason: "stop" };
  }
}) as unknown as ModelGateway;
const eventually = async (f: () => boolean) => {
  for (let i = 0; i < 200; i++) { if (f()) return; await new Promise((resolve) => setTimeout(resolve, 5)); }
  throw new Error("test timeout");
};

describe("research full synthesis with canonical budget hook", () => {
  it("checks source + excerpt IDs, forbids injected URLs, and exports the actual model answer", async () => {
    const { db, store } = newStore();
    try {
      const run = store.create(owner, owner, project, "История технологий");
      store.update(run.id, owner, ["queued"], (value) => { value.model_requested = true; });
      const counted = account();
      const coordinator = new ResearchCoordinator(store, search, reader, undefined, Date.now, () => true,
        new ResearchSynthesis(gateway(valid), manager, counted.budget));
      expect(coordinator.launch(store.get(run.id, owner)!)).toBe(true);
      await eventually(() => store.get(run.id, owner)?.status === "completed");
      const saved = store.get(run.id, owner)!;
      expect(saved.answer?.summary[0]?.citations[0]).toEqual({ source_id: "S1", excerpt_id: "E1" });
      expect(counted.calls).toMatchObject({ reserve: 1, settle: 1, uncertain: 0 });
      expect(researchMarkdown(saved)).toContain("Технологии менялись");
      expect(researchHtml(saved)).toContain("Нет количественных данных");
      for (const bad of [valid.replace("S1", "S19"), valid.replace("E1", "E4"), valid.replace("Технологии менялись", "https://unapproved.example/secret")])
        expect(() => parseResearchAnswer(bad, saved)).toThrow();
      await coordinator.stop();
    } finally { db.close(); }
  });
  it("settles confirmed usage even when the generated citations are invalid", async () => {
    const { db, store } = newStore();
    try {
      const run = store.create(owner, owner, project, "История технологий");
      store.update(run.id, owner, ["queued"], (value) => { value.model_requested = true; });
      const counted = account();
      const coordinator = new ResearchCoordinator(store, search, reader, undefined, Date.now, () => true,
        new ResearchSynthesis(gateway(valid.replace("E1", "E900")), manager, counted.budget));
      coordinator.launch(store.get(run.id, owner)!);
      await eventually(() => store.get(run.id, owner)?.status === "failed");
      expect(counted.calls.settle).toBe(1);
      expect(store.get(run.id, owner)?.model?.phase).toBe("failed");
      await coordinator.stop();
    } finally { db.close(); }
  });
  it("stops charged work on cancel without saving a late artefact", async () => {
    const { db, store } = newStore();
    try {
      const run = store.create(owner, owner, project, "История технологий");
      store.update(run.id, owner, ["queued"], (value) => { value.model_requested = true; });
      const counted = account();
      const coordinator = new ResearchCoordinator(store, search, reader, undefined, Date.now, () => true,
        new ResearchSynthesis(gateway(valid, 100), manager, counted.budget));
      coordinator.launch(store.get(run.id, owner)!);
      await eventually(() => counted.calls.reserve === 1);
      coordinator.cancel(run.id, owner);
      await coordinator.stop();
      expect(store.get(run.id, owner)?.status).toBe("cancelled");
      expect(store.get(run.id, owner)?.answer).toBeNull();
      expect(counted.calls.uncertain).toBe(1);
    } finally { db.close(); }
  });
  it("crash recovery never automatically re-runs an already dispatched request", () => {
    const { db, store } = newStore();
    try {
      const run = store.create(owner, owner, project, "История технологий");
      store.update(run.id, owner, ["queued"], (value) => { value.status = "synthesizing";
        value.model = { phase: "dispatching", run_id: "charged", usage_state: "reserved", revision: 1, error_code: null }; });
      const recovered = new ResearchStore(db).get(run.id, owner)!;
      expect(recovered.status).toBe("failed");
      expect(recovered.model?.phase).toBe("uncertain");
    } finally { db.close(); }
  });
  it("quiesce and owner deletion fence off new writes, retaining accounting outside research", async () => {
    const { db, store } = newStore();
    try {
      const run = store.create(owner, owner, project, "История технологий");
      const coordinator = new ResearchCoordinator(store, search, reader, undefined, Date.now, () => true);
      const privacy = new ResearchPrivacyAdapter(store, coordinator);
      expect(() => privacy.export(owner)).toThrow("RESEARCH_QUIESCE_REQUIRED");
      await privacy.quiesce(owner);
      expect(privacy.export(owner).items).toHaveLength(1);
      expect(privacy.delete(owner).deleted).toBe(1);
      expect(store.get(run.id, owner)).toBeNull();
      expect(() => store.create(owner, owner, project, "История технологий")).toThrow("RESEARCH_OWNER_QUIESCED");
      privacy.release(owner);
    } finally { db.close(); }
  });
});
