import { loadServerConfig } from "@cosmora/config";
import type { ModelRegistryDocument, ModelRegistryEntry } from "@cosmora/contracts";
import { describe, expect, it } from "vitest";
import { buildModelRuntime } from "../src/model-runtime.js";

const externalEntry = (overrides: Partial<ModelRegistryEntry> = {}): ModelRegistryEntry => ({
  provider_id: "vibecode",
  model_id: "manager-model",
  aliases: ["manager"],
  protocol: "openai-compatible",
  status: "active",
  roles: ["manager"],
  task_types: ["project_chat"],
  capabilities: {
    streaming: true,
    structured_output: false,
    tool_calling: false,
    vision: false
  },
  context_window_tokens: 32_000,
  max_output_tokens: 4_000,
  quality_tier: 4,
  latency_tier: 2,
  pricing: null,
  privacy: {
    confidential_compatible: false,
    training_usage: "unknown",
    retention: "unknown"
  },
  source: {
    kind: "authorized_discovery",
    verified_at: "2026-08-25T00:00:00.000Z",
    reference: "authorized-test-fixture"
  },
  ...overrides
});

const registry = (entries: ModelRegistryEntry[]): ModelRegistryDocument => ({
  schema_version: 1,
  registry_version: "runtime-test-1",
  generated_at: "2026-08-25T00:00:00.000Z",
  entries
});

const secretResolver = {
  resolve: async (name: "MODEL_API_KEY"): Promise<string | null> => {
    await Promise.resolve();
    return name === "MODEL_API_KEY" ? "test-runtime-secret" : null;
  }
};

const externalConfig = () =>
  loadServerConfig({
    NODE_ENV: "test",
    MODEL_PROVIDER: "openai-compatible",
    MODEL_PROVIDER_ID: "vibecode",
    MODEL_BASE_URL: "https://provider.example/v1",
    MODEL_API_KEY: "test-secret",
    MODEL_NAME: "manager-model"
  });

describe("buildModelRuntime", () => {
  it("binds an external adapter only to an active registry route", async () => {
    const runtime = await buildModelRuntime(externalConfig(), {
      registryDocument: registry([externalEntry()]),
      secretResolver
    });

    expect(runtime.registryVersion).toBe("runtime-test-1");
    expect(runtime.gateway.hasProvider("vibecode")).toBe(true);
    expect(
      runtime.manager.buildRequest({
        projectId: "project-1",
        runId: "run-1",
        messages: []
      }).routing
    ).toMatchObject({
      preferred_provider: "vibecode",
      preferred_model_alias: "manager-model",
      required_features: ["streaming"]
    });
  });

  it("fails closed when configured provider metadata is absent or mismatched", async () => {
    await expect(
      buildModelRuntime(externalConfig(), {
        registryDocument: registry([]),
        secretResolver
      })
    ).rejects.toThrow("is not active in Model Registry");

    await expect(
      buildModelRuntime(externalConfig(), {
        registryDocument: registry([externalEntry({ protocol: "anthropic-compatible" })]),
        secretResolver
      })
    ).rejects.toThrow("is not active in Model Registry");
  });

  it("fails closed when the secret resolver cannot provide the credential", async () => {
    await expect(
      buildModelRuntime(externalConfig(), {
        registryDocument: registry([externalEntry()]),
        secretResolver: { resolve: () => Promise.resolve(null) }
      })
    ).rejects.toThrow("External model provider configuration is incomplete");
  });
});
