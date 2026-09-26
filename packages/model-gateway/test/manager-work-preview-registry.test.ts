import { readFileSync } from "node:fs";
import type { ModelRegistryDocument, ModelRouteRequest } from "@cosmora/contracts";
import { describe, expect, it } from "vitest";
import { ModelRegistry, ModelRouteError, ModelRouter } from "../src/index.js";

const readRegistry = (filename: string): ModelRegistryDocument => {
  const document: unknown = JSON.parse(
    readFileSync(new URL(`../../../config/${filename}`, import.meta.url), "utf8")
  );
  return document as ModelRegistryDocument;
};

const routeRequest = (role: string, taskType: string): ModelRouteRequest => ({
  role,
  task_type: taskType,
  preferred_provider: "vibecode",
  preferred_model_alias: "gpt-5.5",
  required_features: ["streaming"],
  confidential: false,
  estimated_input_tokens: 2_000,
  max_output_tokens: 1_000,
  max_cost: null,
  optimize_for: "quality"
});

describe("opt-in Manager work preview route", () => {
  it("keeps the current chat-only registry unchanged", () => {
    const registry = new ModelRegistry(readRegistry("model-registry.vibecode.v1.json"), {
      now: () => Date.parse("2026-09-26T00:00:00.000Z")
    });
    const router = new ModelRouter(registry);
    expect(() => router.resolve(routeRequest("manager", "manager_work_plan"))).toThrow(
      ModelRouteError
    );
  });

  it("routes all three bounded stages only when the candidate is selected", () => {
    const registry = new ModelRegistry(
      readRegistry("model-registry.vibecode.manager-work-preview.v1.json"),
      { now: () => Date.parse("2026-09-26T00:00:00.000Z") }
    );
    const router = new ModelRouter(registry);
    for (const [role, task] of [
      ["manager", "manager_work_plan"],
      ["analyst", "manager_work_draft"],
      ["critic", "manager_work_review"]
    ]) {
      expect(router.resolve(routeRequest(role!, task!))).toMatchObject({
        provider_id: "vibecode",
        model_id: "gpt-5.5",
        protocol: "openai-compatible",
        pricing: null
      });
    }
    expect(() =>
      router.resolve({ ...routeRequest("critic", "manager_work_review"), confidential: true })
    ).toThrow(ModelRouteError);
    expect(() =>
      router.resolve({
        ...routeRequest("manager", "manager_work_plan"),
        max_cost: { amount: 1, currency: "USD" }
      })
    ).toThrow(ModelRouteError);
  });
});
